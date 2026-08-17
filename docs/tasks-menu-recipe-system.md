# Engineering Task List: Menu & Recipe System

**Generated**: 2026-08-17
**Source PRD**: `docs/prd-menu-recipe-system.md`
**Source TDD**: `docs/tdd-menu-recipe-system.md`
**Total Tasks**: 26 across 4 phases (plus 1 proactively suggested task)

---

## Summary

This feature introduces a reusable dish catalog (`Dish`, `DishIngredient`) and an order line-item
model (`OrderDish`) on top of the existing `Order` / `InventoryItem` / `OrderIngredientLog` schema,
so the business owner can create a dish once and reuse it on every order instead of re-typing a
freeform description and hand-picking every raw ingredient. The TDD's key architectural decisions —
snapshotted `OrderDish.dishName`/`unitPrice`, a merged (not per-dish) `OrderIngredientLog`, soft-delete
via `Dish.isActive` with conditional hard-delete, and a single unified `updateOrderItems` action
replacing `updateOrderIngredients` — are all treated as fixed design in this plan; this document is
about sequencing and granularity, not redesign.

The build order follows the codebase's existing layering: schema first, then a framework-free pure
module (`src/lib/recipe.ts`) for the recipe-expansion and pricing math, then the Server Actions that
use it, then the Server Components/Client Components that call those actions. The new `admin/menu`
screen imitates the existing `orders`/`inventory`/`customers` trio (`page.tsx` → `*Client.tsx` →
`actions.ts`) exactly, and the order create/edit flows are extended in place rather than rewritten
from scratch. Automated test authoring is explicitly out of scope for this document — that is a
dedicated later pipeline phase (Vitest bootstrap) — but every task involving the recipe/pricing math
is scoped so that phase can start immediately with pure, dependency-free functions to import.

Four phases: **Phase 1 (Foundation)** — schema, pure lib module, seed data. **Phase 2 (Core
Logic)** — all Server Actions (Dish CRUD, dish-based order create/edit, the required `deleteOrder`
fix). **Phase 3 (Integration & UI)** — the new Menu screen, sidebar entry, and the order
create/edit UI rework. **Phase 4 (Integration Verification & Docs)** — a manual verification
checklist and an `AGENTS.md` update, deliberately *not* an automated test suite.

---

## Dependency Graph

```
Phase 1: Foundation
  BE-001 (schema) ──> BE-002 (db push) ──┬──> BE-003 (recipe.ts core) ──> BE-004 (dedup helper)
                                          └──> BE-005 (seed.ts)

Phase 2: Core Logic
  BE-002 ──> BE-006 (getDishes) ──┬──> BE-007 (createDish) [needs BE-004] ──> BE-008 (updateDish)
                                   ├──> BE-009 (deleteDish)
                                   └──> BE-010 (toggleDishActive)
  BE-002 ──> BE-011 (getOrders +dishes) ──┬──> BE-012 (createOrder rework) [needs BE-003]
                                           └──> BE-014 (updateOrderItems) [needs BE-003]
  BE-002 ──> BE-013 (deleteOrder +OrderDish delete)   [independent of BE-011/012/014]

Phase 3: Integration & UI
  BE-006 ──> FE-001 (menu/page.tsx) ──> FE-002 (MenuClient table+create) ──┐
  FE-003 (mount Toaster, independent) ─────────────────────────────────────┼──> FE-004 (edit/archive/delete)
  BE-008,BE-009,BE-010 ───────────────────────────────────────────────────┘
  FE-001 ──> FE-005 (Sidebar entry)

  BE-006 ──> FE-006 (orders/page.tsx +dishes) ──> FE-007 (OrderClient dish-picker) [needs BE-012, BE-003]
  BE-002,BE-006 ──> FE-008 ([id]/page.tsx +dishes) ──> FE-009 (Dishes Ordered section)
                                                          └──> FE-010 (wire updateOrderItems) [needs BE-014]

Phase 4: Integration Verification & Docs
  BE-001 ──> INFRA-001 (AGENTS.md update)
  All Phase 1-3 ──> INFRA-002 (manual verification checklist)
```

| Rule | How this plan satisfies it |
|---|---|
| Schema before data access | BE-001/002 precede every Server Action task (BE-006 onward) |
| Data access before service logic | This codebase merges data-access + service logic into one `actions.ts` per screen (no separate repository layer) — respected as-is, not introducing a new layer |
| Service logic before handlers | Server Actions *are* the handler layer here (no REST/route-handler surface exists) — no separate ordering needed |
| Shared types/domain models before consumers | `src/lib/recipe.ts` (BE-003/004) precedes every task that imports `expandDishesToIngredients`/`computeDishSubtotal`/`mergeDuplicateIngredients` (BE-007, BE-008, BE-012, BE-014, FE-007, FE-010) |
| API before frontend data-fetching | Every `BE-0xx` Server Action precedes the `FE-0xx` task that calls it |
| Auth/middleware before protected routes | N/A — no new auth is introduced; explicitly out of scope per the hard constraints below |

No circular dependencies were found. The one genuine ordering subtlety: `BE-013` (the required
`deleteOrder` fix) has no dependency on `BE-011/012/014` — it only needs the `OrderDish` model to
exist (BE-002) — so it can be built in parallel with the rest of Phase 2 rather than serialized
after `createOrder`/`updateOrderItems`.

---

## Phase 1: Foundation

### BE-001 · Add `Dish`, `DishIngredient`, `OrderDish` models to `prisma/schema.prisma`
**Category**: Backend · **Phase**: 1 · **Dependencies**: None

**Description**: Add the three new Prisma models exactly as specified in the TDD's Database Changes
section, plus additive relation fields (`dishIngredients` on `InventoryItem`, `dishes` on `Order`).
This is the foundational schema change every other backend and frontend task in this feature
depends on, since Prisma Client's generated types are imported throughout the codebase.

**Technical Notes**: Follow the TDD's schema block verbatim — `Dish` (id/shortId/name/price/isActive/
timestamps + `ingredients`/`orderDishes` relations), `DishIngredient` (id/dishId/dish/
inventoryItemId/inventoryItem/quantityPerDish/createdAt + `@@unique([dishId, inventoryItemId])`),
`OrderDish` (id/orderId/order/dishId/dish/dishName/unitPrice/quantity/createdAt). Per the TDD's
Decision #5 and the current `schema.prisma` (verified by reading it — zero `onDelete` clauses exist
anywhere today, including on `Order.customer`), do **not** add `onDelete: Cascade` to any new
relation. Leave everything at Prisma's default `Restrict`.

**Definition of Done**:
- [ ] `Dish`, `DishIngredient`, `OrderDish` models added to `prisma/schema.prisma` matching the TDD's field list exactly
- [ ] `InventoryItem` gains `dishIngredients DishIngredient[]`; `Order` gains `dishes OrderDish[]`
- [ ] No `onDelete` clause added to any new relation field
- [ ] `@@unique([dishId, inventoryItemId])` present on `DishIngredient`
- [ ] `npx prisma validate` (or `npx prisma format`) runs with no errors

