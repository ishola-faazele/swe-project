# TDD/RFC: Menu & Recipe System

## Status
Draft

## Context & Motivation
See `docs/prd-menu-recipe-system.md` for the user-facing problem. Technically: `Order` today has
only a freeform `description: String` and a hand-typed `totalPrice: Float`. Ingredient deduction is
driven entirely by an admin manually building a list of `{ inventoryItemId, quantityUsed }` pairs
in `OrderClient.tsx`'s create dialog, which `createOrder` (`src/app/admin/orders/actions.ts`) writes
into `OrderIngredientLog` and uses to decrement `InventoryItem.currentStock`, all inside a single
`prisma.$transaction`. There is no concept of a "dish" anywhere in the schema — every order
re-derives its ingredient list from scratch, by hand, every time.

This RFC introduces two new Prisma models (`Dish`, `DishIngredient`) representing a reusable dish
catalog and its recipe, plus a new join model (`OrderDish`) that records which dishes (and
quantities) were selected on a given order. Order creation and editing are changed to build their
ingredient deductions and total price *from* dish selections, while preserving the existing
freeform notes field and the existing `OrderIngredientLog` audit-trail shape unchanged.

This is grounded in the project's actual architecture (verified by reading the codebase, not
assumed): Next.js 16 App Router, Server Components + Server Actions + `revalidatePath` (no
`useQuery`/`useMutation`, despite `@tanstack/react-query` being installed), Prisma with a
schema-push workflow (`npx prisma db push`, no migration files), TanStack Table v8 for admin
tables, and three existing CRUD screens (`orders`, `inventory`, `customers`) that all follow an
identical `page.tsx` (Server Component, fetches via Prisma) → `*Client.tsx` (`"use client"`,
`useState`, no `useEffect` anywhere) → `actions.ts` (`"use server"`, `revalidatePath`) shape. This
feature imitates that shape exactly for the new `admin/menu` screen and extends, rather than
replaces, the existing order actions.

## Proposed Design

### Summary of the seven scoping decisions
These are stated in full with justification in the relevant sub-sections below; this is the quick
index so the implementation planner can find each one:

| # | Question | Decision |
|---|---|---|
| 1 | How are dish line items persisted on an Order? | New `OrderDish` join model (orderId, dishId, quantity, **and** a name + price snapshot). `OrderIngredientLog` schema is untouched. |
| 2 | Price snapshotting | `OrderDish.unitPrice` is read fresh from `Dish.price` server-side inside the create/edit transaction and stored permanently — never recomputed later. |
| 3 | Recipe changes vs. historical orders | `OrderIngredientLog.quantityUsed` is materialized once at order create/edit time by expanding the *then-current* `DishIngredient` recipe; it is never recomputed from live recipe data, so later recipe edits cannot retroactively change it. |
| 4 | Ingredient aggregation across multiple dishes | **Merged**: one `OrderIngredientLog` row per `InventoryItem` per order (summed across all selected dishes), not one row per dish-ingredient pair. |
| 5 | Deleting/editing a Dish referenced by orders | Soft-delete via `Dish.isActive`. `deleteDish` hard-deletes only if zero `OrderDish` rows reference it; otherwise it archives (`isActive: false`). No `onDelete` is set anywhere in the new schema (matches existing convention of zero `onDelete` clauses in `schema.prisma` today) — all cleanup is explicit, transactional application code. |
| 6 | Backwards compatibility with existing orders | Existing orders simply have `dishes: []`. No backfill. UI renders the dish section as empty and falls back to the pre-existing ingredient-log-driven UI, unchanged. |
| 7 | Freeform-only orders / totalPrice | **Derived-with-override.** `Order.totalPrice` stays a single editable `Float` field, auto-filled from `sum(dish.price × quantity)` whenever the dish selection changes, but always remains a plain, unlocked input the admin can overwrite (including to `0`/blank with zero dishes selected, exactly like today). |

### Data model

```
Dish 1---* DishIngredient *---1 InventoryItem     (the recipe — "what a dish is made of")
Order 1---* OrderDish *---1 Dish                  (the order line items — "what was ordered, and at what price")
Order 1---* OrderIngredientLog *---1 InventoryItem (unchanged — "what was actually deducted from stock")
```

