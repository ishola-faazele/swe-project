# TDD/RFC: Order & Inventory Integrity + Authorization Hardening (Phase 0)

## Status
Draft

## Context & Motivation
See `docs/prd-integrity-hardening.md` for the user-facing framing. Technically, this phase closes
five confirmed gaps in `src/app/admin/{orders,orders/[id],inventory,customers}/actions.ts` and
`src/app/admin/layout.tsx`:

1. **No authorization inside any Server Action.** All ten mutation actions
   (`createOrder`, `updateOrderStatus`, `deleteOrder`, `updateOrderIngredients`,
   `createInventoryItem`, `updateInventoryItem`, `deleteInventoryItem`, `createCustomer`,
   `updateCustomer`, `deleteCustomer`) — plus the three read-only `get*` functions living in the
   same files, see below — are plain exported functions in `"use server"` files. Per Next.js's
   own docs, this means each one is an independently POST-able endpoint regardless of whether any
   UI links to it:

   > "Server Functions are not separate routes in this chain. They are handled as POST requests
   > to the route where they are used... Always verify authentication and authorization inside
   > each Server Function rather than relying on Proxy alone."
   > — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`

   > "Design your data access functions as secure primitives: validate inputs, check
   > authentication and authorization, and constrain return types to only what the caller needs."
   > — `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`

   `src/proxy.ts` and `src/utils/supabase/session.ts` only refresh the Supabase session cookie —
   they enforce nothing. The only existing check anywhere is `src/app/admin/layout.tsx`'s
   `if (!user) redirect('/login')`, which (a) only gates page renders, not the actions themselves,
   and (b) doesn't check role at all.

2. **`admin/layout.tsx` has a literal comment deferring role checks** ("we can add role checks
   here later"). Any authenticated user — admin or customer — currently reaches the full admin
   shell.

3. **Cancelling or deleting an order never restores inventory.** `updateOrderStatus` does a bare
   `prisma.order.update` with no special-casing of `CANCELLED`. `deleteOrder` deletes
   `OrderIngredientLog` rows and the `Order` with a code comment literally questioning whether
   stock should be restored — it isn't.

4. **Stock decrements are race-unsafe.** `createOrder` and `updateOrderIngredients` both call
   `tx.inventoryItem.update({ data: { currentStock: { decrement: n } } })` with no floor check.
   Two concurrent orders against the same low-stock item can both succeed, driving `currentStock`
   negative.

5. **No input validation, no error handling.** `package.json` has no zod/yup; there are zero
   `try {` blocks in any `actions.ts`. `Order.customer` (and `OrderIngredientLog.inventoryItem`)
   have no `onDelete` clause and therefore default to Prisma's `Restrict` behavior — deleting a
   customer or inventory item that has existing orders throws an unhandled
   `PrismaClientKnownRequestError` (code `P2003`) straight to the browser as a raw 500. **How
   these errors reach the client is itself a design decision with a documented, non-obvious
   answer in this Next.js version — see "Error-return shape" below.** An earlier draft of this
   TDD got that decision wrong (uniform `throw`); it has been corrected after verifying Next's
   own guidance, and the correction is called out explicitly rather than silently folded in, since
   it changes the client-side call-site contract materially.

This phase fixes all five without introducing any new screens, without enabling Next.js's
experimental `authInterrupts` flag, and without changing the schema's established "no
`onDelete` anywhere, clean up explicitly in `prisma.$transaction` app code" convention.

## Proposed Design

### New shared modules
Four small, flat modules under `src/lib/`, matching the project's existing flat-file convention
(`src/lib/prisma.ts`, `src/lib/utils.ts` — nesting only exists today for `notifications/`, which
has genuine fan-out logic across three files):

- **`src/lib/auth.ts`** — `getCurrentDbUser()`, `requireAdmin()`, `AuthError`. `requireAdmin()`
  still `throw`s. Authorization failures are treated as the "uncaught exception" class per
  Next.js's own error-handling model (see below) — they are not normal, expected operation, and
  throwing is both the framework's prescribed pattern and the only mechanism that makes an
  authorization check impossible to accidentally ignore at a call site.
- **`src/lib/errors.ts`** — `ActionError` (internal control-flow error, used to trigger a
  `prisma.$transaction` rollback and to carry a message + stable `code`), `ActionResult<T>` (the
  serializable success/failure union every mutating action now returns), `okResult()`,
  `toErrorResult()`.
- **`src/lib/inventory.ts`** — `decrementStockOrThrow(tx, inventoryItemId, quantity)`,
  `restoreStockForOrder(tx, orderId)`.
- **`src/lib/validation.ts`** — zod schemas for every mutating action's input.

Every one of the 10 mutating actions is modified in place (parameter shapes unchanged; return
type changes from a bare value to `ActionResult<T>`) to call these in a consistent order:
**auth (throws) → validate + business logic (in a try/catch that normalizes expected failures
into a return value) → revalidatePath → return.** The three read-only `get*` actions
(`getOrders`, `getInventoryItems`, `getCustomers`) get only the auth step — see "Read-only
actions" below.

#### `src/lib/auth.ts` — resolving the current admin (and the lockout fix)

```ts
import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { Role, type User } from '@prisma/client'

export class AuthError extends Error {}

/**
 * Resolves the Prisma User row for the currently authenticated Supabase session.
 *
 * IMPORTANT: src/app/auth/callback/route.ts only sets `id: user.id` (the Supabase auth UUID)
 * when it creates a brand-new Prisma User row. Any row that already existed at login time
 * (seeded via prisma/seed.ts, or created ahead of time via the admin's createCustomer action)
 * keeps its own Prisma-generated UUID — the callback promotes that row's `role` to ADMIN on
 * email match, but never reconciles its `id`. A lookup by `id` alone would then find nothing
 * for that user, and requireAdmin() would incorrectly treat the real business owner as
 * unauthenticated/unauthorized — an admin lockout. We resolve by id first (the common, correct
 * case for every row created after this fix), and fall back to a unique email match to cover
 * the pre-existing-row case. This does NOT fix the underlying id divergence (see "Follow-Up
 * Work" below) — it only prevents that divergence from locking anyone out.
 */
export async function getCurrentDbUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const byId = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (byId) return byId

  if (authUser.email) {
    return prisma.user.findUnique({ where: { email: authUser.email } })
  }
  return null
}

export async function requireAdmin(): Promise<User> {
  const dbUser = await getCurrentDbUser()
  if (!dbUser) {
    throw new AuthError('You must be signed in to do that.')
  }
  if (dbUser.role !== Role.ADMIN) {
    throw new AuthError('You do not have permission to do that.')
  }
  return dbUser
}
```

Note on scope: this app has exactly one admin role and no per-resource ownership model (single
business, single owner — confirmed in `AGENTS.md`). Unlike the multi-tenant `deletePost` example
in Next's own data-security guide (which additionally checks `post.authorId === session.user.id`),
a role check *is* the full authorization check here. Do not add a per-row ownership check — there
is no ownership dimension in this data model to check against.

#### `src/lib/errors.ts` — the expected/uncaught split, in code

```ts
import { Prisma } from '@prisma/client'
import { z } from 'zod'