**Estimated Complexity**: Low — pure schema addition, fully specified by the TDD, no logic.

---

### BE-002 · Apply schema via `npx prisma db push` and regenerate Prisma Client
**Category**: Backend · **Phase**: 1 · **Dependencies**: BE-001

**Description**: Push the new schema to the local Postgres/Supabase instance and regenerate the
Prisma Client so `Dish`/`DishIngredient`/`OrderDish` types become importable throughout the app.
This project uses schema-push exclusively — there is no migration file to author or commit.

**Technical Notes**: Run `npx prisma db push` (not `prisma migrate dev` — no `prisma/migrations/`
directory exists or should be created, per `AGENTS.md`). Verify locally via `npx prisma studio`
that the three new tables exist with expected columns. Local Supabase must already be running
(`npm run supabase:start`).

**Definition of Done**:
- [ ] `npx prisma db push` completes with no errors against the local dev database
- [ ] `npx prisma studio` shows `Dish`, `DishIngredient`, `OrderDish` tables with expected columns
- [ ] `Dish`/`DishIngredient`/`OrderDish` types import from `@prisma/client` with no TypeScript error
- [ ] No file created under `prisma/migrations/`

**Estimated Complexity**: Low — mechanical, but blocks every downstream task; verify carefully.

---

### BE-003 · Create `src/lib/recipe.ts` pure module (types + `expandDishesToIngredients` + `computeDishSubtotal`)
**Category**: Backend · **Phase**: 1 · **Dependencies**: BE-002

**Description**: Create the shared, framework-free module the TDD specifies at `src/lib/recipe.ts`,
exporting `DishWithRecipe`/`DishSelection`/`RawIngredientLine` types and the two pure functions
`expandDishesToIngredients` and `computeDishSubtotal`. This is the single most important task for
testability in this feature — both functions must take plain data in and return plain data out,
with zero Prisma or Next.js runtime involvement, so a later Vitest suite can import and exercise
them with no database and no Next.js runtime.