`OrderDish` and `OrderIngredientLog` are deliberately two separate, non-overlapping records of
truth: `OrderDish` answers "what did the customer order, in dish terms, and what did we charge for
it," while `OrderIngredientLog` answers "what did the kitchen actually consume, in raw-ingredient
terms." Neither is derived from the other at read time — both are written once, together, inside
the same transaction, at order create/edit time. This is what makes decisions #3 and #6 hold
without any special-casing.

### API Changes
This project has no REST/route-handler API surface for admin CRUD — every read and write goes
through Server Actions (`"use server"` functions imported directly by Client Components). Per
`AGENTS.md`, this is the established pattern and `useQuery`/`useMutation` must not be introduced.
The Server Action surface below is the equivalent of an API contract for this codebase.

**New file `src/app/admin/menu/actions.ts`:**
- `getDishes(): Promise<(Dish & { ingredients: (DishIngredient & { inventoryItem: InventoryItem })[] })[]>` — all dishes (active and archived), ordered by name. Mirrors `getInventoryItems()`.
- `createDish(data: { name: string; price: number; ingredients: { inventoryItemId: string; quantityPerDish: number }[] }): Promise<Dish>` — wraps `dish.create` + `dishIngredient.createMany` in `prisma.$transaction`. Duplicate `inventoryItemId` entries in the input are summed before insert (see Edge Cases).
- `updateDish(id: string, data: { name?: string; price?: number; ingredients?: { inventoryItemId: string; quantityPerDish: number }[] }): Promise<Dish>` — if `ingredients` is provided, replaces the *entire* recipe: delete all existing `DishIngredient` rows for the dish, then create the new set, inside one transaction (same "replace-whole-child-set" shape as `updateOrderIngredients` uses today).
- `deleteDish(id: string): Promise<{ archived: boolean }>` — if `orderDish.count({ where: { dishId: id } }) === 0`, hard-delete (`DishIngredient` rows then the `Dish` row, in a transaction). Otherwise, set `isActive: false` and return `{ archived: true }` so the client can show the correct toast copy.
- `toggleDishActive(id: string, isActive: boolean): Promise<Dish>` — manual archive/restore, for a dish the owner wants to hide seasonally without deleting it.

**Extended `src/app/admin/orders/actions.ts`:**
- `getOrders()` — extend the `include` to also fetch `dishes: true` (the new `OrderDish` relation), alongside the existing `customer` and `ingredientLogs` includes.
- `createOrder(data: { customerId: string; description: string; totalPrice: number; dueDate?: Date | null; dishes: { dishId: string; quantity: number }[] })` — **signature change**: the old `ingredients: { inventoryItemId, quantityUsed }[]` parameter is removed entirely and replaced by `dishes`. See pseudocode below.

**Extended `src/app/admin/orders/[id]/actions.ts`:**
- `updateOrderIngredients` is renamed to **`updateOrderItems`** and its signature extended:
  `updateOrderItems(orderId: string, data: { dishes: { dishId: string; quantity: number }[]; extraIngredients: { inventoryItemId: string; quantityUsed: number }[]; totalPrice: number })`.
  This single action is now the *only* writer of `OrderIngredientLog`/`OrderDish` for the edit flow
  (see "Why one merged edit action, not two" below) — it fully replaces the old
  `updateOrderIngredients`, reusing its revert-then-reapply transaction body almost verbatim.

**New shared, framework-free module `src/lib/recipe.ts`:**
```ts
import type { Dish, DishIngredient } from '@prisma/client'

export type DishWithRecipe = Dish & { ingredients: DishIngredient[] }
export type DishSelection = { dishId: string; quantity: number }
export type RawIngredientLine = { inventoryItemId: string; quantityUsed: number }

/** Pure function — no Prisma, no I/O. Expands dish selections (using each dish's CURRENT
 *  recipe, passed in by the caller) into merged, per-InventoryItem deduction totals, optionally
 *  merging in raw non-catalog ingredient lines. Dishes not found in `dishes` are skipped
 *  defensively rather than throwing (see Edge Cases: dish deleted mid-submit). */
export function expandDishesToIngredients(
  selections: DishSelection[],
  dishes: DishWithRecipe[],
  extraLines: RawIngredientLine[] = []
): RawIngredientLine[]

/** Pure function. Sums quantity × unit price across a dish selection, using dish price data
 *  the caller supplies (server code passes DB-fresh prices; client code passes the same
 *  in-memory dish list already on the page, for live UI preview). */
export function computeDishSubtotal(
  selections: DishSelection[],
  dishes: { id: string; price: number }[]
): number
```
Both functions take their dish data as plain arguments rather than querying Prisma directly, which
is what makes them usable both server-side (inside a transaction, with DB-fresh data) and
client-side (for the live total-price preview) — and, per the Testing Strategy below, unit-testable
with zero database or Next.js runtime involved.