export type ActionErrorCode =
  | 'VALIDATION'
  | 'INSUFFICIENT_STOCK'
  | 'NOT_FOUND'
  | 'FK_CONSTRAINT'
  | 'INVALID_TRANSITION'
  | 'UNKNOWN'

/**
 * Internal control-flow error for "expected" business failures. Thrown deliberately inside
 * business logic (often inside a prisma.$transaction callback, to trigger an automatic
 * rollback) and always caught at the top of the exported action before it can escape to the
 * client — see toErrorResult(). Never let this cross the 'use server' boundary unconverted.
 */
export class ActionError extends Error {
  constructor(message: string, public code: ActionErrorCode = 'UNKNOWN') {
    super(message)
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionErrorCode }

export function okResult<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

/** Converts a caught error into the client-facing ActionResult failure shape. */
export function toErrorResult(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof ActionError) {
    return { ok: false, error: err.message, code: err.code }
  }
  if (err instanceof z.ZodError) {
    return { ok: false, error: err.issues[0]?.message ?? 'Invalid input.', code: 'VALIDATION' }
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2003') {
      return {
        ok: false,
        error: 'This record is still referenced by other data and cannot be deleted.',
        code: 'FK_CONSTRAINT',
      }
    }
    if (err.code === 'P2025') {
      return { ok: false, error: 'That record no longer exists. It may have already been deleted.', code: 'NOT_FOUND' }
    }
  }
  // Genuinely unexpected: log server-side for diagnosis, never leak raw internals to the browser.
  console.error(err)
  return { ok: false, error: fallback, code: 'UNKNOWN' }
}
```

`AuthError` is a separate class, intentionally **not** handled by `toErrorResult` — `requireAdmin()`
is always called before any try/catch block in every action (see below), so it always propagates
as a rejected promise, never as an `ActionResult`.

#### `src/lib/inventory.ts` — the guarded decrement and the shared revert helper

```ts
import { Prisma } from '@prisma/client'
import { ActionError } from '@/lib/errors'

/**
 * Atomically decrements InventoryItem.currentStock, refusing to go below zero, inside an
 * existing interactive transaction. Must be called with the `tx` client from
 * prisma.$transaction(async (tx) => {...}) so that a rejection here rolls back everything else
 * done in the same transaction (e.g. the Order row and any earlier ingredient logs already
 * written in this call).
 */
export async function decrementStockOrThrow(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  quantityUsed: number
): Promise<void> {
  const result = await tx.inventoryItem.updateMany({
    where: { id: inventoryItemId, currentStock: { gte: quantityUsed } },
    data: { currentStock: { decrement: quantityUsed } },
  })

  if (result.count === 0) {
    const item = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } })
    if (!item) {
      throw new ActionError('One of the selected inventory items no longer exists.', 'NOT_FOUND')
    }
    throw new ActionError(
      `Not enough "${item.name}" in stock: have ${item.currentStock} ${item.unit}, need ${quantityUsed}.`,
      'INSUFFICIENT_STOCK'
    )
  }
}

/** Reverts every OrderIngredientLog row for an order back onto InventoryItem.currentStock. */
export async function restoreStockForOrder(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  const logs = await tx.orderIngredientLog.findMany({ where: { orderId } })
  for (const log of logs) {
    await tx.inventoryItem.update({
      where: { id: log.inventoryItemId },
      data: { currentStock: { increment: log.quantityUsed } },
    })
  }
}
```

**Why `updateMany` and not `update`.** Prisma's `update()` only accepts unique fields (e.g. `id`)
in its `where` clause — there is no way to express "and `currentStock >= quantityUsed`" as part of
an `update()` call. `updateMany()` accepts arbitrary filters and returns `{ count }` instead of
throwing when nothing matched, which is exactly the shape needed for a conditional guard.

**Why this is actually race-safe, not just "looks atomic".** Under PostgreSQL's default `READ
COMMITTED` isolation (Prisma's default for `$transaction`, and Postgres's own default), an
`UPDATE ... WHERE id = $1 AND currentStock >= $2` is a single statement that takes a row-level
lock on the target row before evaluating whether to write. If a second, concurrent transaction
issues the same statement against the same row, Postgres blocks the second transaction until the
first commits or rolls back — it does not let both proceed against a stale read of `currentStock`.
Once the first transaction commits, the second (previously blocked) `UPDATE` **re-evaluates its
`WHERE` clause against the newly committed row**, not the value it would have seen had it read
first. This is standard, documented Postgres `UPDATE` behavior under `READ COMMITTED`, not a
Prisma-specific guarantee — it's why the guard cannot be "checked" with a separate `SELECT` first
(that would reintroduce the race) and must be expressed as a single `WHERE`-guarded `UPDATE`.
Two concurrent order-creation transactions racing for the last 2kg of rice will serialize on this
statement: one succeeds, the other's `count` comes back `0` and it throws `ActionError('...',
'INSUFFICIENT_STOCK')` inside the transaction callback, causing its entire `$transaction`
(including the `Order` row it already created) to roll back. That `ActionError` is then caught by
the action's outer try/catch and converted into an `{ ok: false, code: 'INSUFFICIENT_STOCK' }`
result — it never becomes an unhandled rejection on the losing request.

### Error-return shape
**This is the section that changed after spec review, and it changes a load-bearing design
decision — read it before touching any call site.**

Next.js draws an explicit line between two error categories, and prescribes a different handling
strategy for each:

> "Expected errors are those that can occur during the normal operation of the application, such
> as those from server-side form validation or failed requests. These errors should be handled
> explicitly and returned to the client... For these errors, avoid using `try`/`catch` blocks and
> throw errors. Instead, model expected errors as return values."
> — `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`, under "Handling
> expected errors" / "Server Functions"

> "Uncaught exceptions are unexpected errors that indicate bugs or issues that should not occur
> during the normal flow of your application. These should be handled by throwing errors..."
> — same file, "Handling uncaught exceptions"

The reason this isn't just a style preference: Next.js **redacts thrown-error messages from the
server in production** before they reach the client.

> "During development, the `Error` object forwarded to the client will be serialized and include
> the `message` of the original error for easier debugging. However, this behavior is different
> in production to avoid leaking potentially sensitive details included in the error to the
> client... Errors forwarded from Server Components show a generic message with an identifier."
> — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`

Put together: if `createOrder` communicated "not enough rice — have 2kg, need 5kg" or
`deleteCustomer` communicated "this customer has 3 orders on file" by `throw`ing an `Error`, that
specific, actionable text would work in local development and then **silently degrade to a
generic message plus an opaque digest hash the moment this ships to production** — which directly
defeats scope item 5 and the PRD's success metric that these messages be "specific" and
"actionable." An earlier draft of this TDD specified a uniform `throw` for both business errors
and auth errors; that was wrong and is corrected here.