**Technical Notes**: Implement per the TDD's code block. `expandDishesToIngredients` must: merge
quantities per `InventoryItem` when dishes share an ingredient (Decision #4), defensively skip any
`dishId` not found in the supplied `dishes` array rather than throwing (mid-submit archive/delete
edge case), and optionally merge in `extraLines`. `computeDishSubtotal` must sum `quantity × price`
across the selection and skip unresolvable `dishId`s the same way. This file must not import
`@/lib/prisma` or anything from `next/*` — this is what makes it usable both inside a server-side
transaction (DB-fresh data) and client-side (live UI preview), per the TDD's explicit rationale.

**Definition of Done**:
- [ ] `src/lib/recipe.ts` exports `DishWithRecipe`, `DishSelection`, `RawIngredientLine` types
- [ ] `expandDishesToIngredients(selections, dishes, extraLines?)` merges shared-ingredient quantities into one line per `InventoryItem`, skips unresolvable `dishId`s without throwing, returns `[]` for an empty selection
- [ ] `computeDishSubtotal(selections, dishes)` returns `0` for an empty selection, skips unresolvable `dishId`s without throwing
- [ ] Zero imports from `@/lib/prisma` or `next/*` in this file (type-only imports of `Dish`/`DishIngredient` from `@prisma/client` are fine)

**Estimated Complexity**: Medium — the core business logic of the entire feature lives here;
correctness of the merge/skip semantics is the highest-risk pure-logic surface per the TDD's own
Testing Strategy priority order.

---

### BE-004 · Add `mergeDuplicateIngredients` pure helper to `src/lib/recipe.ts`
**Category**: Backend · **Phase**: 1 · **Dependencies**: BE-003

**Description**: Add a pure function that sums `quantityPerDish` for duplicate `inventoryItemId`
entries within a single dish's proposed recipe input, before `createDish`/`updateDish` write it.
Without this, an admin accidentally picking the same ingredient twice would throw an unhandled
`P2002` (violating `@@unique([dishId, inventoryItemId])`) instead of being silently summed, per the
TDD's Edge Cases section.

**Technical Notes**: The TDD states this requirement in prose ("`createDish`/`updateDish` must sum
`quantityPerDish` for duplicate `inventoryItemId` entries before writing, defensively") but does not
specify its exact shape or module location. This task places it in `src/lib/recipe.ts` alongside
`expandDishesToIngredients`/`computeDishSubtotal` rather than inlining it into the `"use server"`
bodies of `createDish`/`updateDish`, consistent with this feature's testability requirement — the
TDD's own Testing Strategy explicitly lists "createDish/updateDish duplicate-ingredient summing
behavior" as a P5 test target, which is only cleanly unit-testable as a standalone exported
function. **Flagged**: this is a planner-added implementation detail, not literal TDD text — see
Open Questions.

**Definition of Done**:
- [ ] A pure function (e.g. `mergeDuplicateIngredients(ingredients: { inventoryItemId: string; quantityPerDish: number }[])`) is exported from `src/lib/recipe.ts`
- [ ] Two entries with the same `inventoryItemId` collapse into one entry with summed `quantityPerDish`
- [ ] Input with no duplicates passes through with no data loss
- [ ] Zero Prisma/Next.js imports, same testability bar as BE-003

**Estimated Complexity**: Low — small, self-contained pure function.

---

### BE-005 · Extend `prisma/seed.ts` with `Dish`/`DishIngredient` fixtures and FK-safe cleanup ordering
**Category**: Backend · **Phase**: 1 · **Dependencies**: BE-002

**Description**: Extend the existing wipe-and-repopulate seed script to also create 4-6 realistic
dishes (e.g. Jollof Rice, Fried Rice, Meat Pie, Waakye, Banku & Tilapia) with recipes built from
already-seeded `InventoryItem` rows, per the TDD's Rollout Plan. The script's cleanup section must
also be reordered so it doesn't hit a foreign-key error against the two new child tables.

**Technical Notes**: Current cleanup order is `orderIngredientLog → order → user → inventoryItem`
(`prisma/seed.ts:7-10`). With `DishIngredient` referencing `Dish` + `InventoryItem`, the new order
must delete children before their parents: `orderIngredientLog.deleteMany()` →
`dishIngredient.deleteMany()` → `order.deleteMany()` → `dish.deleteMany()` → `user.deleteMany()` →
`inventoryItem.deleteMany()`. Create dishes via `prisma.dish.create({ data: { name, price,
ingredients: { create: [...] } } })` (nested write) after `inventoryItems` is populated and
queryable, mirroring the existing pattern of looking up already-created rows. This task does not
need to touch `OrderDish` — see the Proactively Suggested Tasks section for optionally wiring
seeded orders to dishes.

**Definition of Done**:
- [ ] `npx prisma db seed` runs to completion with zero errors against a freshly-pushed schema
- [ ] Re-running the seed script a second time in a row still succeeds (proves FK-safe cleanup ordering)
- [ ] At least 4 `Dish` rows exist after seeding, each with at least 2 `DishIngredient` rows referencing real seeded `InventoryItem` rows
- [ ] `/admin/menu` (once built) shows non-empty seeded dish data rather than an empty table

**Estimated Complexity**: Low — mechanical fixture work, but must get FK ordering right or local dev breaks entirely.

---

## Phase 2: Core Logic

### BE-006 · Create `src/app/admin/menu/actions.ts` with `getDishes()`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Create the new Server Actions file for the Menu screen and implement its first,
read-only action: `getDishes()`, returning every dish (active and archived) with its recipe and
each recipe line's `InventoryItem`, ordered by name — mirroring `getInventoryItems()`'s shape.

**Technical Notes**: `include: { ingredients: { include: { inventoryItem: true } } }`,
`orderBy: { name: 'asc' }`. Return type matches the TDD's stated signature:
`(Dish & { ingredients: (DishIngredient & { inventoryItem: InventoryItem })[] })[]`. File starts
with `"use server"`, matching every other `actions.ts` in this repo.

**Definition of Done**:
- [ ] `src/app/admin/menu/actions.ts` exists, starts with `"use server"`
- [ ] `getDishes()` returns all dishes (both `isActive: true` and `false`) ordered by name, each with `ingredients` and each ingredient's `inventoryItem` populated
- [ ] Return type matches the TDD's stated signature (no `any`)

**Estimated Complexity**: Low — single read query, no transaction, no business logic.

---

### BE-007 · Add `createDish()` to `src/app/admin/menu/actions.ts`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-004, BE-006

**Description**: Implement `createDish`, creating a `Dish` and its full `DishIngredient` recipe
together inside one `prisma.$transaction`, using `mergeDuplicateIngredients` to defensively collapse
accidental duplicate ingredient selections before insert.

**Technical Notes**: Signature per TDD: `data: { name: string; price: number; ingredients: {
inventoryItemId: string; quantityPerDish: number }[] } → Promise<Dish>`. Transaction body:
`tx.dish.create` then `tx.dishIngredient.createMany` with the deduped list (run through
`mergeDuplicateIngredients` from BE-004 first). Call `revalidatePath('/admin/menu')` after,
matching every other `actions.ts` mutation in this repo.

**Definition of Done**:
- [ ] `createDish(data)` creates one `Dish` row and N `DishIngredient` rows atomically
- [ ] Two ingredient rows with the same `inventoryItemId` and different quantities produce exactly one `DishIngredient` row with the summed quantity (no `P2002`)
- [ ] `revalidatePath('/admin/menu')` called on success
- [ ] Function exported and callable from `MenuClient.tsx`

**Estimated Complexity**: Medium — first write path for the new domain; transaction correctness matters.

---

### BE-008 · Add `updateDish()` to `src/app/admin/menu/actions.ts`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-004, BE-007

**Description**: Implement `updateDish`, updating a dish's name/price and, if a new `ingredients`
array is supplied, replacing its entire recipe (delete-all-then-recreate) inside one transaction —
the same "replace-whole-child-set" shape `updateOrderIngredients` already uses today for
`OrderIngredientLog`.

**Technical Notes**: `updateDish(id, data: { name?, price?, ingredients?: {...}[] })`. If
`data.ingredients` is provided: `tx.dishIngredient.deleteMany({ where: { dishId: id } })` then
`tx.dishIngredient.createMany(...)` with the deduped set (reuse `mergeDuplicateIngredients`).
Always `tx.dish.update({ where: { id }, data: { name, price } })` for scalar fields.
`revalidatePath('/admin/menu')` after.

**Definition of Done**:
- [ ] Updating only `name`/`price` (no `ingredients` key) leaves existing `DishIngredient` rows untouched
- [ ] Supplying a new `ingredients` array fully replaces the old recipe with no leftover rows
- [ ] Duplicate `inventoryItemId` entries in the new recipe are summed, not rejected with `P2002`
- [ ] `revalidatePath('/admin/menu')` called on success

**Estimated Complexity**: Medium — delete-then-recreate transaction correctness is the main risk; directly parallels an already-proven existing pattern.

---

### BE-009 · Add `deleteDish()` to `src/app/admin/menu/actions.ts`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-006

**Description**: Implement `deleteDish`, hard-deleting a dish and its recipe if never referenced by
an order, or archiving it (`isActive: false`) if it has been — per Decision #5's conditional
deletion design. Returns `{ archived: boolean }` so the calling UI can show differentiated feedback.

**Technical Notes**: Check `orderDish.count({ where: { dishId: id } })`; if `0`, hard-delete inside
a transaction: `tx.dishIngredient.deleteMany({ where: { dishId: id } })` then
`tx.dish.delete({ where: { id } })`; otherwise `prisma.dish.update({ where: { id }, data: {
isActive: false } })`, returning `{ archived: true }`. `revalidatePath('/admin/menu')` in both
branches.

**Definition of Done**:
- [ ] Deleting a dish with zero `OrderDish` references hard-deletes its `DishIngredient` rows and the `Dish` row, returns `{ archived: false }`
- [ ] Deleting a dish with one or more `OrderDish` references sets `isActive: false` instead, returns `{ archived: true }`
- [ ] `revalidatePath('/admin/menu')` called in both branches
- [ ] No `P2003` is possible from this function for a referenced dish (archive branch never attempts delete)

**Estimated Complexity**: Medium — conditional branching + transaction correctness; the trickiest part of the Dish CRUD surface.

---

### BE-010 · Add `toggleDishActive()` to `src/app/admin/menu/actions.ts`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-006

**Description**: Implement `toggleDishActive(id, isActive)`, a simple manual archive/restore action
so the owner can hide a dish seasonally (e.g. a Christmas special) without deleting it, independent
of `deleteDish`'s conditional logic.

**Technical Notes**: `prisma.dish.update({ where: { id }, data: { isActive } })`,
`revalidatePath('/admin/menu')`. No transaction needed (single-row, single-field update).

**Definition of Done**:
- [ ] `toggleDishActive(id, false)` sets `isActive: false` on the target dish only
- [ ] `toggleDishActive(id, true)` restores `isActive: true`
- [ ] `revalidatePath('/admin/menu')` called
- [ ] Function exported and wired to a UI control once FE-004 lands

**Estimated Complexity**: Low — single-field update, no transaction, no branching.

---

### BE-011 · Extend `getOrders()` to include the `dishes` relation
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Add `dishes: true` to `getOrders()`'s existing `include` in
`src/app/admin/orders/actions.ts`, alongside `customer` and `ingredientLogs`, so every order fetched
for the Orders table carries its `OrderDish[]` snapshot rows.

**Technical Notes**: This has no visible UI effect today (no "Dishes" column is being added to the
Orders table per the TDD's Frontend Changes), but it's required so the `OrderWithRelations` type
stays accurate across the app — including FE-007's optimistic local-state update — and lines up with
the TDD's stated future roadmap use (a "repeat this order" button referenced in the PRD's Goals).

**Definition of Done**:
- [ ] `getOrders()`'s `include` contains `customer: true`, `ingredientLogs: { include: { inventoryItem: true } }`, and `dishes: true`
- [ ] `/admin/orders` still renders with no regressions; legacy orders return `dishes: []`, not `undefined`

**Estimated Complexity**: Low — one-line `include` addition to an existing query.

---

### BE-012 · Rework `createOrder()` for dish-based creation
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-003, BE-011

**Description**: Replace `createOrder`'s `ingredients: {...}[]` parameter with
`dishes: { dishId: string; quantity: number }[]`, re-reading fresh `Dish`+`DishIngredient` data
inside the transaction, writing one `OrderDish` snapshot row per selected dish and one merged
`OrderIngredientLog`/stock-decrement per `InventoryItem` (via `expandDishesToIngredients`). This is
the core write path that makes dish-based order creation actually deduct correct, auditable
inventory.

**Technical Notes**: Follow the TDD's `createOrder` pseudocode closely, with one necessary
correction the TDD's own pseudocode comment glosses over: the existing low-stock-check loop (today:
`for (const ingredient of data.ingredients) { ... }`, run *after* the transaction commits) iterates
over the now-removed `data.ingredients` field — it cannot stay "unchanged... exactly as today" as
the TDD's comment literally claims, since that field no longer exists on the new signature. This
task must **(a)** have the `prisma.$transaction` callback return both the created order *and* the
computed `ingredientTotals` (e.g. `return { order: newOrder, ingredientTotals }` — today's callback
only returns `newOrder`), and **(b)** change the post-transaction low-stock-check loop to iterate
the returned `ingredientTotals` instead of `data.ingredients`. Always use `prisma.$transaction` when
touching `InventoryItem.currentStock` (already true here — reconfirm the decrement stays inside the
transaction). Skip any `sel.dishId` not found in `dishRecords` or with `sel.quantity <= 0`, per the
TDD's defensive-skip Edge Case. Keep the fire-and-forget `notifyOrderStatusChange` call and
`revalidatePath('/admin/orders')` unchanged.

**Definition of Done**:
- [ ] `createOrder`'s parameter type has `dishes: { dishId: string; quantity: number }[]` and no `ingredients` field
- [ ] Selecting 2 dishes sharing an ingredient produces exactly one merged `OrderIngredientLog` row for that ingredient with the summed quantity, and the correct net `currentStock` decrement
- [ ] Every selected dish produces one `OrderDish` row with `dishName`/`unitPrice` snapshotted from the DB-fresh `Dish` record, not client input
- [ ] A `dishId` that doesn't resolve against `dishRecords` (deleted/archived mid-submit) is skipped without throwing
- [ ] The post-transaction low-stock-check loop runs against the actual deducted items, not a reference to the removed `data.ingredients` field
- [ ] All `InventoryItem.currentStock` writes remain inside `prisma.$transaction`

**Estimated Complexity**: High — the highest-risk write path in the feature: transaction correctness, merge semantics, and a genuine gap in the TDD's own pseudocode all land here.

---

### BE-013 · Extend `deleteOrder()` to delete `OrderDish` rows (required exception)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Add `tx.orderDish.deleteMany({ where: { orderId: id } })` to `deleteOrder`'s
existing transaction, parallel to how it already deletes `OrderIngredientLog` rows before deleting
the `Order` row. This is a required, non-optional consequence of the schema change: without it,
deleting any order carrying dish line items throws a new, unhandled `P2003` — distinct from, and not
to be confused with, the pre-existing "cancel/delete doesn't restore stock" bug, which stays exactly
as deferred.

**Technical Notes**: Per the TDD's "Required, non-optional touch to existing `deleteOrder`" section.
Do **not** add stock restoration, do **not** add a `try/catch`, and do **not** add authorization —
those three gaps are explicitly out of scope. This is purely: add the missing `deleteMany` call so
the function stops crashing on a case the old schema couldn't produce.

**Definition of Done**:
- [ ] `deleteOrder(id)`'s transaction calls `tx.orderDish.deleteMany({ where: { orderId: id } })` before `tx.order.delete(...)`
- [ ] Deleting an order with one or more `OrderDish` rows succeeds with no `P2003`
- [ ] Deleting an order with zero `OrderDish` rows (legacy order) still succeeds exactly as before
- [ ] No stock-restoration logic, `try/catch`, or auth check was added — diff limited to the one `deleteMany` call

**Estimated Complexity**: Low — a single added line, but correctness-critical; the real risk is scope discipline (easy to over-fix while already in this function).

---

### BE-014 · Replace `updateOrderIngredients()` with `updateOrderItems()`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-003, BE-011

**Description**: Rename and extend `updateOrderIngredients` (in
`src/app/admin/orders/[id]/actions.ts`) into `updateOrderItems`, the single unified writer for both
dish selections and manually-added extra ingredients on the order-edit screen. It must revert old
inventory deductions, delete old `OrderIngredientLog`/`OrderDish` rows, re-read fresh dish data, and
reapply the new merged deduction — reusing the existing revert-then-reapply transaction body almost
verbatim.

**Technical Notes**: New signature: `updateOrderItems(orderId, data: { dishes: {dishId, quantity}[],
extraIngredients: {inventoryItemId, quantityUsed}[], totalPrice: number })`. Steps 1-2 (revert
increments + delete old `OrderIngredientLog`) are identical to today's logic — do not change that
part's semantics. Add `tx.orderDish.deleteMany({ where: { orderId } })` right after. Re-read fresh
`dishRecords` inside the transaction, re-create `OrderDish` rows with **current** `dishName`/
`unitPrice` — price is deliberately re-snapshotted at *edit* time, not carried over from the
original order (the TDD explicitly calls this an intentional judgment call, not a bug: creating an
order snapshots price once and never touches it again; re-saving an order's dish list re-snapshots
price every time it's saved). Call `expandDishesToIngredients(data.dishes, dishRecords,
data.extraIngredients)` (from BE-003) for the merged deduction list, apply decrements + new
`OrderIngredientLog` rows. Finally `tx.order.update({ where: { id: orderId }, data: { totalPrice:
data.totalPrice } })`. This is the *only* writer of `OrderIngredientLog`/`OrderDish` in the edit
flow — the TDD rejected a two-action split specifically to avoid two independent writers silently
clobbering each other. Coordinate with FE-010, which owns the one call site in
`OrderDetailsClient.tsx` — the old export name is being removed entirely.

**Definition of Done**:
- [ ] `updateOrderIngredients` is fully removed; `updateOrderItems(orderId, data)` is exported with the new merged signature
- [ ] Old `OrderIngredientLog` rows are reverted (stock incremented) and deleted before new ones are written
- [ ] Old `OrderDish` rows for the order are deleted before new ones are written
- [ ] Saving an edit with 2 dishes sharing an ingredient plus 1 extra manual ingredient line produces exactly one merged `OrderIngredientLog` row per distinct `InventoryItem`
- [ ] Calling `updateOrderItems` twice in a row on the same order nets out `currentStock` correctly — not double-deducted, not under-reverted
- [ ] `revalidatePath` for both the order-detail page and `/admin/inventory` is called, matching today's behavior

**Estimated Complexity**: High — the TDD's own Testing Strategy calls the revert-then-reapply
transaction "the highest-risk test in this feature"; getting the ordering right (revert → delete →
re-read → recreate → reapply) is the crux of this task.

---

## Phase 3: Integration & UI

### FE-001 · Build `src/app/admin/menu/page.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-006

**Description**: Create the Server Component entry point for the Menu screen, fetching dishes and
inventory items in parallel and passing both to `MenuClient` as props — matching `OrdersPage`'s
pattern of fetching cross-entity data server-side.

**Technical Notes**: `Promise.all([getDishes(), getInventoryItems()])`. `getInventoryItems()`
already exists and is importable the same way `OrdersPage` imports it today. Match either
`InventoryPage`'s (item-count subtitle) or `OrdersPage`'s (plain heading) existing header style —
either is acceptable; stay consistent with the one chosen.

**Definition of Done**:
- [ ] `src/app/admin/menu/page.tsx` exists as an `async` Server Component (no `"use client"`)
- [ ] Fetches `getDishes()` and `getInventoryItems()` via `Promise.all`
- [ ] Renders `<MenuClient initialData={dishes} inventory={inventory} />`
- [ ] Navigating to `/admin/menu` renders with no runtime error, even with zero dishes seeded

**Estimated Complexity**: Low — thin Server Component wrapper, directly copies an established pattern.

---

### FE-002 · Build `src/app/admin/menu/MenuClient.tsx` (table + create dialog + recipe builder)
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-001, BE-007

**Description**: Build the `"use client"` table component using TanStack Table v8 over `Dish[]`,
with columns for `shortId`, `name`, `price`, a truncated recipe summary, and an Active/Archived
badge, plus a "+ Add Dish" create dialog with a dynamic recipe builder (repeatable
ingredient-select + `quantityPerDish` input + remove row).

**Technical Notes**: Mirror `OrderClient.tsx`'s `selectedIngredients` dynamic-row pattern for the
recipe builder — same interaction shape, different data. Per the TDD's explicit design call, this
is **not** extracted into a shared component; the three existing screens already duplicate their
table JSX rather than sharing a `<DataTable>`, and this stays consistent with that grain. Style the
Active/Archived badge using `InventoryClient.tsx`'s `categoryColors`/inline-`oklch()` pattern, not a
new visual system. **Critical**: the "Add Dish" trigger must use
`<Button onClick={() => setIsOpen(true)}>`, never `<DialogTrigger render={<Button />}>` — the latter
is confirmed broken in this codebase (`AGENTS.md`; verified present at `OrderClient.tsx:129`,
`InventoryClient.tsx:186`, `CustomerClient.tsx:138` — do not propagate that bug into new code).
Since the Menu screen has no `/admin/menu/[id]` detail route (unlike Orders), table rows should not
be click-to-navigate.

**Definition of Done**:
- [ ] Table renders `shortId`, `name`, `price`, a truncated recipe summary, and an Active/Archived badge for every seeded dish
- [ ] "+ Add Dish" opens a dialog via `onClick={() => setIsOpen(true)}` (not `DialogTrigger render`)
- [ ] The recipe builder supports adding/removing an arbitrary number of ingredient rows before submit
- [ ] Submitting calls `createDish` and optimistically appends the result to local table state, closing the dialog
- [ ] Table rows are not clickable/navigable

**Estimated Complexity**: Medium — the most visually complex new component in this feature; dynamic-row state mirrors an existing pattern but is new code.

---

### FE-003 · Mount global `<Toaster />` provider
**Category**: Frontend · **Phase**: 3 · **Dependencies**: None

**Description**: Mount the existing, currently-unused `Toaster` component
(`src/components/ui/toast.tsx`) in the root component tree so `toast()` calls anywhere in the app
render visible notifications. This is a genuine gap discovered by reading the codebase: the toast
primitive exists but is imported by zero files today, and nothing renders `<Toaster />` (confirmed
via a full-tree grep for `toast`/`Toaster` usage).

**Technical Notes**: This is a prerequisite for FE-004, where `deleteDish`'s `{ archived: boolean }`
return value is meant to drive "the correct toast copy" per the TDD (line 73). Without this task,
that requirement is unimplementable — calling `toast()` with no `<Toaster />` mounted produces no
visible UI. Add `<Toaster />` inside `Providers` (`src/components/providers.tsx`) so it's available
on every route. This is the first real production usage of this primitive in the app — sanity-check
the exact call signature against `@base-ui/react/toast`'s types before assuming an API shape, since
it hasn't been exercised anywhere in this codebase yet.

**Definition of Done**:
- [ ] `<Toaster />` is rendered exactly once, at the root of the component tree
- [ ] Calling the exported `toast` manager from any client component during local dev visibly renders a toast
- [ ] No existing page's layout/styling is visibly broken by the addition

**Estimated Complexity**: Low — small addition, but first-time-use uncertainty in the exact Base UI toast API bumps it slightly above trivial.

---

### FE-004 · Add edit dialog + archive/restore + delete wiring to `MenuClient.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-002, FE-003, BE-008, BE-009, BE-010

**Description**: Add the actions column's Edit/Archive-toggle/Delete controls: a separate edit
dialog (seeded from the selected dish, same recipe-builder UI as create) wired to `updateDish`, an
archive/restore toggle wired to `toggleDishActive`, and a delete button wired to `deleteDish` that
shows differentiated toast copy based on the returned `{ archived: boolean }`.

**Technical Notes**: Mirror `CustomerClient.tsx`'s `editingCustomer` state pattern (a second,
separate `<Dialog>` keyed off `!!editingCustomer`/`onOpenChange`) rather than reusing the create
dialog's open state — the established two-dialog convention in this codebase for edit flows. For
delete, follow `InventoryClient.tsx`/`CustomerClient.tsx`'s `confirm()`-gated pattern (not
`OrderClient.tsx`'s un-gated one), given `deleteDish`'s conditional archive-vs-hard-delete behavior
is worth warning the admin about. After `deleteDish` resolves, show one toast if
`{ archived: true }` ("Dish archived — it's still referenced by past orders") and a different one
if `{ archived: false }` ("Dish deleted"). If the Base UI toast manager proves awkward to call from
an async client handler, an inline status message near the button (consistent with
`OrderDetailsClient.tsx`'s existing `isSaving` pattern) is an acceptable fallback — the requirement
is visibly differentiated feedback, not a specific mechanism.

**Definition of Done**:
- [ ] Clicking "Edit" opens a dialog pre-filled with that dish's current name/price/recipe
- [ ] Saving the edit dialog calls `updateDish` and updates the row in local table state without a full page reload
- [ ] The archive/restore toggle calls `toggleDishActive` and the row's badge updates immediately
- [ ] Deleting a dish with zero order references removes it from the table and shows a "deleted" toast; deleting a dish with order references keeps it (now Archived) and shows an "archived" toast
- [ ] Delete action is gated behind a `confirm()` prompt

**Estimated Complexity**: Medium — three distinct action flows in one component, plus the first real usage of the toast system.

---

### FE-005 · Add Menu entry to `Sidebar.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-001

**Description**: Add a `Menu` nav item to the `MANAGEMENT` section of the sidebar, between
`Inventory` and `Customers`, using the `UtensilsCrossed` icon.

**Technical Notes**: The sidebar (`src/components/layout/Sidebar.tsx`) is already a `"use client"`
component with a grouped `navItems` array (`OPERATIONS`/`MANAGEMENT`) and `usePathname`-based active
detection — confirmed by reading the current file, no restructuring needed. Insert
`{ name: 'Menu', href: '/admin/menu', icon: UtensilsCrossed, exact: false }` into the `MANAGEMENT`
section's `items` array between `Inventory` and `Customers`, and add `UtensilsCrossed` to the
existing `lucide-react` import line. `UtensilsCrossed` is confirmed present in this project's
installed `lucide-react` version (checked against `node_modules/lucide-react/dist/lucide-react.d.ts`).

**Definition of Done**:
- [ ] `Sidebar.tsx`'s `MANAGEMENT` section shows `Inventory`, `Menu`, `Customers` in that order
- [ ] The `Menu` link points to `/admin/menu` and uses the `UtensilsCrossed` icon
- [ ] Visiting `/admin/menu` highlights the `Menu` nav item as active via the existing logic

**Estimated Complexity**: Low — a two-line data change to an already-correctly-structured array.

---

### FE-006 · Update `orders/page.tsx` to fetch and pass the dish catalog to `OrderClient`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-006

**Description**: Extend `OrdersPage`'s `Promise.all` fetch to also call `getDishes()`, passing the
result as a new `dishes` prop to `OrderClient`, so the create-order dialog has a catalog to build
its picker from.

**Technical Notes**: Add `getDishes` to the existing `Promise.all([getOrders(), getCustomers(),
getInventoryItems()])` call in `src/app/admin/orders/page.tsx`, importing it from `../menu/actions`.
Keep `inventory` in the props too — still needed downstream by `[id]/page.tsx`'s flow, unrelated to
this change.

**Definition of Done**:
- [ ] `OrdersPage` fetches `getDishes()` alongside the existing three calls
- [ ] `<OrderClient ... dishes={dishes} />` prop is passed
- [ ] `/admin/orders` still renders with no regressions when zero dishes exist

**Estimated Complexity**: Low — one additional fetch + prop pass-through.

---

### FE-007 · Rework `OrderClient.tsx`'s create-order dialog to a dish-picker with auto-priced total
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-006, BE-012, BE-003

**Description**: Replace the create dialog's raw-ingredient picker with a dish-picker:
`selectedIngredients` state is replaced by `selectedDishes: { dishId: string; quantity: number }[]`,
`description` becomes optional, and every dish-row mutation recomputes the total price via
`computeDishSubtotal`. `handleAdd` calls the reworked `createOrder` with `dishes`.

**Technical Notes**: Dish-picker rows follow the exact same interaction shape as today's ingredient
rows (`<select>` + integer quantity `<Input type="number" min="1">` + remove button) — only the
underlying data and source array (`dishes.filter(d => d.isActive)` instead of `inventory`) change.
Remove the `description` input's `required` attribute; change its placeholder from "Order Details
(e.g. 40 meat pies, 20 drinks)" to "Notes (e.g. no pepper, extra meat pies, delivery instructions)".
Every add/remove/change-dish/change-quantity handler must inline-call
`computeDishSubtotal(selectedDishes, dishes)` and `setTotalPriceInput(...)` in the same handler — no
`useEffect`, matching this codebase's confirmed convention (none of the three existing `*Client.tsx`
files use `useEffect`). The `totalPrice` input stays a plain, always-editable controlled input;
typing into it directly overrides the last auto-computed value until the next dish-row change
resets it — this silent-overwrite behavior is the TDD's stated default (flagged in the TDD's own
Open Questions as worth a post-launch usability check, not a blocker here). Update the
`OrderWithRelations` type to include `dishes: OrderDish[]`, and update the post-`createOrder`
optimistic local-state update to append `dishes: []` alongside the existing `ingredientLogs: []`
placeholder.