### Database Changes
This project uses **schema-push** (`npx prisma db push`), not Prisma Migrate — there are no
migration files anywhere in `prisma/`. The change here is a direct diff to `prisma/schema.prisma`,
applied locally with `npx prisma db push` (regenerating the client), consistent with how
`InventoryItem`/`Order` were presumably introduced.

```prisma
model Dish {
  id          String   @id @default(uuid())
  shortId     Int      @unique @default(autoincrement())
  name        String
  price       Float
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  ingredients DishIngredient[]
  orderDishes OrderDish[]
}

model DishIngredient {
  id              String        @id @default(uuid())
  dishId          String
  dish            Dish          @relation(fields: [dishId], references: [id])
  inventoryItemId String
  inventoryItem   InventoryItem @relation(fields: [inventoryItemId], references: [id])
  quantityPerDish Float         // amount of InventoryItem.unit consumed per ONE unit of the dish
  createdAt       DateTime      @default(now())

  @@unique([dishId, inventoryItemId]) // one row per (dish, ingredient) — no silent duplicates
}

model OrderDish {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  dishId    String
  dish      Dish     @relation(fields: [dishId], references: [id])
  dishName  String   // snapshot of Dish.name at order time — survives a later rename/archive
  unitPrice Float    // snapshot of Dish.price at order time — see Decision #2
  quantity  Int
  createdAt DateTime @default(now())
}
```

Additive relation fields on existing models (no existing columns change type or are removed):
```prisma
model InventoryItem {
  // ...unchanged fields...
  orderLogs       OrderIngredientLog[]
  dishIngredients DishIngredient[]      // NEW
}

model Order {
  // ...unchanged fields...
  ingredientLogs OrderIngredientLog[]
  dishes         OrderDish[]            // NEW
}
```