**The rule this phase follows:**

| Error class | Examples | Mechanism |
|---|---|---|
| Expected / business errors | Insufficient stock, deleting a customer/inventory item with existing orders, invalid input (zod), un-cancel attempted, editing a cancelled order's ingredients | Returned as `ActionResult<T>` — never thrown across the `'use server'` boundary |
| Uncaught / exceptional errors | Not authenticated, authenticated but not `ADMIN` | Thrown (`AuthError`) |

Auth failures stay in the `throw` bucket deliberately, not for symmetry but because:
- They are genuinely exceptional under Next's own definition — an unauthenticated or non-admin
  caller reaching a mutation action is either an attack path, a stale/expired session, or a bug,
  not "normal operation of the application."
- Throwing makes the check impossible to silently bypass. If auth were also modeled as a return
  value, a future call site that forgets its `if (!result.ok)` check would let an unauthorized
  mutation proceed past the check with no error at all. A thrown rejection cannot be "forgotten
  past" that way — the calling code stops.
- It is exactly the pattern in every one of Next's own authorization code samples
  (`throw new Error('Unauthorized')` in both `use-server.md` and `data-security.md`), and it is
  trivially and precisely assertable in Vitest as `await expect(action(...)).rejects.toThrow()`.
- Event handlers (every call site here is one — `onClick`, `onChange`, or a plain `action={fn}`
  handler, none of them use `useActionState`) are explicitly **not** covered by React error
  boundaries: "Error boundaries don't catch errors inside event handlers... catch the error
  manually... using `useState`... then update the UI to inform the user" (same
  `error-handling.md`). This is exactly what every call site below does with its outer
  `try { ... } catch (err) { ... }`.