**Definition of Done**:
- [ ] The create dialog's dish section lets the admin add/remove dish rows, each with a `<select>` of active dishes and an integer quantity input
- [ ] `description`'s `required` attribute is removed and its placeholder text is updated
- [ ] Adding, removing, or changing a dish row or its quantity updates `totalPrice` to `computeDishSubtotal(selectedDishes, dishes)` in the same event handler (no `useEffect`)
- [ ] Manually typing into `totalPrice` after dishes are selected is not immediately overwritten until the next dish-row change
- [ ] `handleAdd` calls `createOrder({ ..., dishes: selectedDishes.filter(d => d.dishId && d.quantity > 0) })` and no longer references `ingredients`/`selectedIngredients`
- [ ] Archived dishes never appear in the "add a dish" dropdown

**Estimated Complexity**: Medium-High — the largest single UI rewrite in this feature; touches state shape, form semantics, and live-computed derived state all at once.

---

### FE-008 · Update `orders/[id]/page.tsx` to include the `OrderDish` relation and fetch the dish catalog
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-002, BE-006

**Description**: Add `dishes: true` to the order-detail page's `prisma.order.findUnique` include
list (so `order.dishes` — this order's own `OrderDish[]` rows — is populated), and separately fetch
`getDishes()` for the "add a new dish" catalog picker, passing both down to `OrderDetailsClient`.

**Technical Notes**: Two distinct additions: **(1)** the raw `prisma.order.findUnique` call in
`src/app/admin/orders/[id]/page.tsx` needs `dishes: true` added to its `include` (`order.dishes`
already carries `dishName`/`unitPrice` — no further join needed for display); **(2)** separately
call `getDishes()` (from `../../menu/actions`) for the full active-dish catalog used by the "add a
new dish" row, exactly as `OrdersPage` does. Pass both as props: `order` (now including `.dishes`)
and a new `dishes` prop for the catalog.

**Definition of Done**:
- [ ] `order.dishes` (the per-order `OrderDish[]`) is populated on the fetched order object
- [ ] `getDishes()` is fetched and passed as a `dishes` prop, separate from `order.dishes`
- [ ] A legacy order with zero `OrderDish` rows loads with `order.dishes === []`, not `undefined`, and no runtime error

**Estimated Complexity**: Low — two additive fetch changes to an existing page.

---

### FE-009 · Add "Dishes Ordered" section to `OrderDetailsClient.tsx`, relabel ingredients "Extra Ingredients"
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-008

**Description**: Add a "Dishes Ordered" section using the same inline-edit UX the existing
"Ingredients Used" section already has (`isEditing` boolean, no `Dialog`), seeded from
`order.dishes`. Relabel the existing ingredients section "Extra Ingredients" in edit mode, keeping
its current pre-population from `order.ingredientLogs` for legacy orders untouched.

**Technical Notes**: Mirror the existing `ingredients`/`counter`/`isEditing` state trio exactly,
duplicated for a new `dishSelections` state seeded from
`order.dishes.map(d => ({ dishId: d.dishId, quantity: d.quantity, internalId: i }))`. Read-only view
shows "2× Jollof Rice, 1× Meat Pie" style rows rather than a flattened ingredient list — the PRD's
explicit requirement. For a legacy order with `order.dishes.length === 0`, render an empty-state
message analogous to "No ingredients logged for this order.", not a blank/broken section. **Edge
case requiring explicit handling**: the edit-mode dropdown for an *existing* dish row must still
show that row's dish as a selectable, already-selected option even if it's since been archived —
since the "add a new dish" default list only offers active dishes, build each row's `<option>` list
as `activeDishes` plus (if not already present) a synthetic option built from that row's own
`dishId`/`dishName` snapshot (already available on the `OrderDish` row, no extra fetch needed).

**Definition of Done**:
- [ ] A "Dishes Ordered" section renders below/beside "Ingredients Used", read-only view showing dish name × quantity per row, sourced from `order.dishes`
- [ ] A legacy order (`order.dishes.length === 0`) shows a graceful empty-state message, not a blank or crashing section
- [ ] Edit mode lets the admin add/remove/change dish rows and quantities, same interaction shape as existing ingredient rows
- [ ] The existing "Ingredients Used" section is relabeled "Extra Ingredients" in edit mode
- [ ] An existing `OrderDish` row referencing an archived dish still renders with a valid, non-blank selection in its edit-mode dropdown

**Estimated Complexity**: Medium-High — duplicates an existing state pattern into a second section plus a genuine edge case (archived-dish-in-dropdown) with no existing precedent in this codebase to copy from.

---

### FE-010 · Wire `OrderDetailsClient.tsx`'s Save button to the unified `updateOrderItems`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-009, BE-014

**Description**: Replace the Save button's `updateOrderIngredients(order.id, ingredients)` call with
`updateOrderItems(order.id, { dishes, extraIngredients, totalPrice })`, merging both the "Dishes
Ordered" state and the "Extra Ingredients" state into one payload, and apply the same
derived-with-override total-price behavior the create form uses.

**Technical Notes**: One `handleSave` filters and maps both `dishSelections` and `ingredients`
(Extra Ingredients) into the shape `updateOrderItems` expects, alongside the current `totalPrice`
input value. Total price on this screen should recompute via `computeDishSubtotal` on every
dish-row mutation, same as `OrderClient.tsx`'s create form (FE-007) — the admin can still override
by typing directly, same silent-overwrite-on-next-change behavior. Update the import from
`./actions` to `updateOrderItems` (the old `updateOrderIngredients` name no longer exists after
BE-014).

**Definition of Done**:
- [ ] A single "Save Changes" button calls `updateOrderItems(order.id, { dishes, extraIngredients, totalPrice })`
- [ ] No reference to `updateOrderIngredients` remains in this file
- [ ] Saving reverts old inventory deductions and applies new ones correctly (verified against BE-014's transaction)
- [ ] Total price auto-recomputes on dish-row changes and remains a plain editable input, matching FE-007's behavior

**Estimated Complexity**: Medium — mostly wiring, but correctness depends entirely on FE-009's state shapes and BE-014 being correctly implemented first.

---

## Phase 4: Integration Verification & Documentation

> **Scope note**: this phase deliberately contains no automated test-writing. Bootstrapping Vitest
> and authoring the layered unit/integration/component suite is explicitly a separate, later
> pipeline phase's responsibility. Every task above that touches recipe/pricing math (BE-003,
> BE-004) is already shaped as pure, dependency-free, exported functions specifically so that phase
> can start immediately without refactoring.

### INFRA-001 · Update `AGENTS.md`'s "Data Model (Quick Reference)" section
**Category**: Infrastructure & Config · **Phase**: 4 · **Dependencies**: BE-001

**Description**: Add `Dish`, `DishIngredient`, and `OrderDish` to `AGENTS.md`'s existing Data Model
Quick Reference block, which currently only documents `User`, `InventoryItem`, `Order`, and
`OrderIngredientLog`. Per this project's own `CLAUDE.md`, architectural/schema learnings belong in
`AGENTS.md` since it's the shared, tool-agnostic doc every coding agent reads.

**Technical Notes**: Follow the existing terse, field-list style already used for the other four
models. Also add a one-line addition to the Repository Layout tree under `src/app/admin/` showing
the new `menu/` directory, matching how `orders/`, `inventory/`, `customers/` are already listed.

**Definition of Done**:
- [ ] `AGENTS.md`'s Data Model Quick Reference includes `Dish`, `DishIngredient`, `OrderDish` with key fields, in the same terse style as the existing four models
- [ ] `AGENTS.md`'s Repository Layout tree mentions `src/app/admin/menu/`
- [ ] No other section of `AGENTS.md` is rewritten beyond these additive changes

**Estimated Complexity**: Low — documentation-only change, no code risk.

---

### INFRA-002 · Manual end-to-end verification checklist
**Category**: Infrastructure & Config · **Phase**: 4 · **Dependencies**: All Phase 1-3 tasks

**Description**: Since no automated test suite exists yet in this repo, perform and record a manual
verification pass covering the feature's highest-risk behaviors before considering the feature
done, per the TDD's own Testing Strategy priority list.

**Technical Notes**: This task is deliberately **not** about writing automated tests — it exists to
give the implementing engineer (and the next pipeline phase) a concrete, recorded confidence check
in the absence of a test suite. Checklist, derived directly from the TDD's Testing Strategy priority
order: (1) create a dish with a duplicate ingredient selection, confirm it's summed not rejected;
(2) create an order with 2 dishes sharing an ingredient, confirm one merged `OrderIngredientLog` row
and correct net stock decrement; (3) edit that order's dishes twice in a row, confirm stock nets out
correctly both times; (4) delete an order with dish line items, confirm no `P2003` crash; (5)
archive a dish referenced by an order, confirm the order's historical data is unchanged and the dish
no longer appears in the create-order picker; (6) open a pre-existing order and confirm its "Dishes
Ordered" section renders an empty state, not a crash; (7) edit an order whose dish was archived
after the order was placed, confirm the archived dish still shows correctly in that row's dropdown.

**Definition of Done**:
- [ ] All 7 checklist items are executed against a local dev environment and recorded (pass/fail) somewhere durable (e.g. a comment on the implementation PR, or an addendum to `docs/.pipeline-state.md`)
- [ ] Any failing item is fixed and re-verified before this task is marked complete
- [ ] No automated test files were created as part of this task

**Estimated Complexity**: Medium — not code, but requires disciplined manual execution across the feature's full surface area; skipping it defeats its purpose.

---

## Proactively Suggested Tasks

### BE-015 (Proactive) · Wire a subset of seeded orders to `OrderDish` rows in `prisma/seed.ts`
**Category**: Backend · **Dependencies**: BE-005, BE-007

**Description**: Beyond BE-005's dish/recipe fixtures, additionally wire 3-5 of the existing seeded
`Order` rows to real `OrderDish` selections (with correct `dishName`/`unitPrice` snapshots), so
local dev/demo data exercises both the new dish-based order-rendering path and the legacy
empty-`dishes`-array path side by side.

**Why this is easy to miss**: the TDD's Rollout Plan only explicitly asks for `Dish`/
`DishIngredient` fixtures "so local dev/demo data actually exercises the new model instead of
showing an empty Menu screen" — it doesn't mention `OrderDish`. Without this, every seeded order
will have `dishes: []`, meaning FE-009's new "Dishes Ordered" UI and its legacy-empty-state branch
would go completely unexercised by anyone just running `npm run supabase:start && npx prisma db
seed && npm run dev`. This directly serves PRD Goal #5 ("Historical trustworthiness") and User
Stories #2/#6 (seeing "2× Jollof Rice, 1× Meat Pie" on reopen) — without mixed seed data, a
reviewer or the business owner poking at a fresh local environment has no evidence this core
requirement works until someone manually creates a new order through the UI.

**Definition of Done**:
- [ ] At least 3 seeded orders have 1+ `OrderDish` rows with correctly snapshotted `dishName`/`unitPrice`
- [ ] At least 3 seeded orders remain with zero `OrderDish` rows (to keep the legacy-rendering path exercised too)

**Estimated Complexity**: Low — small addition to an already-planned seed task.

---

## Environment Variables Required

This feature introduces **no new environment variables**. It reuses existing Prisma/Supabase
connectivity (`DATABASE_URL`, `DIRECT_URL`) and the existing, pre-established low-stock alert path
(`ADMIN_ALERT_EMAIL`, already referenced by today's `createOrder` — unaffected by this feature's
changes beyond BE-012's required loop-source fix). No `.env.example` file was found in this
worktree to update; only `.env` (real, uncommitted secrets) is present.

| Variable | Description | Required | Example Value |
|---|---|---|---|
| _(none)_ | No new environment variables are introduced by this feature. | — | — |

---

## Open Questions

None of the items below block starting implementation — each has a stated default this plan
proceeds with — but several are worth a reviewer's attention before or during implementation:

1. **TDD pseudocode gap in `createOrder` (resolved in this plan, worth a sanity check)**: the TDD's
   `createOrder` pseudocode comment says the low-stock check is "unchanged... exactly as today," but
   that loop iterates `data.ingredients`, a field the same design removes from the function's
   signature. BE-012 resolves this by having the transaction return `ingredientTotals` alongside the
   order and iterating that instead — a necessary implementation detail the TDD didn't spell out.
   Worth a second pair of eyes during implementation review, since it's the one place this plan
   diverges from the TDD's literal pseudocode text (not its design intent).

2. **`mergeDuplicateIngredients` (BE-004) has no specified home in the TDD.** The TDD states the
   *requirement* (sum duplicate `inventoryItemId` entries before writing) but not where the logic
   should live. This plan places it in `src/lib/recipe.ts` as an exported pure function, purely to
   satisfy the orchestrator's testability directive and the TDD's own Testing Strategy (which lists
   this exact behavior as a named test target). If the implementing engineer prefers it inlined in
   `menu/actions.ts` instead, that's a minor deviation from this plan but not from the TDD, which
   never specified either way.

3. **The TDD assumes toast infrastructure exists for `deleteDish`'s differentiated messaging, but it
   verifiably does not.** `src/components/ui/toast.tsx` (a Base UI Toast wrapper) exists but is
   imported by zero files and never mounted anywhere in the component tree (confirmed via a
   full-tree grep). FE-003 adds a task to mount it globally as a prerequisite for FE-004. This is the
   first production usage of that primitive in the app — its exact call API hasn't been exercised
   anywhere in this codebase, so budget a little extra time for FE-003/FE-004 if the API surface
   turns out awkward from an async client handler (a documented inline-text fallback is provided in
   FE-004's Technical Notes).

4. **PRD Open Question #1** (should order *creation* eventually get a raw "Extra Ingredients"
   fallback, not just edit?) — default is no for v1, per both PRD and TDD. Not addressed by any task
   in this plan; `expandDishesToIngredients`'s optional `extraLines` parameter already supports
   adding this later with zero schema/transaction changes if revisited.

5. **PRD Open Question #2** (currency `$` display) — explicitly left untouched everywhere, including
   new screens, per both PRD and TDD. No task in this plan changes any `$` string.

6. **TDD's own Open Question** (should total-price auto-sync silently overwrite a manual override on
   every dish-row change, or require an explicit "Recalculate" action?) — this plan implements the
   TDD's stated default (silent auto-sync) in FE-007/FE-010, per the TDD's explicit instruction. Not
   a blocker; flagged by the TDD itself as worth a post-launch usability check with the business
   owner, not an engineering decision.

7. **Pre-existing gap, confirmed widened but not fixed**: deleting an `InventoryItem` referenced by a
   `DishIngredient` will throw the same unhandled `P2003` crash shape `deleteInventoryItem` already
   has today for items referenced by `OrderIngredientLog`. This plan does not touch
   `deleteInventoryItem` at all, per the hard constraint against fixing or worsening pre-existing
   gaps — flagging here only for visibility into the hardening-pass backlog, not as a task.

No conflicts were found between the PRD and TDD on any point relevant to task sequencing — the TDD's
seven scoping decisions all trace cleanly back to specific PRD goals/user stories, and the PRD's
explicit non-goals (no bulk import, no cost/margin analytics, no modifiers) are all correctly absent
from the TDD's design.