**On `onDelete` behavior (directly answers decision #5):** nothing in `schema.prisma` today
specifies `onDelete` on any relation — including `Order.customer`, which is the exact landmine
called out in the brief (deleting a referenced `User` throws an unhandled `RESTRICT` error because
`deleteCustomer` has no `try/catch`). This RFC deliberately follows that same existing convention
(no `onDelete` anywhere) rather than introducing `Cascade` for the new models, for two reasons:
(a) consistency — introducing `Cascade` only for the new models while everything else defaults to
`Restrict` would be a silent, undocumented behavioral inconsistency in the schema; (b) safety —
`Restrict`-by-default means a raw/accidental delete of a `Dish` or `InventoryItem` that's actually
referenced fails loudly (as a DB constraint error) instead of silently cascading away order
history. All cleanup this feature needs is therefore done **explicitly, inside
`prisma.$transaction` calls in application code** — exactly how `deleteOrder` already
hand-deletes `OrderIngredientLog` rows before deleting the `Order` row today.

**Required, non-optional touch to existing `deleteOrder`:** because `OrderDish` rows will now
exist for many orders, `deleteOrder` (`src/app/admin/orders/actions.ts`) must be extended to also
`tx.orderDish.deleteMany({ where: { orderId: id } })` before `tx.order.delete(...)`, in the same
transaction, exactly parallel to how it already handles `OrderIngredientLog`. **Without this
change, deleting any order that has dish line items will throw an unhandled `P2003` foreign-key
error** — a new crash, not merely the pre-existing "stock isn't restored" bug. This is the one
place this feature *must* touch `deleteOrder`; it does not restore inventory stock (that bug stays
exactly as deferred) and does not add a `try/catch` (that gap stays exactly as deferred) — it only
adds the missing `deleteMany` so the function doesn't newly crash.

### Domain & Service Layer

**`createOrder` (extended), pseudocode:**
```ts
export async function createOrder(data: {
  customerId: string
  description: string
  totalPrice: number
  dueDate?: Date | null
  dishes: { dishId: string; quantity: number }[]
}) {
  const order = await prisma.$transaction(async (tx) => {
    // Never trust client-supplied dish prices/recipes — re-read fresh, inside the transaction.
    const dishRecords = await tx.dish.findMany({
      where: { id: { in: data.dishes.map(d => d.dishId) } },
      include: { ingredients: true },
    })

    const newOrder = await tx.order.create({
      data: {
        customerId: data.customerId,
        description: data.description,
        totalPrice: data.totalPrice, // client-supplied — see Decision #7 (derived-with-override)
        dueDate: data.dueDate,
        status: 'PENDING',
      },
    })

    for (const sel of data.dishes) {
      const dish = dishRecords.find(d => d.id === sel.dishId)
      if (!dish || sel.quantity <= 0) continue // defensive skip — see Edge Cases
      await tx.orderDish.create({
        data: {
          orderId: newOrder.id,
          dishId: dish.id,
          dishName: dish.name,
          unitPrice: dish.price,
          quantity: sel.quantity,
        },
      })
    }

    const ingredientTotals = expandDishesToIngredients(data.dishes, dishRecords)
    for (const line of ingredientTotals) {
      await tx.orderIngredientLog.create({ data: { orderId: newOrder.id, ...line } })
      await tx.inventoryItem.update({
        where: { id: line.inventoryItemId },
        data: { currentStock: { decrement: line.quantityUsed } },
      })
    }

    return newOrder
  })

  // ...unchanged: notifyOrderStatusChange + low-stock check, fire-and-forget, exactly as today...
  revalidatePath('/admin/orders')
  return order
}
```

**`updateOrderItems` (replaces `updateOrderIngredients`), pseudocode:**
```ts
export async function updateOrderItems(orderId: string, data: {
  dishes: { dishId: string; quantity: number }[]
  extraIngredients: { inventoryItemId: string; quantityUsed: number }[]
  totalPrice: number
}) {
  await prisma.$transaction(async (tx) => {
    // 1-2. Revert + delete old ingredient logs — IDENTICAL to today's logic, untouched.
    const existingLogs = await tx.orderIngredientLog.findMany({ where: { orderId } })
    for (const log of existingLogs) {
      await tx.inventoryItem.update({
        where: { id: log.inventoryItemId },
        data: { currentStock: { increment: log.quantityUsed } },
      })
    }
    await tx.orderIngredientLog.deleteMany({ where: { orderId } })
    await tx.orderDish.deleteMany({ where: { orderId } }) // NEW — clears old dish snapshots too

    // 3. Re-read fresh dish/price data for the NEW selection (re-priced at edit time — see below)
    const dishRecords = await tx.dish.findMany({
      where: { id: { in: data.dishes.map(d => d.dishId) } },
      include: { ingredients: true },
    })
    for (const sel of data.dishes) {
      const dish = dishRecords.find(d => d.id === sel.dishId)
      if (!dish || sel.quantity <= 0) continue
      await tx.orderDish.create({
        data: { orderId, dishId: dish.id, dishName: dish.name, unitPrice: dish.price, quantity: sel.quantity },
      })
    }

    // 4-5. Merge dish-derived + manually-added extra ingredient lines, apply new deductions.
    const merged = expandDishesToIngredients(data.dishes, dishRecords, data.extraIngredients)
    for (const line of merged) {
      if (line.quantityUsed <= 0) continue
      await tx.inventoryItem.update({
        where: { id: line.inventoryItemId },
        data: { currentStock: { decrement: line.quantityUsed } },
      })
      await tx.orderIngredientLog.create({ data: { orderId, ...line } })
    }

    await tx.order.update({ where: { id: orderId }, data: { totalPrice: data.totalPrice } })
  })

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/inventory')
}
```

**Why one merged edit action, not two independent ones:** an earlier version of this design had a
separate `updateOrderDishes` action alongside the untouched `updateOrderIngredients`. That's
rejected — both would independently "delete all `OrderIngredientLog` rows for this order and
recreate them," so saving one editor after the other would silently wipe out whichever was saved
first, while `OrderDish` rows drifted out of sync with what `OrderIngredientLog` actually reflects.
A single action with two input sections (**Dishes** and **Extra Ingredients**, merged before
write) makes `OrderIngredientLog` have exactly one writer in the edit flow, with no ordering
hazard. Note this is an *edit-page-only* pattern — order **creation** intentionally does not expose
"Extra Ingredients" (see PRD Open Question #1); the shared `expandDishesToIngredients(selections,
dishes, extraLines?)` signature already supports adding that to creation later with zero schema or
transaction changes, purely a UI addition, if it turns out to be needed.

**Why dish price is re-snapshotted at *edit* time, not preserved from the original order:** editing
an order's dishes is a deliberate, active decision by the admin happening *now*; using the current
catalog price avoids saving a stale number the admin didn't actually see or intend. This is a
judgment call, stated explicitly here so it isn't ambiguous: **creating** an order snapshots price
once and never touches it again; **re-saving** an order's dish list re-snapshots price at that
save's moment, every time it's saved.

### Frontend Changes

**New `src/app/admin/menu/page.tsx`** (Server Component) — `Promise.all([getDishes(), getInventoryItems()])`, passes both as props to `MenuClient`, matching the `OrdersPage` pattern of fetching cross-entity data server-side.

**New `src/app/admin/menu/MenuClient.tsx`** (`"use client"`) — TanStack Table v8 over `Dish[]`
(columns: `shortId`, `name`, `price`, a truncated recipe summary, an Active/Archived badge styled
like `InventoryClient`'s `StockBadge`/category-color pattern, and an actions column with
Edit/Archive-toggle/Delete). The create/edit dialog has `name`, `price`, and a dynamic recipe
builder: a repeatable ingredient-select + `quantityPerDish` number input + remove button, "+ Add
Ingredient" button — structurally similar to today's ingredient-picker in `OrderClient.tsx`, but
**not extracted into a shared component**. This is a deliberate consistency call, not an oversight:
the three existing screens (`OrderClient`, `InventoryClient`, `CustomerClient`) already duplicate
their entire table-rendering JSX verbatim rather than sharing a `<DataTable>` — this codebase's
established grain is per-screen duplication over shared abstraction. Matching that here is more
consistent than introducing the app's first shared UI abstraction inside this feature. Revisit if
a fourth or fifth screen needs the same dynamic-row pattern.

**⚠️ Dialog trigger note (must NOT copy an existing bug):** `OrderClient.tsx`, `InventoryClient.tsx`,
and `CustomerClient.tsx` all currently write their "Create" trigger as
`<DialogTrigger render={<Button />}>`. Per `AGENTS.md`, this exact pattern is documented as
silently broken with this project's `Button` component (click events swallowed). `MenuClient.tsx`
must use `<Button onClick={() => setIsOpen(true)}>` instead, per the explicit, corrected project
guidance — even though that means *not* copying what the other three screens currently do. This is
flagged here because "follow the existing pattern" and "follow `AGENTS.md`" conflict on this one
specific line, and `AGENTS.md` wins. Worth a one-line note for the hardening pass: the three
existing screens likely have non-functional "Create" buttons today and should be fixed to match.

**Extended `src/app/admin/orders/OrderClient.tsx`:**
- New prop: `dishes: DishWithRecipe[]` (from `getDishes()`, fetched in `OrdersPage`/`page.tsx`
  alongside the existing `customers`/`inventory` props).
- `selectedIngredients` state is replaced by `selectedDishes: { dishId: string; quantity: number }[]`.
- The ingredient-picker rows in the create dialog are replaced by dish-picker rows: a `<select>`
  populated from `dishes.filter(d => d.isActive)`, plus an integer quantity `<Input type="number"
  min="1">`, plus remove — same interaction shape as today's ingredient rows, different data.
- `description` becomes an optional field (its `required` attribute is removed; placeholder text
  changes from "Order Details (e.g. 40 meat pies, 20 drinks)" to "Notes (e.g. no pepper, extra
  meat pies, delivery instructions)") since dish selection is now the primary structured entry and
  notes are explicitly supplementary — not the sole spec of the order anymore.
- Total price auto-sync: every dish-row mutation handler (add/remove/change dish/change quantity)
  inline-recomputes `computeDishSubtotal(selectedDishes, dishes)` and calls
  `setTotalPriceInput(newSubtotal)` in the same handler — no `useEffect` is introduced, matching
  this codebase's existing style (none of the three current `*Client.tsx` files use `useEffect`
  anywhere). The `totalPrice` input stays a plain, always-editable controlled input; typing into it
  directly simply overrides the last auto-computed value until the next dish-row change resets it.
  This exact behavior (silently overwritten on every dish change, not gated behind a "Recalculate"
  button or a dirty-flag) is the recommended default — see Open Questions for the one legitimate
  point of debate here.
- `handleAdd` now calls `createOrder({ ..., dishes: selectedDishes.filter(d => d.dishId && d.quantity > 0) })`.

**Extended `src/app/admin/orders/[id]/OrderDetailsClient.tsx`:**
- New prop: `dishes: DishWithRecipe[]` (from `page.tsx`, alongside the existing `inventory` prop).
- The "Ingredients Used" section keeps its exact current inline-edit UX (no `Dialog`, toggled via
  `isEditing` state) but gains a sibling **"Dishes Ordered"** section, same inline-edit pattern,
  seeded from `order.dishes` (the new `OrderDish[]` relation — empty array for legacy orders,
  causing no crash).
- The existing ingredient rows are relabeled **"Extra Ingredients"** in edit mode and, for a
  pre-existing order with no `OrderDish` rows, are still pre-populated from `order.ingredientLogs`
  exactly as today — a legacy order is visually and behaviorally unchanged unless the admin
  actively adds dishes to it.
- A single **Save** button now calls the new `updateOrderItems(order.id, { dishes, extraIngredients, totalPrice })`, replacing the old `updateOrderIngredients(order.id, ingredients)` call.
- Total price on this screen follows the same derived-with-override behavior as the create form.

**`src/components/layout/Sidebar.tsx`:** add a `Menu` entry to the `MANAGEMENT` section, between
`Inventory` and `Customers` (dishes are configuration, same category as inventory/customers, and
sit logically between "what raw materials exist" and "who orders them"):
```ts
{ name: 'Menu', href: '/admin/menu', icon: UtensilsCrossed, exact: false },
```
`UtensilsCrossed` is confirmed present in this project's installed `lucide-react` version.

## Alternatives Considered

**1. Denormalized `Order.itemsJson` blob instead of a relational `OrderDish` table.**
Pro: one field, no new table. Con: no relational query-ability (can't `groupBy` dish across orders
for a future "top-selling dish" report — an explicit item on the broader PM roadmap this feature
feeds into), and it's the first JSON column in a schema that is otherwise fully relational
end-to-end. Rejected — breaks the schema's existing grain and blocks a known future need for a
one-field convenience.

**2. Reverse-derive dish line items from `OrderIngredientLog` instead of a dedicated `OrderDish` table.**
Pro: zero new table. Con: mathematically not invertible — two different dish combinations can
produce identical merged ingredient totals (e.g., "2× Jollof + 1× Fried Rice" can look
indistinguishable in aggregate from a different combination that happens to use the same total
rice/chicken/oil), and it discards per-dish price entirely, which directly fails Decision #2.
Rejected outright — cannot satisfy "show 2× Jollof Rice on reopen," the feature's core requirement.

**3. Unmerged `OrderIngredientLog`, one row per dish-ingredient pair, instead of merged per `InventoryItem`.**
Pro: full dish-level ingredient traceability for future cost analytics. Con: when two dishes in the
same order share an ingredient, the existing "Ingredients Used" table would show two separate rows
for the same item (e.g., "Rice — 1.5kg" and "Rice — 1.7kg") — confusing for the target non-technical
user glancing at an order mid-shift, who expects one line per ingredient. The lost traceability is
still substantially recoverable later via `OrderDish` + the (then-current) recipe, and could be
added cheaply later as an optional `sourceDishId` column on `OrderIngredientLog` without touching
anything built here. Rejected in favor of the merged approach (Decision #4).

## Edge Cases & Failure Modes
- **Deleting an `InventoryItem` referenced by a `DishIngredient`** throws an unhandled Prisma
  `P2003` (the default `Restrict` relation action + `deleteInventoryItem`'s existing lack of
  `try/catch`). This is **not a new class of bug** — `deleteInventoryItem` already has this exact
  crash shape today for items with existing `OrderIngredientLog` history; this feature extends the
  same pre-existing gap to a second foreign key. Not fixed here, per hard constraints; flagged for
  the hardening pass.
- **`deleteOrder` on an order with dish line items** — see "Required, non-optional touch" above.
  Left un-updated, this would throw a *new* `P2003` crash (distinct from the pre-existing
  "doesn't restore stock" bug, which remains unfixed). This one code touch is required.
- **Race condition on stock decrement** — `createOrder`'s new dish-expansion path funnels into the
  exact same unguarded `decrement` call the ingredient-picker path uses today. This feature does
  not add a new race condition class, but it does add a second entry point that inherits the
  existing one (no floor/guard, no re-check under concurrent transactions). Not fixed here.
- **A `Dish` is archived or deleted by another session between page load and order submission** —
  `createOrder`/`updateOrderItems` re-read dishes fresh from the DB inside the transaction and
  defensively `continue` past any `dishId` that no longer resolves, rather than crashing. This can
  silently produce an order with fewer dish lines than the admin intended; no error is surfaced to
  the user in v1 — an accepted MVP gap, worth a toast/warning in a later pass.
- **Two dishes in the same order share an ingredient** — handled correctly by design: the merged
  aggregation in `expandDishesToIngredients` produces exactly one `OrderIngredientLog` row with the
  summed `quantityUsed` (see Decision #4).
- **Editing a `Dish`'s recipe or price after orders already reference it** — has zero effect on
  already-created `OrderIngredientLog`/`OrderDish` rows, by construction (both are materialized
  once at order create/edit time, never recomputed from live `Dish`/`DishIngredient` data).
- **Duplicate ingredient rows within one dish's recipe** (admin picks "Rice" twice in the recipe
  builder) — would violate the new `@@unique([dishId, inventoryItemId])` constraint and throw
  `P2002` on raw insert. `createDish`/`updateDish` must sum `quantityPerDish` for duplicate
  `inventoryItemId` entries before writing, defensively, so an accidental double-selection doesn't
  crash the save.
- **Legacy orders (created before this feature shipped)** have `dishes: []`. The order-detail page
  must render the "Dishes Ordered" section as empty/graceful rather than assuming a non-empty
  array — guaranteed automatically since Prisma returns `[]`, not `undefined`, for an empty
  included relation.
- **Editing an existing `OrderDish` row's dish selection to an archived dish** (the dish was active
  when originally ordered, later archived) — the edit UI's dropdown for that specific existing row
  must still include the archived dish as a valid, already-selected option, even though the
  "add a new dish" default list only offers active dishes. Otherwise the row would silently render
  with no valid selection on reopen.
- **Large/complex orders** (e.g., a wedding order with 15+ distinct dishes) — `expandDishesToIngredients`
  is `O(dishes × ingredients-per-dish)`, trivially small at this business's real scale (dozens of
  dishes, single-digit ingredients each). No pagination or performance concern.
- **Zero or negative `quantityPerDish` / dish `price` / order dish `quantity`** — no server-side
  validation library exists in this project today (no zod, confirmed absent from `package.json`).
  Guarded only by HTML input attributes (`min="0"`/`min="1"`, `type="number"`) and the same
  client-side `.filter(d => d.id && d.quantity > 0)` pattern already used before submission in
  `OrderClient.tsx` today. Not hardened further here — consistent with, not worse than, the
  existing app-wide gap.

## Security Considerations
- **No new authorization is added.** `createDish`, `updateDish`, `deleteDish`, `toggleDishActive`,
  and the extended `createOrder`/`updateOrderItems` inherit the exact same gap every existing
  Server Action in this codebase has: no `supabase.auth.getUser()` call, no role check, callable by
  any authenticated session (and Server Actions are independently reachable POST endpoints,
  regardless of UI routing). This is a known, explicitly deferred, pre-existing gap — not
  introduced or worsened here, but also not fixed here.
- **Price/recipe integrity is server-verified where it matters most.** `OrderDish.unitPrice` and
  the ingredient quantities behind every `OrderIngredientLog` row are always re-read from the
  database inside the transaction — never trusted from client-submitted values — closing off a
  price/recipe-tampering vector for the parts of the record that are supposed to be an immutable
  snapshot of catalog truth.
- **`Order.totalPrice` remains fully client-writable, by design** (Decision #7,
  derived-with-override). A compromised or malicious admin session could set an arbitrary total
  unrelated to the selected dishes. This is not a new risk — `totalPrice` has always been a
  free-typed field in this app — and is bounded today only by "you must already be an
  authenticated session," which is the same weak boundary every other action in this app has.
- **No input validation library is introduced** (matches the existing, confirmed absence of zod or
  any equivalent in `package.json`). Consistent with, not worse than, the rest of the app.
- **No new data exposure.** `Dish`/`DishIngredient` data is only reachable through the existing
  session-gated (not role-gated) `admin/*` routes — identical exposure profile to `InventoryItem`
  today.

## Testing Strategy
**There is currently no test framework installed anywhere in this repo** (no jest, vitest, or
playwright; zero test files). Recommendation for the framework that will need bootstrapping in a
later pipeline phase:

- **Vitest** for unit tests. It's fast, has first-class TypeScript/ESM support, and needs no
  Next.js-specific runtime shimming for testing plain TypeScript modules — a good fit given the
  most valuable tests this feature needs (`src/lib/recipe.ts`) are deliberately framework-free pure
  functions with zero Prisma/React involvement.
- **Prisma against a real local Postgres test database** (this project already runs local Supabase
  via Docker for dev — point tests at a disposable schema/database on the same instance, or a
  dedicated `DATABASE_URL_TEST`) for transaction-level integration tests. Do **not** mock the
  Prisma client for these — the whole point of the tests below is verifying real transactional
  behavior (revert-then-reapply, stock arithmetic), which a mock cannot meaningfully exercise.
- **Playwright**, later, for a true end-to-end smoke test of the create-order-with-dishes flow —
  lower priority than the above for this feature specifically, since the transactional correctness
  is the highest-risk surface, not the UI wiring.

**Priority order of what most needs coverage:**
1. **`expandDishesToIngredients`** (highest priority, pure/no-DB): merges quantities correctly when
   two selected dishes share an ingredient; skips a `dishId` not present in the supplied `dishes`
   array without throwing; correctly merges `extraLines` on top of dish-derived totals; returns `[]`
   for an empty selection.
2. **`computeDishSubtotal`** (pure/no-DB): correct sum across quantities; `0` for an empty
   selection; skips an unresolvable `dishId` without throwing.
3. **`createOrder`'s full transaction** (integration, real DB): selecting dishes produces the
   correct `OrderDish` snapshot rows (name + price captured, not live-joined), the correct merged
   `OrderIngredientLog` rows, and the correct net `currentStock` decrement.
4. **`updateOrderItems`'s revert-then-reapply path** (integration, real DB) — the highest-risk test
   in this feature: edit an order's dishes twice in a row and assert stock nets out exactly right
   (not double-deducted, not under-reverted); assert old `OrderDish` rows are fully replaced, not
   accumulated.
5. **`createDish`/`updateDish`** duplicate-ingredient summing behavior; **`deleteDish`**'s
   archive-vs-hard-delete branching (zero-orders case hard-deletes, referenced case archives).

## Rollout Plan
- **No feature-flag system exists in this codebase** and none is introduced here — every existing
  admin screen shipped as a single, ungated deploy, and this follows the same path.
- **Schema:** apply via `npx prisma db push` locally first, verify via `npx prisma studio` or a
  manual smoke test, then apply the same way wherever this project's existing (informal) deploy
  process runs `db push` today — this RFC does not change or formalize that process.
- **Data migration: none required.** Existing orders simply have zero `OrderDish` rows going
  forward; this is fully backward compatible by construction (Decision #6), not something that
  needs a backfill script.
- **Seed data:** extend `prisma/seed.ts` with realistic `Dish`/`DishIngredient` fixtures (e.g., tie
  several of the already-seeded `InventoryItem` rows — rice, chicken, oil — into 4-6 dishes: Jollof
  Rice, Fried Rice, Meat Pie, Waakye, Banku & Tilapia) so local dev/demo data actually exercises the
  new model instead of showing an empty Menu screen.
- **Rollback:** since `db push` has no migration history, rolling back means reverting the
  `schema.prisma` diff and re-running `db push`. **This will `DROP` the new tables and permanently
  delete any `Dish`/`DishIngredient`/`OrderDish` rows created since launch** — do not roll back the
  schema after real orders have been placed against it without taking a database snapshot first.

## Open Questions
None of the items below block implementation — each already has a stated default the
implementation planner can proceed with; they're flagged for awareness/revisit, not as blockers.
- Whether order **creation** should eventually gain the same "Extra Ingredients" fallback the edit
  screen has (see PRD Open Question #1). Default: no, for v1.
- Whether the total-price auto-sync should silently overwrite a manual override on every dish-row
  change (current design), or require an explicit "Recalculate" action so a manual adjustment
  can't be accidentally clobbered by adding one more dish afterward. Default: silent auto-sync, as
  specified in Frontend Changes — worth a quick usability check with the business owner post-launch
  since this is a real trust-in-the-number judgment call, not a technical one.
- Whether fractional `OrderDish.quantity` will ever be needed (currently modeled as `Int`, "2
  plates" not "2.5 plates"). Default: whole numbers only, per the PRD's assumption.