**The `ActionResult<T>` type** (defined in `src/lib/errors.ts`, shown in full above):

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionErrorCode }
```

A stable `code` (not just a free-text `error` string) exists specifically so tests can assert on a
symbol instead of matching copy, and so call sites can branch on failure class without
string-matching, if a future screen ever needs to (e.g. highlighting the specific ingredient row
on `INSUFFICIENT_STOCK` — not built in this phase, but the `code` field is there so it's possible
without a breaking change later).

**Consequence for every existing call site — this is the single most likely way this
implementation goes wrong if under-specified, so it is spelled out concretely per file below.**
Every one of the 10 mutating actions used to return its success payload directly (an `Order`, an
`InventoryItem`, `void`, etc.), and all four `*Client.tsx` components push that return value
straight into local `useState` optimistically. Now every mutating action returns
`ActionResult<T>` instead. **If a call site is not updated to unwrap `result.data` after checking
`result.ok`, it will push the raw `{ ok: true, data: {...} }` (or, worse, the `{ ok: false, ...}`
shape) object into a state array where a bare model object is expected**, which breaks table
rendering at runtime (e.g. `row.original.shortId` becomes `undefined` because the real order is
nested one level deeper, under `.data`). This is not a hypothetical edge case — it is the default
outcome of leaving any one of the ten call sites unmodified. See "Frontend Changes" below for the
exact required change at every call site.

**Read-only actions (`getOrders`, `getInventoryItems`, `getCustomers`) throw, not return a
union.** These were not part of the original 10-action audit list, but they live in the same
`"use server"` files as the mutations and are therefore equally independently POST-able — and
they leak customer PII (email, phone) to any caller who can reach their action ID. Verified during
spec review that every caller of these three functions is itself already admin-gated:
`getOrders`/`getInventoryItems`/`getCustomers` are imported only by
`src/app/admin/{orders,inventory,customers}/page.tsx` and `src/app/admin/orders/[id]/page.tsx` —
all Server Components rendered under `admin/layout.tsx`'s role gate. The customer-facing
`src/app/dashboard/page.tsx` does **not** call any of them; it queries Prisma directly
(`prisma.user.findFirst`, `prisma.order.findMany`) scoped to the logged-in customer. So adding
`requireAdmin()` to all three breaks no legitimate non-admin path. Because these are pure reads
with exactly one failure mode (not authorized) and no "expected business error" to communicate,
they follow the auth rule above and simply throw:

```ts
export async function getOrders() {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return prisma.order.findMany({
    include: { customer: true, ingredientLogs: { include: { inventoryItem: true } } },
    orderBy: { createdAt: 'desc' },
  })
}
```
Same one-line addition to `getInventoryItems` and `getCustomers`. Their return shape is otherwise
completely unchanged.

## API Changes (Server Actions)
There is no REST/Route-Handler API surface for these mutations today, and this phase does not add
one — Server Actions remain the app's mutation interface, consistent with existing convention.
**No exported function parameter changes.** Every one of the 10 mutating actions keeps its
existing parameter shape. **Return types do change** for the 10 mutating actions (bare value →
`ActionResult<T>`) and for none of the 3 read-only actions (unchanged; they now just throw on
unauthorized access).

| Action | File | Change |
|---|---|---|
| `createOrder` | `orders/actions.ts` | + `requireAdmin()`, + zod (incl. ingredient-array max length), + `decrementStockOrThrow` per ingredient, + try/catch → `ActionResult<Order>` |
| `updateOrderStatus` | `orders/actions.ts` | + `requireAdmin()`, + zod (`OrderStatus` enum), + CANCELLED-transition handling via `restoreStockForOrder`, + reject un-cancel transitions, + try/catch → `ActionResult<OrderWithCustomer>` |
| `deleteOrder` | `orders/actions.ts` | + `requireAdmin()`, + `restoreStockForOrder` (conditional), + try/catch → `ActionResult<void>` |
| `updateOrderIngredients` | `orders/[id]/actions.ts` | + `requireAdmin()`, + zod (incl. max length), + reject edits on `CANCELLED` orders, + `decrementStockOrThrow` per new ingredient, + try/catch → `ActionResult<void>` |
| `createInventoryItem` | `inventory/actions.ts` | + `requireAdmin()`, + zod, + try/catch → `ActionResult<InventoryItem>` |
| `updateInventoryItem` | `inventory/actions.ts` | + `requireAdmin()`, + zod, + try/catch → `ActionResult<InventoryItem>` |
| `deleteInventoryItem` | `inventory/actions.ts` | + `requireAdmin()`, + pre-check `OrderIngredientLog` usage count, + try/catch → `ActionResult<void>` |
| `createCustomer` | `customers/actions.ts` | + `requireAdmin()`, + zod (contact-method refinement), + try/catch → `ActionResult<User>` |
| `updateCustomer` | `customers/actions.ts` | + `requireAdmin()`, + zod, + try/catch → `ActionResult<User>` |
| `deleteCustomer` | `customers/actions.ts` | + `requireAdmin()`, + pre-check `Order` count, + try/catch → `ActionResult<void>` |
| `getOrders` | `orders/actions.ts` | + `requireAdmin()` (throws; return shape unchanged) |
| `getInventoryItems` | `inventory/actions.ts` | + `requireAdmin()` (throws; return shape unchanged) |
| `getCustomers` | `customers/actions.ts` | + `requireAdmin()` (throws; return shape unchanged) |

### Database Changes
**None.** No new tables, columns, or indexes. This phase intentionally does not touch
`prisma/schema.prisma` — the `Restrict`-by-default FK behavior on `Order.customer` and
`OrderIngredientLog.inventoryItem` is the schema's established, deliberate convention ("no
`onDelete` anywhere, clean up explicitly in `prisma.$transaction` app code"), and this phase works
*with* that convention (explicit pre-checks + a `try/catch` safety net) rather than overriding it
with `onDelete: Cascade` or `SetNull`.

### Domain & Service Layer
Covered above (`src/lib/auth.ts`, `src/lib/errors.ts`, `src/lib/inventory.ts`,
`src/lib/validation.ts`). Representative full implementations:

```ts
// src/app/admin/orders/actions.ts — createOrder
export async function createOrder(data: {
  customerId: string
  description: string
  totalPrice: number
  dueDate?: Date | null
  ingredients: { inventoryItemId: string; quantityUsed: number }[]
}): Promise<ActionResult<Order>> {
  await requireAdmin() // throws AuthError — uncaught here, rejects the promise for the client

  let order: Order
  try {
    const input = createOrderSchema.parse(data)

    order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          customerId: input.customerId,
          description: input.description,
          totalPrice: input.totalPrice,
          dueDate: input.dueDate ?? null,
          status: 'PENDING',
        },
      })

      for (const ingredient of input.ingredients) {
        // Throws ActionError('...', 'INSUFFICIENT_STOCK') on insufficient stock. Because this
        // throw happens inside the $transaction callback, Prisma rolls back everything written
        // so far (including newOrder) before the error reaches the catch block below. The
        // ActionError here is internal control flow, not yet the client-facing contract.
        await decrementStockOrThrow(tx, ingredient.inventoryItemId, ingredient.quantityUsed)
        await tx.orderIngredientLog.create({
          data: {
            orderId: newOrder.id,
            inventoryItemId: ingredient.inventoryItemId,
            quantityUsed: ingredient.quantityUsed,
          },
        })
      }

      return newOrder
    })
  } catch (err) {
    // Converts the internal throw (or a ZodError, or a Prisma error) into the client-facing
    // ActionResult failure shape. Nothing below this point runs on failure.
    return toErrorResult(err, 'Could not create this order. Please try again.')
  }

  // Fire-and-forget notifications, unchanged, run after commit — never inside the transaction.
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } })
  if (customer) {
    notifyOrderStatusChange({ /* ...unchanged... */ }).catch(console.error)
  }
  for (const ingredient of data.ingredients) {
    const item = await prisma.inventoryItem.findUnique({ where: { id: ingredient.inventoryItemId } })
    if (item && item.minimumThreshold > 0 && item.currentStock <= item.minimumThreshold) {
      notifyLowStock({ /* ...unchanged... */ }).catch(console.error)
    }
  }

  revalidatePath('/admin/orders')
  return okResult(order)
}
```

```ts
// src/app/admin/orders/actions.ts — updateOrderStatus
export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<ActionResult<Order & { customer: User }>> {
  await requireAdmin()

  let order
  try {
    const parsedStatus = z.nativeEnum(OrderStatus).parse(status)

    order = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id } })
      if (!existing) throw new ActionError('Order not found.', 'NOT_FOUND')

      const enteringCancelled = parsedStatus === 'CANCELLED' && existing.status !== 'CANCELLED'
      const leavingCancelled = existing.status === 'CANCELLED' && parsedStatus !== 'CANCELLED'

      if (leavingCancelled) {
        throw new ActionError(
          'Cancelled orders cannot be reactivated. Create a new order instead.',
          'INVALID_TRANSITION'
        )
      }
      if (enteringCancelled) {
        await restoreStockForOrder(tx, id)
      }

      return tx.order.update({ where: { id }, data: { status: parsedStatus }, include: { customer: true } })
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this order.')
  }

  notifyOrderStatusChange({ /* ...unchanged... */ }).catch(console.error)
  revalidatePath('/admin/orders')
  return okResult(order)
}
```

```ts
// src/app/admin/orders/actions.ts — deleteOrder
export async function deleteOrder(id: string): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const parsedId = z.string().uuid().parse(id)
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: parsedId } })
      if (!order) throw new ActionError('Order not found.', 'NOT_FOUND')

      // Only restore stock if it hasn't already been restored by a prior CANCELLED transition.
      if (order.status !== 'CANCELLED') {
        await restoreStockForOrder(tx, parsedId)
      }

      await tx.orderIngredientLog.deleteMany({ where: { orderId: parsedId } })
      await tx.order.delete({ where: { id: parsedId } })
    })
  } catch (err) {
    return toErrorResult(err, 'Could not delete this order.')
  }

  revalidatePath('/admin/orders')
  return okResult(undefined)
}
```

`updateOrderIngredients` gains one guard beyond what was explicitly scoped: it must refuse to
edit ingredients on a `CANCELLED` order. This isn't scope creep — it's the direct corollary of
item 3's invariant. Once an order is cancelled, its stock has already been restored; running the
existing revert-then-reapply logic against it would erroneously deduct stock a second time for an
order that's supposed to be inert.

```ts
// src/app/admin/orders/[id]/actions.ts — updateOrderIngredients
export async function updateOrderIngredients(
  orderId: string,
  ingredients: { inventoryItemId: string; quantityUsed: number }[]
): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const input = updateOrderIngredientsSchema.parse({ orderId, ingredients })

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: input.orderId } })
      if (!order) throw new ActionError('Order not found.', 'NOT_FOUND')
      if (order.status === 'CANCELLED') {
        throw new ActionError('Cannot edit ingredients on a cancelled order.', 'INVALID_TRANSITION')
      }

      const existingLogs = await tx.orderIngredientLog.findMany({ where: { orderId: input.orderId } })
      for (const log of existingLogs) {
        await tx.inventoryItem.update({
          where: { id: log.inventoryItemId },
          data: { currentStock: { increment: log.quantityUsed } },
        })
      }
      await tx.orderIngredientLog.deleteMany({ where: { orderId: input.orderId } })

      for (const ing of input.ingredients) {
        if (ing.quantityUsed <= 0) continue
        // Guard runs AFTER the revert above, so it correctly checks against
        // (currentStock + oldQty), not the stale pre-revert value.
        await decrementStockOrThrow(tx, ing.inventoryItemId, ing.quantityUsed)
        await tx.orderIngredientLog.create({
          data: { orderId: input.orderId, inventoryItemId: ing.inventoryItemId, quantityUsed: ing.quantityUsed },
        })
      }
    })
  } catch (err) {
    return toErrorResult(err, "Could not update this order's ingredients.")
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/inventory')
  return okResult(undefined)
}
```

```ts
// src/app/admin/customers/actions.ts — deleteCustomer
export async function deleteCustomer(id: string): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const parsedId = z.string().uuid().parse(id)

    // Pre-check gives a specific, useful count instead of relying only on the P2003 catch below.
    // Small TOCTOU window (an order could be created between this count and the delete) is
    // accepted for a single-admin, low-concurrency tool; toErrorResult's P2003 branch is the
    // backstop if that race is ever hit.
    const orderCount = await prisma.order.count({ where: { customerId: parsedId } })
    if (orderCount > 0) {
      throw new ActionError(
        `Cannot delete this customer — they have ${orderCount} order${orderCount === 1 ? '' : 's'} on file. Delete or reassign those orders first.`,
        'FK_CONSTRAINT'
      )
    }

    await prisma.user.delete({ where: { id: parsedId } })
    revalidatePath('/admin/customers')
    return okResult(undefined)
  } catch (err) {
    return toErrorResult(err, 'Could not delete this customer. Please try again.')
  }
}
```

```ts
// src/app/admin/inventory/actions.ts — deleteInventoryItem (same pre-check pattern as deleteCustomer)
export async function deleteInventoryItem(id: string): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const parsedId = z.string().uuid().parse(id)
    const usageCount = await prisma.orderIngredientLog.count({ where: { inventoryItemId: parsedId } })
    if (usageCount > 0) {
      throw new ActionError(
        `Cannot delete this item — it is referenced by ${usageCount} order record${usageCount === 1 ? '' : 's'}. Historical orders keep a permanent link to the ingredients they used.`,
        'FK_CONSTRAINT'
      )
    }
    await prisma.inventoryItem.delete({ where: { id: parsedId } })
    revalidatePath('/admin/inventory')
    return okResult(undefined)
  } catch (err) {
    return toErrorResult(err, 'Could not delete this inventory item. Please try again.')
  }
}
```

`createInventoryItem`, `updateInventoryItem`, `createCustomer`, and `updateCustomer` follow the
identical shape (`requireAdmin()` → zod parse in a try block → `okResult(item)` on success →
`toErrorResult(err, fallback)` on failure) with no additional guards beyond validation, per the
table above.

**Zod schema notes:**
- `createOrderSchema.ingredients` and `updateOrderIngredientsSchema.ingredients` are capped with
  `z.array(ingredientInputSchema).max(50, 'An order cannot list more than 50 distinct ingredient
  lines.')`. 50 is not a real product constraint — the UI's manual "Add Ingredient" button and the
  seeded fixture data both imply single-digit-to-low-double-digit ingredient counts per order in
  practice. It exists purely as a sanity ceiling against a malformed or abusive payload reaching
  the ingredient-processing loop, per the peer-reviewer's request to close this gap now that it's
  cheap to add alongside the other validation work.
- `createCustomerSchema`/`updateCustomerSchema` must treat `""` (empty string) as "not provided,"
  not as invalid — `FormData.get(...)` always returns a string, never `null`/`undefined`, for a
  present-but-blank field, so `.optional()` alone (which only permits `undefined`) is insufficient;
  use a pattern like `z.string().trim().optional().transform(v => v || undefined)` per field, and
  a `.refine()` at the object level requiring at least one of `name`/`email`/`phone` to be
  non-empty — this also finally *enforces*, server-side, the "At least one contact method is
  required" text the UI already displays but never validated.

**`src/app/admin/layout.tsx`:**

```ts
import { AdminLayout } from '@/components/layout/AdminLayout'
import { createClient } from '@/utils/supabase/server'
import { getCurrentDbUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const dbUser = await getCurrentDbUser()
  if (!dbUser || dbUser.role !== 'ADMIN') redirect('/dashboard')

  return <AdminLayout>{children}</AdminLayout>
}
```

Sharing `getCurrentDbUser()` between the layout and `requireAdmin()` means the id-or-email
lockout fallback is defined in exactly one place.

### Frontend Changes
No new pages or components. Every call site that invokes one of the 10 mutating actions now
follows the same two-layer pattern, for the reasons laid out in "Error-return shape" above:

```
try {
  const result = await someAction(...)
  if (!result.ok) {
    alert(result.error)          // expected/business failure — specific, safe-to-show message
    return
  }
  // ...use result.data exactly where the old bare return value was used...
} catch (err) {
  // uncaught/exceptional failure (in practice: AuthError from requireAdmin()) — event handlers
  // are not covered by React error boundaries, so this must be caught manually here.
  alert(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
}
```

Applied concretely, per file, to every current call site:

**`OrderClient.tsx`** (3 call sites):

```tsx
// handleAdd — was: const newOrder = await createOrder({...}); setData([{ ...newOrder, ... }, ...])
async function handleAdd(formData: FormData) {
  const customerId = formData.get("customerId") as string
  const description = formData.get("description") as string
  const totalPrice = Number(formData.get("totalPrice"))
  const ingredients = selectedIngredients
    .filter(i => i.id && i.quantity > 0)
    .map(i => ({ inventoryItemId: i.id, quantityUsed: i.quantity }))

  try {
    const result = await createOrder({ customerId, description, totalPrice, ingredients })
    if (!result.ok) {
      alert(result.error)
      return
    }
    const c = customers.find(c => c.id === customerId)!
    setData([{ ...result.data, customer: c, ingredientLogs: [] }, ...data])
    setIsOpen(false)
    setSelectedIngredients([])
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not create this order.')
  }
}
```

```tsx
// status <select> onChange — was: await updateOrderStatus(...); setData(...)
onChange={async (e) => {
  const val = e.target.value as OrderStatus
  try {
    const result = await updateOrderStatus(info.row.original.id, val)
    if (!result.ok) {
      alert(result.error)
      return // controlled <select> reverts on its own — data state is simply left unchanged
    }
    setData(data.map(d => d.id === info.row.original.id ? { ...d, status: val } : d))
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not update this order.')
  }
}}
```

```tsx
// delete button onClick — was: await deleteOrder(...); setData(data.filter(...))
onClick={async () => {
  try {
    const result = await deleteOrder(info.row.original.id)
    if (!result.ok) {
      alert(result.error)
      return
    }
    setData(data.filter(i => i.id !== info.row.original.id))
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not delete this order.')
  }
}}
```

**`OrderDetailsClient.tsx`** (2 call sites):

```tsx
// handleSaveIngredients — was: await updateOrderIngredients(...); setIsEditing(false)
async function handleSaveIngredients() {
  setIsSaving(true)
  const payload = ingredients
    .filter(i => i.id && i.quantity > 0)
    .map(i => ({ inventoryItemId: i.id, quantityUsed: i.quantity }))

  try {
    const result = await updateOrderIngredients(order.id, payload)
    if (!result.ok) {
      alert(result.error)
      return
    }
    setIsEditing(false)
    // revalidatePath inside the action already re-renders this route in the same round trip
    // (per Next's Server Actions guide) — no explicit router.refresh() needed here, matching
    // existing behavior.
  } catch (err) {
    alert(err instanceof Error ? err.message : "Could not update this order's ingredients.")
  } finally {
    setIsSaving(false)
  }
}
```

```tsx
// status <select> onChange — was: await updateOrderStatus(...); router.refresh()
onChange={async (e) => {
  const val = e.target.value as OrderStatus
  try {
    const result = await updateOrderStatus(order.id, val)
    if (!result.ok) {
      alert(result.error)
      return
    }
    router.refresh()
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not update this order.')
  }
}}
```

**`InventoryClient.tsx`** (2 call sites):

```tsx
// handleAdd — was: const newItem = await createInventoryItem({...}); setData([...data, newItem])
async function handleAdd(formData: FormData) {
  const name = formData.get("name") as string
  const category = formData.get("category") as Category
  const currentStock = Number(formData.get("currentStock"))
  const unit = formData.get("unit") as string
  const thresholdStr = formData.get("minimumThreshold") as string
  const minimumThreshold = thresholdStr ? Number(thresholdStr) : null

  try {
    const result = await createInventoryItem({ name, currentStock, unit, minimumThreshold, category })
    if (!result.ok) {
      alert(result.error)
      return
    }
    setData([...data, result.data])
    setIsOpen(false)
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not create this inventory item.')
  }
}
```

```tsx
// delete button onClick — was: await deleteInventoryItem(...); setData(data.filter(...))
onClick={async () => {
  if (!confirm(`Delete "${info.row.original.name}"?`)) return
  try {
    const result = await deleteInventoryItem(info.row.original.id)
    if (!result.ok) {
      alert(result.error)
      return
    }
    setData(data.filter(i => i.id !== info.row.original.id))
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not delete this inventory item.')
  }
}}
```

**`CustomerClient.tsx`** (3 call sites):

```tsx
// handleAdd — was: const newItem = await createCustomer({...}); setData([{ ...newItem, ... }, ...])
async function handleAdd(formData: FormData) {
  const name = formData.get("name") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string
  try {
    const result = await createCustomer({ name, email, phone })
    if (!result.ok) {
      alert(result.error)
      return
    }
    setData([{ ...result.data, _count: { orders: 0 } }, ...data])
    setIsOpen(false)
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not create this customer.')
  }
}
```

```tsx
// handleEdit — was: const updatedItem = await updateCustomer(...); setData(prev => prev.map(...))
async function handleEdit(formData: FormData) {
  if (!editingCustomer) return
  const name = formData.get("name") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string
  try {
    const result = await updateCustomer(editingCustomer.id, { name, email, phone })
    if (!result.ok) {
      alert(result.error)
      return
    }
    setData(prev => prev.map(c => c.id === result.data.id ? { ...c, ...result.data } : c))
    setEditingCustomer(null)
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not update this customer.')
  }
}
```

```tsx
// delete button onClick — was: await deleteCustomer(...); setData(prev => prev.filter(...))
onClick={async () => {
  if (!confirm(`Delete customer #${info.row.original.shortId}?`)) return
  try {
    const result = await deleteCustomer(info.row.original.id)
    if (!result.ok) {
      alert(result.error)
      return
    }
    setData(prev => prev.filter(i => i.id !== info.row.original.id))
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not delete this customer.')
  }
}}
```

**Recommended, not required:** in both order-status `<select>` elements, disable the other
`<option>`s (or the whole control) once `status === 'CANCELLED'`, so the UI reflects the new
terminal-state rule directly instead of only surfacing it as a rejected-request alert after the
fact. This is a small, in-place tweak to a control this phase is already touching, not new
product surface.

No changes to shared API client types are needed beyond importing `ActionResult` — there is no
shared client-side type layer for these actions today (each `*Client.tsx` inlines its own inline
object types), and this phase does not introduce one beyond the single `ActionResult<T>` generic.

## Alternatives Considered

**1. Uniform `throw` for every failure, including business errors.** This was the design in the
initial draft of this TDD. **Rejected on review**: Next.js redacts a thrown `Error`'s message from
the client in production (see "Error-return shape," citing `error.md`), and Next's own
error-handling guide explicitly prescribes return values, not `throw`, for exactly this class of
error (`error-handling.md`, "Handling expected errors" → "Server Functions": *"avoid using
`try`/`catch` blocks and throw errors. Instead, model expected errors as return values."*). Had
this shipped as originally drafted, every specific error message this phase exists to add
(insufficient-stock detail, FK-referenced-delete detail) would have silently degraded to a generic
message in production — passing local testing and manual QA in development, then failing exactly
the users this phase is meant to help, in the one environment that matters. Corrected during spec
review before implementation began.

**2. Uniform `ActionResult` union for every failure, including auth.** Rejected — see the
"Auth failures stay in the `throw` bucket deliberately" reasoning under "Error-return shape."
Summary: auth failures are the "uncaught exception" class by Next's own definition, throwing makes
the check impossible to accidentally bypass at a call site, it matches every one of Next's own
authorization examples, and it is more precisely testable (`.rejects.toThrow()`).

**3. `forbidden()`/`unauthorized()` from `next/navigation` for authz failures.** These render a
proper 403/401 UI segment automatically. Rejected because both are marked `experimental` in this
Next.js version and require setting `experimental.authInterrupts` in `next.config` — an
explicit, out-of-bounds ask per this phase's constraints. Plain `throw new AuthError(...)`
achieves the same practical outcome (the action fails, the client sees why) without an
experimental flag.

**4. Fix the root-cause ID divergence in `auth/callback/route.ts` instead of adding a fallback in
`requireAdmin()`.** Reconciling a pre-existing Prisma `User.id` to match the Supabase auth UUID on
promotion would remove the need for the email-fallback lookup entirely. Rejected for this phase:
`User.id` is a foreign key target for `Order.customerId`, so changing it for a row that already
has orders is a real data migration (rewrite every referencing `Order.customerId`), not a
one-line fix, and carries its own risk of a botched migration causing *worse* lockout than the
bug it fixes. The email-fallback in `requireAdmin()`/`getCurrentDbUser()` fully neutralizes the
user-facing symptom (admin lockout) without touching foreign keys. Tracked as explicit follow-up
work below, not silently deferred.

## Edge Cases & Failure Modes
- **Concurrent order creation racing for the last unit of stock.** Handled by
  `decrementStockOrThrow`'s guarded `updateMany` inside the existing transaction — see "Why this
  is actually race-safe" above. One request resolves `{ ok: true, data: order }`; the other
  resolves `{ ok: false, code: 'INSUFFICIENT_STOCK' }` — note **both promises resolve, neither
  rejects**, since this is an expected/business error, not an exception. (This is a testable
  behavioral property, not just an implementation detail — see Testing Strategy.)
- **Cancelling an order twice (double-submit, slow network retry).** The `enteringCancelled`
  check (`parsedStatus === 'CANCELLED' && existing.status !== 'CANCELLED'`) makes cancellation
  idempotent: the second call is a no-op status update with no additional stock restored.
- **Deleting an order that was already cancelled.** `deleteOrder` only calls
  `restoreStockForOrder` `if (order.status !== 'CANCELLED')`, preventing a double-credit for
  orders that were cancelled before being deleted.
- **Editing ingredients on a cancelled order.** Explicitly rejected with `code: 'INVALID_TRANSITION'`
  — this is the same double-credit risk as the previous two cases, just reached through a
  different action.
- **Deleting a customer or inventory item with existing orders.** Pre-checked with a specific
  count-based message (`code: 'FK_CONSTRAINT'`); backstopped by `toErrorResult`'s `P2003` handling
  in case of a race between the check and the delete (accepted, low-probability for a single-admin
  tool with sequential client-side action dispatch — Next.js dispatches Server Actions one at a
  time per client).
- **Admin lockout via Prisma/Supabase ID divergence.** Covered explicitly by
  `getCurrentDbUser()`'s id-then-email resolution. Must be covered by a dedicated regression test
  (seed a `User` row with a Prisma-generated `id` that differs from a mock Supabase auth UUID
  sharing its email, and assert `requireAdmin()` still resolves and authorizes it).
- **Non-UUID or malformed IDs from a tampered/direct POST.** Caught by `z.string().uuid().parse()`
  before hitting Prisma, surfacing as `{ ok: false, code: 'VALIDATION' }` instead of an empty
  `findUnique`/no-op `delete` or a raw Prisma error.
- **Pathologically large ingredient lists in a single order.** Guarded by
  `z.array(ingredientInputSchema).max(50, ...)` on both `createOrderSchema` and
  `updateOrderIngredientsSchema` — see the zod schema notes above for the rationale on the bound.
- **Transaction partial-failure on ingredient N of M during `createOrder`.** Because
  `decrementStockOrThrow` throws `ActionError` inside the `prisma.$transaction(async (tx) =>
  {...})` callback, Prisma automatically rolls back every write made so far in that callback — the
  `Order` row itself included. There is no code path that leaves an `Order` row with only some of
  its `OrderIngredientLog` rows written.
- **A call site left unmodified (not unwrapping `ActionResult`).** Called out explicitly in
  "Error-return shape" and demonstrated concretely for every one of the 10 call sites in "Frontend
  Changes" — this is flagged as the single most likely implementation mistake for this phase, not
  a theoretical concern, precisely because it's a silent runtime failure (a garbage object landing
  in a `useState` array) rather than a compile error, given these components' inline object types.
- **Read-only `get*` actions were unauthenticated; now they are not.** Verified during spec review
  that all three callers are exclusively admin-gated Server Components — see "Read-only actions"
  above — so this closes a real PII-exposure gap with zero risk to the customer dashboard path.

## Security Considerations
- **Authorization, not just authentication, on every mutation and every read of admin data.**
  `requireAdmin()` checks both "is there a session" and "does that session's Prisma role equal
  `ADMIN`" — a customer with a valid, logged-in session is still rejected. This now covers all 10
  mutations and all 3 admin-only reads.
- **CSRF.** Already covered by Next.js's built-in Server Action protections (Origin/Host header
  comparison, POST-only invocation) — no additional work needed or proposed here.
- **No secrets or raw internals leak through errors.** `toErrorResult`'s fallback path
  `console.error`s the real error server-side and returns only a fixed, safe fallback string to
  the client for anything that isn't a recognized `ActionError`/`ZodError`/known Prisma error
  code. Raw Prisma/Postgres error text (which can include column/table names) never reaches the
  browser. This holds regardless of the production error-redaction behavior discussed above,
  because `ActionResult.error` is a plain returned string, not a thrown `Error` object — it is
  never subject to that redaction path in the first place, which is a second, independent reason
  (beyond message-preservation) to prefer return values for these messages.
- **Input validation is a defense, not the authorization boundary.** Per the Next.js data-security
  guide's IDOR warning, a well-formed payload can still refer to a row the caller shouldn't touch
  — zod here only validates *shape*, not ownership. This app's flat, single-admin authorization
  model (see `src/lib/auth.ts` notes) means there is no ownership dimension beyond role, so this
  is a lower-stakes gap here than in a multi-tenant app, but it's worth stating explicitly rather
  than assuming zod alone is "the fix."
- **PII exposure via unauthenticated `get*` reads — closed, not just flagged.** `getCustomers` in
  particular returns email/phone for every customer; this is now gated by `requireAdmin()` as a
  mandatory part of this phase (see "Read-only actions" above), not deferred.
- **No rate limiting is introduced.** Out of scope for this phase; flagged only because
  `deleteCustomer`/`deleteInventoryItem`'s pre-check-then-delete pattern does two round trips per
  call, which is a mild amplification target if this app were ever exposed to untrusted traffic
  at volume — not a realistic concern for a single-admin tool today.

## Testing Strategy
Vitest is the chosen framework for this phase (per project direction; a parallel branch is
independently bootstrapping Vitest too — duplicate config across branches is expected and will be
reconciled at merge time, not a defect in either branch).

**Unit tests (pure logic, no real database required):**
- `decrementStockOrThrow`: succeeds and decrements when stock is sufficient; throws `ActionError`
  with `code: 'INSUFFICIENT_STOCK'` and the item name/have/need in the message when insufficient;
  throws `code: 'NOT_FOUND'` when the item doesn't exist. Exercise against a mocked
  `Prisma.TransactionClient` (mock `updateMany` returning `{count: 0}` / `{count: 1}`).
- `restoreStockForOrder`: increments every referenced `InventoryItem` by its logged
  `quantityUsed`, once per log row.
- `toErrorResult`: correctly maps `ZodError` → `code: 'VALIDATION'`,
  `PrismaClientKnownRequestError` `P2003` → `code: 'FK_CONSTRAINT'`, `P2025` →
  `code: 'NOT_FOUND'`, a pass-through `ActionError` → its own code/message, and an arbitrary
  unknown error → `{ ok: false, code: 'UNKNOWN', error: <fallback> }` (and confirms this last
  branch does not leak the original error's message into the returned string).
- `getCurrentDbUser` / `requireAdmin`: with a mocked Supabase client and a mocked Prisma client,
  cover (a) no session → `null` / `AuthError`, (b) session with matching Prisma `id` → resolves
  directly, (c) session with no `id` match but a matching `email` → resolves via fallback (the
  lockout regression case), (d) resolved user with `role !== ADMIN` → `AuthError`. Assert via
  `await expect(requireAdmin()).rejects.toThrow(AuthError)` for the negative cases.

**Integration tests (real local Postgres/Supabase, per project convention — no mocked Prisma for
transaction-level behavior):**
- For **all 13 hardened actions** (10 mutations + `getOrders`/`getInventoryItems`/`getCustomers`):
  an unauthenticated call rejects (`.rejects.toThrow()`); a call from an authenticated
  `CUSTOMER`-role session rejects; a call from an authenticated `ADMIN` session succeeds. This is
  the direct verification of the PRD's primary success metric.
- **Expected-error paths return values, not rejections**, for every mutation: insufficient stock,
  deleting a customer/inventory item with attached orders, malformed input, an attempted un-cancel
  transition, and editing a cancelled order's ingredients should all resolve to
  `{ ok: false, code, error }` — assert with `await expect(action(...)).resolves.toMatchObject({
  ok: false, code: '...' })`, explicitly **not** `.rejects`.
- **Cancellation idempotency:** create an order with known ingredient quantities, record
  `currentStock` before, cancel it, assert stock is restored; cancel it again, assert stock is
  unchanged on the second call.
- **Delete-after-cancel:** cancel an order, then delete it; assert stock is not double-restored.
- **Delete-without-cancel:** create an order, delete it directly (no prior cancellation); assert
  stock is restored exactly once.
- **Un-cancel rejection:** attempt to move a `CANCELLED` order to any active status; assert
  `{ ok: false, code: 'INVALID_TRANSITION' }` and that the order remains `CANCELLED`.
- **Concurrency:** seed an inventory item with stock for exactly one of two simultaneous orders
  each requesting the full amount; fire both `createOrder` calls concurrently via `Promise.all`
  (not `Promise.allSettled` — neither call should reject) against the real database; assert
  exactly one result has `ok: true` and the other has `ok: false, code: 'INSUFFICIENT_STOCK'`, and
  final `currentStock` is not negative.
- **FK-guarded deletes:** attempt `deleteCustomer`/`deleteInventoryItem` on a record with
  attached orders; assert `{ ok: false, code: 'FK_CONSTRAINT' }` with the expected count-based
  message, not an unhandled exception.
- **Admin-lockout regression:** seed a `User` row with a Prisma-generated `id` and a known email,
  simulate a Supabase session for that same email with a *different* auth UUID, and assert
  `requireAdmin()` still resolves and authorizes correctly via the email fallback.

**Manual QA (documented, not automated, for this phase):**
- Confirm a non-admin authenticated browser session redirected from `/admin` lands on
  `/dashboard`, not a blank page or an error.
- Confirm, in a production build (`next build && next start`), that an `ActionResult.error`
  string for an expected failure (e.g. trigger insufficient stock) appears exactly as authored —
  this should hold by construction, since it's a plain returned string, not a thrown `Error`, but
  is worth one manual confirmation since it's the entire point of this phase's error design.
- Confirm, in the same production build, what an `AuthError`'s message looks like when it
  reaches an event-handler `catch` block (trigger it by calling an action from a non-admin
  session). If Next.js's production redaction *does* apply to Server Action throws the same way
  it applies to render errors, the specific "You do not have permission to do that." text may come
  back generic — this is an acceptable outcome for this phase (see "Error-return shape": auth
  failures are not expected to need a specific message, only to reliably stop the mutation), but
  should be confirmed rather than assumed either way.

## Rollout Plan
- **No feature flag.** This is a correctness/security fix to existing, already-shipped behavior;
  gating it behind a flag would mean deliberately choosing to ship known auth gaps and data-
  integrity bugs to some subset of traffic, which isn't an acceptable trade-off for a single-
  environment, single-tenant app with no meaningful canary population.
- **No data migration.** No schema changes in this phase (see Database Changes).
- **Pre-deploy check:** before merging, run the full integration suite above against a fresh
  `prisma db push` + `prisma db seed` local database to confirm no regressions against seeded
  fixture data (10 customers, 20 inventory items, 15 orders per `prisma/seed.ts`).
- **Rollback plan:** since there are no schema or data changes, rollback is a plain revert of the
  application code (`git revert` / redeploy the previous build). No compensating data cleanup is
  needed because no destructive migration ran.
- **Post-deploy verification:** run `SELECT * FROM "InventoryItem" WHERE "currentStock" < 0;`
  against the production database once to confirm no pre-existing negative-stock rows linger from
  before this fix (this phase prevents *new* negative stock; it does not retroactively correct
  any that may already exist from the current race-unsafe code path). If any are found, they need
  a manual, one-time correction — not something this phase's code changes will silently fix.

## Follow-Up Work (Explicitly Out of Scope for This Phase)
Tracked here rather than silently dropped once their immediate symptoms are mitigated:
- **Root-cause ID reconciliation in `auth/callback/route.ts`.** The email-fallback lookup in
  `getCurrentDbUser()` is an accepted, permanent-for-now mitigation, not a fix — see Alternative 4
  above for why a real fix (migrating `Order.customerId` foreign keys) is a separate, riskier
  effort deliberately not undertaken here.
- **Inventory "soft delete" / archival.** Under this design, any inventory item ever used in an
  order becomes permanently non-deletable (its `OrderIngredientLog` rows keep it FK-referenced
  forever). If the business owner needs to retire an ingredient she no longer stocks, a future
  phase would need an `isActive`-style soft-delete, mirroring the pattern already chosen for
  `Dish` in the parallel Menu & Recipe System workstream. Not built here.
- **Un-cancel / reactivate a cancelled order.** This phase makes `CANCELLED` terminal by design
  (see Alternatives Considered in the original scope discussion). If the business owner's actual
  workflow needs a correction path other than "create a new order," that would be a deliberate,
  separate design decision, not a default to add later without re-litigating the idempotency
  guarantees this phase relies on.
- **Toast/non-blocking error UI.** This phase deliberately reuses `alert()`/`confirm()` (already
  present in the app) rather than introducing a new UI dependency, since UI polish is owned by a
  separate Phase 1 workstream. A nicer, non-blocking error surface is a reasonable future
  enhancement once that workstream lands.

## Open Questions
- **Should un-cancelling an order (moving it back to an active status) ever be supported?**
  Genuinely open — this phase recommends against it (see Follow-Up Work), but that recommendation
  should be confirmed against how the business owner actually corrects a mistaken cancellation
  today, before treating "terminal `CANCELLED`" as final product behavior rather than just this
  phase's implementation choice.
- **Does the business owner need a way to retire an inventory item she no longer stocks?**
  Genuinely open — see "Inventory soft delete" in Follow-Up Work. Not blocking for this phase
  (the current behavior — permanently non-deletable once referenced — is safe, just possibly
  inconvenient later), but worth a product decision before it's mistaken for an oversight.
