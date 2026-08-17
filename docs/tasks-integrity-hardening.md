# Engineering Task List: Order & Inventory Integrity + Authorization Hardening (Phase 0)
**Generated**: 2026-08-17
**Source PRD**: `docs/prd-integrity-hardening.md`
**Source TDD**: `docs/tdd-integrity-hardening.md`
**Pipeline state**: `docs/.pipeline-state.md`
**Total Tasks**: 51 across 4 phases (INFRA 3, BE 18, FE 11, TEST 15, VERIFY 2, plus 2 proactively suggested tasks folded into Phase 1)

All file paths below are relative to the worktree root:
`/home/ishola/jar/compENG/sem-8/swe-project-integrity-hardening`

---

## Summary

This phase closes five verified correctness/security gaps in "Chop with Rosty" without adding any
new screens: **zero authorization** on 10 mutating Server Actions + 3 PII-leaking read-only
actions, **no stock restoration** on order cancel/delete, **race-unsafe stock decrements** that can
drive `InventoryItem.currentStock` negative, and **no input validation or structured error
handling** anywhere in `src/app/admin/{orders,orders/[id],inventory,customers}/actions.ts`. The
fix is entirely in the application layer — no schema changes. Four new flat modules under
`src/lib/` (`auth.ts`, `errors.ts`, `inventory.ts`, `validation.ts`) become the shared foundation;
every one of the 13 admin actions (10 mutations + 3 getters) is then modified in place to call
`requireAdmin()` first, and the 10 mutations additionally change their return type from a bare
value to `ActionResult<T> = {ok:true,data:T} | {ok:false,error:string,code:ActionErrorCode}`.

The single highest-risk part of this work is **not** the backend logic — it's that all 10 mutating
actions currently have their return values pushed unconditionally into client-side `useState`
arrays, so changing the return shape without updating every one of the 10 call sites produces a
*silent* runtime failure (blank rows, no-op edits, or a delete that visually "succeeds" while the
row secretly failed to delete). This plan therefore treats each of the 10 call sites — 3 in
`OrderClient.tsx`, 2 in `OrderDetailsClient.tsx`, 2 in `InventoryClient.tsx`, 3 in
`CustomerClient.tsx` — as its own individually-verifiable task, not a single "update the clients"
task. Auth failures deliberately stay in the `throw`/`try-catch` bucket (never `ActionResult`) per
the TDD's corrected "Error-return shape" section — this is the one place an earlier draft of the
TDD got it wrong, and the plan below follows the corrected design, not the original.

Phasing follows strict dependency order: **Phase 1** builds the four shared `src/lib/` modules, the
`zod` dependency, Vitest, and the isolated-test-database wiring (nothing here touches
`actions.ts`). **Phase 2** modifies the 13 actions and `admin/layout.tsx` in place — backend-only,
still no client changes, so the app is briefly "correctly rejecting the old call sites' assumptions"
mid-phase (acceptable since this is all one PR/branch, not an incremental rollout). **Phase 3**
migrates all 10 client call sites plus one small recommended (not required) UX tweak. **Phase 4**
is the full test suite (unit, integration against the *isolated* `rosty_integrity_test` database,
never the shared `postgres` DB) plus a final typecheck/lint/build/manual-QA gate.

## Dependency Graph

```
Phase 1: Foundation
  INFRA-001 (zod dep) ─┐
  INFRA-002 (vitest)   ├─> everything in Phase 2, 4
  INFRA-003 (test DB)  ┘         │
  PROACTIVE-002 (DB-URL guard, needs INFRA-003)
                                  │
  BE-001 (errors.ts) ──> PROACTIVE-001 (P2002 branch, needs BE-001)
  BE-002 (auth.ts)    ──────────────┐
  BE-003 (inventory.ts, needs BE-001)│
  BE-004 (validation.ts, needs INFRA-001)
                                     │
Phase 2: Core Logic                 ▼
  BE-005 admin/layout.tsx  (needs BE-002)
  BE-006/007/008 get* actions (needs BE-002)
  BE-009 createOrder (needs BE-001,002,003,004)
  BE-010 updateOrderStatus (needs BE-001,002,003,004)
  BE-011 deleteOrder (needs BE-001,002,003)
  BE-012 updateOrderIngredients (needs BE-001,002,003,004)
  BE-013/014 create/updateInventoryItem (needs BE-001,002,004)
  BE-015 deleteInventoryItem (needs BE-001,002)
  BE-016/017 create/updateCustomer (needs BE-001,002,004)
  BE-018 deleteCustomer (needs BE-001,002)
                                     │
Phase 3: Integration & UI           ▼
  FE-001..003 OrderClient.tsx        (needs BE-009,010,011)
  FE-004..005 OrderDetailsClient.tsx (needs BE-012,010)
  FE-006..007 InventoryClient.tsx    (needs BE-013,015)
  FE-008..010 CustomerClient.tsx     (needs BE-016,017,018)
  FE-011 CANCELLED <select> UX (optional, needs FE-002,FE-005)
                                     │
Phase 4: Testing & Polish           ▼
  TEST-001..004 unit tests (needs Phase 1 lib modules)
  TEST-005 fixture/cleanup helpers (needs INFRA-003)
  TEST-006..009 auth-matrix integration tests (needs Phase 2 + TEST-005)
  TEST-010..015 behavior integration tests (needs Phase 2 + TEST-005)
  VERIFY-001 static verification (needs all BE/FE tasks)
  VERIFY-002 manual QA (needs VERIFY-001)
```

No circular dependencies were found. `src/lib/inventory.ts` (BE-003) has a one-way dependency on
`src/lib/errors.ts` (BE-001) for the `ActionError` class; nothing in `errors.ts` depends back on
`inventory.ts`.

---

## Phase 1: Foundation

### INFRA-001 · Add `zod` as an explicit direct dependency
**Category**: Infrastructure & Config · **Phase**: 1 · **Dependencies**: None

**Description**: `zod` is currently only present in `node_modules` as a *transitive* dependency
(pulled in by `@supabase/*` and other packages — confirmed via `package-lock.json`, resolved
version `4.4.3`) and is not listed in `package.json`. This phase's `src/lib/validation.ts` and
every mutating action import `zod` directly, so it must become an explicit, pinned direct
dependency — relying on a transitive resolution is fragile (a future upgrade of an unrelated
package could change or drop it).

**Technical Notes**: TDD "New shared modules" — `src/lib/validation.ts` — zod schemas for every
mutating action's input. The installed transitive version is zod v4 (`4.4.3`), confirmed by reading
`node_modules/zod/package.json`. **Compatibility note not spelled out in the TDD**: the TDD's own
`updateOrderStatus` code sample uses `z.nativeEnum(OrderStatus).parse(status)`. `z.nativeEnum` still
exists in the installed v4 build (`node_modules/zod/v4/classic/schemas.d.ts:577`) but is the
deprecated v3-era API — v4's `z.enum()` accepts a native TS/Prisma enum object directly. Prefer
`z.enum(OrderStatus).parse(status)` over `z.nativeEnum(...)` in BE-010 and BE-012 to avoid shipping
a new deprecated-API usage; both are functionally equivalent for this parse.

**Definition of Done**:
- `"zod"` added to `package.json` `dependencies` (not `devDependencies` — it's used in
  production `actions.ts` code paths) pinned to the resolved `^4.4.3` (or the current latest 4.x at
  implementation time).
- `npm install` run so `package-lock.json` reflects zod as a direct (not only transitive) dependency.
- `import { z } from 'zod'` resolves with no TypeScript error from a scratch file.
- No other dependency's resolved version changes as a side effect of this install.

**Estimated Complexity**: Low — one-line `package.json` addition plus an install; zero code changes.

---

### INFRA-002 · Install and configure Vitest for unit tests
**Category**: Infrastructure & Config · **Phase**: 1 · **Dependencies**: None

**Description**: No test framework exists in this repo today — `package.json` has no `test`
script and no Jest/Vitest/Playwright dependency (confirmed: zero matches for a `vitest.config.*` or
`*.test.ts` file anywhere under `src/`, `prisma/`, or repo root). Vitest is the project-directed
choice (per TDD "Testing Strategy" — "Vitest is the chosen framework for this phase"). This task
sets up the **unit-test** harness only (no real database, no Next.js server runtime) — colocated
`*.test.ts` files next to the module they test, matching Vitest's default convention.

**Technical Notes**: TDD "Testing Strategy" → "Unit tests (pure logic, no real database required)."
Target `node` test environment (no DOM needed — nothing in this phase's test scope renders a React
component; all unit-tested logic is plain TypeScript/Prisma-adjacent functions). Must resolve the
`@/*` → `src/*` path alias from `tsconfig.json` so test files can `import { ... } from '@/lib/...'`
identically to app code — use `vite-tsconfig-paths` or an equivalent `resolve.alias` entry.

**Definition of Done**:
- `vitest`, `@vitest/coverage-v8` (or equivalent), and a tsconfig-paths resolver added to
  `devDependencies`.
- `vitest.config.ts` created at repo root: `environment: 'node'`, `@/*` alias resolved, and
  `include` scoped to `src/**/*.test.ts` (explicitly **excluding** any future `tests/integration/**`
  directory — see INFRA-003 — so plain `npm test` never attempts a DB connection).
- `package.json` `scripts.test` = `"vitest run --config vitest.config.ts"` (or equivalent);
  `scripts."test:watch"` optional but recommended.
- A throwaway smoke test (e.g. `src/lib/__smoke__.test.ts` or inline in BE-001's own test) passes
  via `npm test`, then is deleted/replaced by real Phase 4 tests — this task's DoD is "the harness
  runs," not "real tests exist yet."
- `npm test` exits 0 with zero attempted network/DB calls (verify by running with network/Docker
  Supabase stopped).

**Estimated Complexity**: Low — standard Vitest bootstrap; project already uses TypeScript/ESM
throughout so no transpilation surprises expected.

---

### INFRA-003 · Wire integration tests to the isolated `rosty_integrity_test` database
**Category**: Infrastructure & Config · **Phase**: 1 · **Dependencies**: INFRA-002

**Description**: This is a hard constraint, not a preference: the shared local Postgres instance at
`127.0.0.1:54322` is used by **both** this worktree's `.env` (`DATABASE_URL`/`DIRECT_URL` both
point at `.../postgres`) and a concurrently-running, separate Menu & Recipe System worktree's
`.env`, pointed at the identical database. This branch's `schema.prisma` has no
`Dish`/`DishIngredient` models, so an accidental `prisma db push` against the shared DB would drop
the other pipeline's tables, and `prisma/seed.ts` opens with four `deleteMany()` calls that would
wipe its data too. A dedicated `rosty_integrity_test` database has already been created and this
branch's schema already pushed to it (per `docs/.pipeline-state.md`) — this task only wires
integration tests to use it, via a **separate Vitest config and a separate npm script**, so that
plain `npm test` (INFRA-002) can never reach it by accident.

**Technical Notes**: TDD "Testing Strategy" → "Integration tests (real local Postgres/Supabase...)."
Do **not** re-run `prisma db push` or `prisma db seed` as part of this task or any later task in
this plan — the isolated DB's schema is already current. If a future schema drift is ever
suspected, that is a manual, explicit, human-approved `prisma db push --schema=... ` invocation
against `rosty_integrity_test` only, never scripted into a test run.

**Definition of Done**:
- `.env.test` created at repo root (gitignored automatically — repo's `.gitignore` already has a
  blanket `.env*` rule) containing
  `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test"` and the
  matching `DIRECT_URL`.
- `vitest.integration.config.ts` created: loads `.env.test` (e.g. via `dotenv/config` in a `setupFiles`
  entry or Vitest's `env` option), `include` scoped to `tests/integration/**/*.integration.test.ts`,
  `environment: 'node'`, single-threaded/sequential execution pool (avoids two integration test files
  racing on the same seeded rows within the isolated DB).
- `package.json` `scripts."test:integration"` = `"vitest run --config vitest.integration.config.ts"`.
- Running `npm run test:integration` against a currently-empty `tests/integration/` directory exits
  0 (directory created with a `.gitkeep` or the first real test from TEST-006 lands directly here).
- A one-line comment at the top of `vitest.integration.config.ts` states explicitly: "Never point
  this at the default `.env` — that database is shared with a concurrent pipeline. See
  `docs/.pipeline-state.md`."

**Estimated Complexity**: Medium — mostly config, but getting Vitest's env-file loading and
sequential execution right for Prisma integration tests is easy to get subtly wrong (e.g. parallel
test files corrupting each other's fixtures) if not deliberate.

---

### PROACTIVE-002 · Add a runtime guard asserting `DATABASE_URL` targets the isolated test DB
**Category**: Infrastructure & Config (proactively suggested) · **Phase**: 1 · **Dependencies**: INFRA-003

**Description**: INFRA-003's separation of `npm test` vs. `npm run test:integration` is a
process-level safeguard, but it's still possible for a future engineer (or CI config change) to
misconfigure `vitest.integration.config.ts` to fall back to the real `.env` — silently pointing
integration tests at the shared `postgres` database, where a stray cleanup call could wipe the
parallel Menu & Recipe System pipeline's data. This adds a **fail-loud, in-code** check as a second
line of defense beyond the config-level separation.

**Technical Notes**: Not in the TDD — this is a proactive addition justified directly by
`docs/.pipeline-state.md`'s "Test Database Isolation" section, which frames this as a hard
constraint ("NEVER run `npx prisma db push` or `npx prisma db seed` against the shared `postgres`
database"). A misconfigured `DATABASE_URL` reaching the wrong Postgres instance is the single most
damaging possible mistake in this entire plan, since it's silent and destructive to *another team's*
work — worth a cheap, explicit assertion.

**Definition of Done**:
- A Vitest `globalSetup` (or a `beforeAll` in a shared integration test setup file, e.g.
  `tests/integration/setup.ts`) throws synchronously and aborts the run if
  `process.env.DATABASE_URL` does not contain the literal substring `rosty_integrity_test`.
- The thrown error message names the expected substring and points at `.env.test` / INFRA-003 so a
  future engineer immediately understands the fix.
- Verified by temporarily pointing `vitest.integration.config.ts` at `.env` (not `.env.test`) and
  confirming the test run aborts immediately with the guard's message, then reverting.

**Estimated Complexity**: Low — a single assertion in a setup hook.

---

### BE-001 · Create `src/lib/errors.ts` — `ActionError`, `ActionResult<T>`, `okResult`, `toErrorResult`
**Category**: Backend · **Phase**: 1 · **Dependencies**: None

**Description**: The shared error-handling module every mutating action will depend on. Defines
the `ActionErrorCode` union, the internal-control-flow `ActionError` class (thrown deliberately
inside business logic — often inside a `prisma.$transaction` callback to trigger an automatic
rollback — and always caught before it reaches the client), the client-facing `ActionResult<T>`
success/failure union, and the two helper functions actions will call at their return points.

**Technical Notes**: TDD "`src/lib/errors.ts` — the expected/uncaught split, in code" — implement
exactly as specified: `ActionErrorCode = 'VALIDATION' | 'INSUFFICIENT_STOCK' | 'NOT_FOUND' |
'FK_CONSTRAINT' | 'INVALID_TRANSITION' | 'UNKNOWN'`; `toErrorResult` maps `ActionError` → its own
`{message, code}`, `z.ZodError` → `{error: issues[0].message, code: 'VALIDATION'}`,
`Prisma.PrismaClientKnownRequestError` code `P2003` → `FK_CONSTRAINT`, `P2025` → `NOT_FOUND`, and
anything else → `console.error(err)` server-side + a fixed `fallback` string client-side, `code:
'UNKNOWN'`. **`AuthError` is intentionally NOT part of this module** — it lives in `src/lib/auth.ts`
(BE-002) and is never routed through `toErrorResult`, per "Error-return shape": auth failures are
thrown, not returned, and `requireAdmin()` is always called before any try/catch block, so an
`AuthError` never reaches this function.

**Definition of Done**:
- `src/lib/errors.ts` exports `ActionErrorCode`, `ActionError`, `ActionResult<T>`, `okResult<T>`,
  `toErrorResult` matching the TDD's signatures exactly.
- `toErrorResult` never includes the original caught error's `.message` in its returned string for
  the fallback/`UNKNOWN` branch — only the caller-supplied `fallback` argument.
- File has zero imports from any `src/app/**` path (keeps it a pure, framework-agnostic module,
  consistent with `src/lib/prisma.ts` and `src/lib/utils.ts`'s existing flat convention).
- Compiles with `tsc --noEmit` with no errors.

**Estimated Complexity**: Low — pure functions and type definitions, fully specified in the TDD with
working code.

---

### PROACTIVE-001 · Extend `toErrorResult` to handle Prisma `P2002` (unique constraint violation)
**Category**: Backend (proactively suggested) · **Phase**: 1 · **Dependencies**: BE-001

**Description**: `prisma/schema.prisma` declares `User.email` and `User.phone` both `@unique`. The
TDD's `toErrorResult` (BE-001) only special-cases `P2003` (FK constraint) and `P2025` (not found) —
a duplicate email/phone passed to `createCustomer` or `updateCustomer` (BE-016/BE-017) will throw
`PrismaClientKnownRequestError` code `P2002`, fall through to the generic `UNKNOWN` branch, and
surface only the fixed fallback string (e.g. "Could not create this customer. Please try again.")
instead of a specific, actionable message — this is exactly the class of vague failure this phase
exists to eliminate, and a duplicate email/phone is a highly plausible real-world admin mistake
(re-entering an existing customer), not an edge case.

**Technical Notes**: Not in the TDD's literal `toErrorResult` code sample — this is a gap identified
by cross-referencing the TDD's error-mapping table against the actual schema's `@unique`
constraints, which the TDD's `deleteCustomer`/`deleteInventoryItem` pre-check pattern doesn't cover
(those pre-checks are for `P2003`/order-count, not `P2002`/uniqueness). Add a branch: `if (err.code
=== 'P2002')` → return `{ ok: false, error: 'A customer with that email or phone number already
exists.', code: 'VALIDATION' }` (reusing `VALIDATION` rather than introducing a new
`ActionErrorCode`, since this is a data-shape problem the caller can fix by editing the input, same
class as a zod failure).

**Definition of Done**:
- `toErrorResult` in `src/lib/errors.ts` has a new `P2002` branch returning a specific,
  human-readable message and `code: 'VALIDATION'`.
- Verified against Prisma's `PrismaClientKnownRequestError.meta.target` being available but *not*
  required for the message (don't leak raw column names like `"User_email_key"` to the client —
  keep the message generic enough to stay safe per the TDD's "no secrets or raw internals leak
  through errors" security principle).
- Unit-tested as part of TEST-003 (`toErrorResult` unit tests) — add the `P2002` case there rather
  than a separate test task.

**Estimated Complexity**: Low — one additional `if` branch, same shape as the existing `P2003`/`P2025`
branches.

---

### BE-002 · Create `src/lib/auth.ts` — `getCurrentDbUser()`, `requireAdmin()`, `AuthError`
**Category**: Backend · **Phase**: 1 · **Dependencies**: None

**Description**: The shared authorization module. `getCurrentDbUser()` resolves the Prisma `User`
row for the current Supabase session, first by `id`, falling back to a unique `email` match — this
fallback is the fix for the "admin lockout" risk (a pre-existing Prisma `User` row's `id` never gets
reconciled to the Supabase auth UUID by `src/app/auth/callback/route.ts`, which only sets `id:
user.id` when creating a brand-new row). `requireAdmin()` throws `AuthError` if there's no session
or the resolved user's `role !== 'ADMIN'`, and returns the `User` otherwise. Both `admin/layout.tsx`
(BE-005) and all 13 hardened actions depend on this module.

**Technical Notes**: TDD "`src/lib/auth.ts` — resolving the current admin (and the lockout fix)" —
implement `getCurrentDbUser`/`requireAdmin` exactly as specified, including the doc comment
explaining *why* the id-then-email fallback exists (keep it — it's load-bearing context for the
next engineer who might "simplify" this back to id-only). Confirmed via direct read of
`src/app/auth/callback/route.ts:21-43`: `existingUser` is looked up by `email` only, and `id:
user.id` is set only inside the `if (!existingUser)` branch — this validates the TDD's stated root
cause exactly. **Do not** add any per-row ownership check beyond the role check — TDD explicitly
notes this is a single-admin, no-ownership-dimension data model, unlike the multi-tenant examples in
Next's own data-security guide.

**Definition of Done**:
- `src/lib/auth.ts` exports `AuthError extends Error`, `getCurrentDbUser(): Promise<User | null>`,
  `requireAdmin(): Promise<User>` matching the TDD's implementation.
- `getCurrentDbUser()` calls `prisma.user.findUnique({ where: { id } })` first; only falls back to
  `findUnique({ where: { email } })` if the id lookup returns `null` **and** `authUser.email` is
  truthy.
- `requireAdmin()` throws `AuthError` (not a generic `Error`) for both the no-session and
  wrong-role cases, with the exact user-facing strings from the TDD ("You must be signed in to do
  that." / "You do not have permission to do that.").
- Compiles with `tsc --noEmit`; imports `createClient` from `@/utils/supabase/server` (existing,
  unmodified) and `prisma` from `@/lib/prisma` (existing, unmodified).

**Estimated Complexity**: Medium — logic itself is short, but it's the security-critical module of
this entire phase; the id-then-email fallback ordering must be exact (id first, unconditionally) to
avoid accidentally weakening the check.

---

### BE-003 · Create `src/lib/inventory.ts` — `decrementStockOrThrow`, `restoreStockForOrder`
**Category**: Backend · **Phase**: 1 · **Dependencies**: BE-001

**Description**: The two stock-mutation helpers every order-related action will call from inside a
`prisma.$transaction` callback. `decrementStockOrThrow` performs a single guarded `updateMany`
(`WHERE id = ... AND currentStock >= quantityUsed`) so the race-safety comes from Postgres's
row-level locking under `READ COMMITTED`, not from an application-level check-then-write (which
would reintroduce the race). `restoreStockForOrder` reads every `OrderIngredientLog` row for an
order and increments each referenced `InventoryItem.currentStock` by its logged `quantityUsed`.

**Technical Notes**: TDD "`src/lib/inventory.ts` — the guarded decrement and the shared revert
helper," including the "Why `updateMany` and not `update`" and "Why this is actually race-safe, not
just 'looks atomic'" subsections — read both before implementing; the correctness of this whole
phase's concurrency guarantee rests on `updateMany`'s `WHERE`-guarded single-statement semantics,
not on any explicit locking call. `decrementStockOrThrow` throws `ActionError` with
`code: 'NOT_FOUND'` if the item doesn't exist at all, or `code: 'INSUFFICIENT_STOCK'` with a message
in the exact format `` `Not enough "${item.name}" in stock: have ${item.currentStock}
${item.unit}, need ${quantityUsed}.` `` if it exists but has insufficient stock — this exact message
format is what the PRD's Goal #4 and Success Metrics point to ("not enough rice — have 2kg, need
5kg").

**Definition of Done**:
- `src/lib/inventory.ts` exports `decrementStockOrThrow(tx, inventoryItemId, quantityUsed):
  Promise<void>` and `restoreStockForOrder(tx, orderId): Promise<void>`, both typed against
  `Prisma.TransactionClient` (not the top-level `PrismaClient`) for their `tx` parameter.
- `decrementStockOrThrow` uses `tx.inventoryItem.updateMany({ where: { id, currentStock: { gte:
  quantityUsed } }, ... })` — not `tx.inventoryItem.update()` — and checks `result.count === 0`
  before doing the follow-up `findUnique` to determine which `ActionError` to throw.
- `restoreStockForOrder` iterates `tx.orderIngredientLog.findMany({ where: { orderId } })` and calls
  `tx.inventoryItem.update({ ..., data: { currentStock: { increment: log.quantityUsed } } })` once
  per log row.
- Both functions import `ActionError` from `@/lib/errors` (BE-001) — no other cross-module imports.
- Compiles with `tsc --noEmit`.

**Estimated Complexity**: Medium — the logic is short, but the race-safety reasoning must be
preserved exactly (no "optimization" to a `SELECT`-then-`UPDATE` pattern, which would silently
reintroduce the negative-stock bug this whole phase exists to fix).

---

### BE-004 · Create `src/lib/validation.ts` — zod schemas for all 10 mutating actions
**Category**: Backend · **Phase**: 1 · **Dependencies**: INFRA-001

**Description**: One zod schema per mutating action's input shape, used by each action to `.parse()`
its incoming data before touching the database. Includes the ingredient-array max-length guard (50
lines) on both order-ingredient schemas, and the empty-string-vs-optional handling + "at least one
contact method" refinement for customer schemas.

**Technical Notes**: TDD "Zod schema notes" section — two points are load-bearing, not stylistic:
(1) `createOrderSchema.ingredients` / `updateOrderIngredientsSchema.ingredients` must be
`z.array(ingredientInputSchema).max(50, 'An order cannot list more than 50 distinct ingredient
lines.')` — the cap value (50) is an explicit sanity ceiling, not a real product constraint, per the
TDD. (2) `createCustomerSchema`/`updateCustomerSchema` must treat `""` as "not provided" — since
`FormData.get(...)` always returns a string (never `null`/`undefined`) for a present-but-blank
field, `.optional()` alone is insufficient; use `z.string().trim().optional().transform(v => v ||
undefined)` per field, plus a `.refine()` at the object level requiring at least one of
`name`/`email`/`phone` to be non-empty. This is also the first time the UI's existing "At least one
contact method is required" copy (already shown in `CustomerClient.tsx`'s add-customer dialog,
line 158-160) is actually *enforced* server-side. Prefer `z.enum(OrderStatus)` over
`z.nativeEnum(OrderStatus)` for the order-status schema — see INFRA-001's technical note on why.

**Definition of Done**:
- `src/lib/validation.ts` exports one schema per mutating action: `createOrderSchema`,
  `updateOrderStatusSchema` (or an inline `z.enum(OrderStatus)` used directly at the call site — 
  developer's choice, but must be named/exported if reused), `updateOrderIngredientsSchema`,
  `createInventoryItemSchema`, `updateInventoryItemSchema`, `deleteByIdSchema` (or equivalent
  `z.string().uuid()` reused across all four delete actions), `createCustomerSchema`,
  `updateCustomerSchema`.
- Both ingredient-array schemas enforce `.max(50, ...)` with the TDD's exact message text.
- Customer schemas correctly `.parse({ name: '', email: 'x@y.com', phone: '' })` as valid (empty
  strings normalized to `undefined`, at least one field present) and correctly *reject*
  `{ name: '', email: '', phone: '' }` via the object-level `.refine()`.
- All ID-accepting schemas validate UUID shape (`z.string().uuid()`), so a malformed/tampered ID
  fails validation before reaching Prisma.
- Compiles with `tsc --noEmit`; no runtime dependency on anything outside `zod` itself.

**Estimated Complexity**: Medium — mechanically straightforward per-field, but the empty-string
normalization and cross-field refinement for customer contact methods is easy to get subtly wrong
(e.g. forgetting `.trim()` lets `"   "` pass as a valid contact method).

---

## Phase 2: Core Logic

### BE-005 · Enforce role gate in `src/app/admin/layout.tsx`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Replaces the current `if (!user) redirect('/login')`-only check (which has a
literal comment "we can add role checks here later") with a full gate: unauthenticated → `/login`,
authenticated-but-not-`ADMIN` (including the id/email-lockout-fallback case) → `/dashboard`. This is
the route-level half of authorization; the action-level half is BE-006 through BE-018.

**Technical Notes**: TDD "`src/app/admin/layout.tsx`" code block — reuses `getCurrentDbUser()`
(BE-002) rather than duplicating the id/email-fallback logic, so "the id-or-email lockout fallback is
defined in exactly one place" (direct TDD quote). Verified current file
(`src/app/admin/layout.tsx:9-14`) has exactly the gap described.

**Definition of Done**:
- `Layout` awaits `supabase.auth.getUser()`; `redirect('/login')` if no `user`.
- Calls `getCurrentDbUser()` (not a duplicate inline lookup) and `redirect('/dashboard')` if the
  result is `null` or `role !== 'ADMIN'`.
- The literal "we can add role checks here later" comment is removed.
- Manually verified (or covered by VERIFY-002): a `CUSTOMER`-role session hitting any `/admin/*`
  URL lands on `/dashboard`, not the admin shell.

**Estimated Complexity**: Low — small, mechanical change once BE-002 exists.

---

### BE-006 · Add `requireAdmin()` to `getOrders`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: `getOrders` (`src/app/admin/orders/actions.ts`) currently has zero access control
despite being independently POST-able and returning full order + customer PII data. Adds a single
`await requireAdmin()` at the top — no other change.

**Technical Notes**: TDD "Read-only actions" — **return shape is unchanged**; this action still
returns the bare `Order[]` (with `customer`/`ingredientLogs` includes), it does **not** get wrapped
in `ActionResult`. Verified safe: `getOrders` is imported only by
`src/app/admin/orders/page.tsx:1`, itself rendered under `admin/layout.tsx`'s gate (BE-005).

**Definition of Done**:
- `getOrders` in `src/app/admin/orders/actions.ts` begins with `await requireAdmin()` before its
  `prisma.order.findMany(...)` call.
- Return type/shape unchanged — confirm `src/app/admin/orders/page.tsx` still compiles with no
  changes required at its call site.
- An unauthenticated or non-`ADMIN` call rejects (`.rejects.toThrow(AuthError)`), verified in
  TEST-006.

**Estimated Complexity**: Low — one-line addition to an existing, unchanged-otherwise function.

---

### BE-007 · Add `requireAdmin()` to `getInventoryItems`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Same pattern as BE-006, applied to `getInventoryItems`
(`src/app/admin/inventory/actions.ts`).

**Technical Notes**: TDD "Read-only actions." Verified callers: `src/app/admin/inventory/page.tsx:1`,
`src/app/admin/orders/page.tsx:3`, and `src/app/admin/orders/[id]/page.tsx:2` — all Server
Components under the admin layout gate.

**Definition of Done**:
- `getInventoryItems` begins with `await requireAdmin()`.
- Return type/shape unchanged; all three existing call sites (`inventory/page.tsx`,
  `orders/page.tsx`, `orders/[id]/page.tsx`) compile with no changes required.
- Covered by TEST-008's auth matrix.

**Estimated Complexity**: Low.

---

### BE-008 · Add `requireAdmin()` to `getCustomers`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Same pattern as BE-006/BE-007, applied to `getCustomers`
(`src/app/admin/customers/actions.ts`). This is the highest-value of the three getter fixes since it
returns customer email/phone (PII) directly.

**Technical Notes**: TDD "Read-only actions" — explicitly calls out `getCustomers` as leaking PII to
any caller who can reach the action ID, closed as mandatory (not deferred) scope. Verified callers:
`src/app/admin/customers/page.tsx:1` and `src/app/admin/orders/page.tsx:2`. Confirmed
`src/app/dashboard/page.tsx` does **not** import any of the three getters — it queries
`prisma.user.findFirst`/`prisma.order.findMany` directly, scoped to the logged-in customer — so this
change has zero impact on the customer-facing dashboard.

**Definition of Done**:
- `getCustomers` begins with `await requireAdmin()`.
- Return type/shape unchanged (still includes `_count: { orders: true }`).
- Covered by TEST-009's auth matrix.

**Estimated Complexity**: Low.

---

### BE-009 · Harden `createOrder` — auth, validation, guarded decrement, `ActionResult<Order>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-003, BE-004
**⚠ Return type change**: `Order` → `ActionResult<Order>` — cascades to FE-001.

**Description**: The core order-creation path. Adds `requireAdmin()`, validates input against
`createOrderSchema`, replaces the current unguarded `tx.inventoryItem.update({ decrement })` loop
with `decrementStockOrThrow` per ingredient (inside the same `prisma.$transaction`), and wraps
everything in a try/catch that converts failures to `ActionResult`. Fire-and-forget notification
calls (`notifyOrderStatusChange`, `notifyLowStock`) stay exactly as-is, running **after** the
transaction commits, never inside it.

**Technical Notes**: TDD "Domain & Service Layer" — full `createOrder` code sample given verbatim.
Key ordering: `requireAdmin()` runs **before** the try block (so an `AuthError` is never caught by
the transaction's catch), `createOrderSchema.parse(data)` runs **inside** the try block, and the
`prisma.$transaction` callback throws `ActionError` (via `decrementStockOrThrow`) which
automatically rolls back the just-created `Order` row along with any `OrderIngredientLog` rows
already written in that same callback — confirmed no partial-write code path exists. After the
transaction, the low-stock-check loop still iterates the outer `data.ingredients` (the function's
own parameter, untouched by the transaction) — not something returned from `tx`, so no signature
mismatch versus current behavior.

**Definition of Done**:
- `createOrder` in `src/app/admin/orders/actions.ts` calls `await requireAdmin()` first (unguarded,
  outside any try/catch).
- Input parsed via `createOrderSchema.parse(data)` inside a try block.
- Ingredient loop inside `prisma.$transaction` calls `decrementStockOrThrow(tx, ...)` before writing
  each `OrderIngredientLog` row (order matters: guard first, log second).
- Catch block returns `toErrorResult(err, 'Could not create this order. Please try again.')`.
- Success path calls `revalidatePath('/admin/orders')` and returns `okResult(order)`.
- Function's return type is `Promise<ActionResult<Order>>`.
- Notification fire-and-forget calls (`notifyOrderStatusChange`, `notifyLowStock`) unchanged in
  behavior — still non-blocking, still `.catch(console.error)`, still only run on the success path.

**Estimated Complexity**: High — this is the most structurally complex of the 10 actions (auth +
validation + transactional guarded decrement + post-commit notifications + return-type change all
in one function).

---

### BE-010 · Harden `updateOrderStatus` — CANCELLED transition handling, un-cancel rejection
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-003, BE-004
**⚠ Return type change**: `Order & {customer: User}` → `ActionResult<Order & {customer: User}>` —
cascades to FE-002 and FE-005.

**Description**: Currently a bare `prisma.order.update` with zero special-casing of `CANCELLED`.
Adds `requireAdmin()`, zod validation of the target status, and the core lifecycle invariant this
phase introduces: moving **into** `CANCELLED` from any active status restores every ingredient
quantity via `restoreStockForOrder`; moving **out of** `CANCELLED` (an "un-cancel") is rejected with
`code: 'INVALID_TRANSITION'`, since `CANCELLED` is terminal this phase (confirmed default per
pipeline state — do not build reactivation).

**Technical Notes**: TDD "Domain & Service Layer" — full `updateOrderStatus` code sample. The
`enteringCancelled`/`leavingCancelled` boolean pair is the idempotency mechanism: calling this twice
with `status: 'CANCELLED'` on an already-`CANCELLED` order has `enteringCancelled === false` (since
`existing.status !== 'CANCELLED'` is false), so `restoreStockForOrder` is **not** called a second
time — this is what makes double-submit/slow-retry safe (TDD "Edge Cases & Failure Modes" —
"Cancelling an order twice"). Fetch `existing` via `tx.findUnique` **inside** the transaction (not
via a separate pre-transaction query) so the status check and the restoration happen atomically
against the same row.

**Definition of Done**:
- `updateOrderStatus(id, status)` calls `await requireAdmin()` first, then parses `status` via
  `z.enum(OrderStatus).parse(status)` (see INFRA-001 note on preferring `z.enum` over
  `z.nativeEnum`) inside the try block.
- Inside `prisma.$transaction`: fetches the existing order by `id`; throws `ActionError('Order not
  found.', 'NOT_FOUND')` if missing; throws `ActionError('Cancelled orders cannot be reactivated.
  Create a new order instead.', 'INVALID_TRANSITION')` if `leavingCancelled`; calls
  `restoreStockForOrder(tx, id)` if `enteringCancelled`; then updates the order's status.
- Catch block returns `toErrorResult(err, 'Could not update this order.')`.
- Success path fires `notifyOrderStatusChange` (unchanged), calls
  `revalidatePath('/admin/orders')`, returns `okResult(order)`.
- Function's return type is `Promise<ActionResult<Order & { customer: User }>>`.

**Estimated Complexity**: High — the transition-guard logic (idempotent cancel + terminal-state
rejection) is the most conceptually subtle piece of business logic in this phase.

---

### BE-011 · Harden `deleteOrder` — conditional stock restoration, `ActionResult<void>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-003
**⚠ Return type change**: `void` → `ActionResult<void>` — cascades to FE-003.

**Description**: Currently deletes `OrderIngredientLog` rows then the `Order` with a code comment
literally questioning whether stock should be restored — it never is. This adds `requireAdmin()`
and restores stock **conditionally**: only if the order being deleted was not already `CANCELLED`
(otherwise its stock was already given back by BE-010's transition handling, and restoring again
would double-credit).

**Technical Notes**: TDD "Domain & Service Layer" — full `deleteOrder` code sample. The
`if (order.status !== 'CANCELLED')` guard directly implements PRD User Story #2 and the "Delete
after cancel" edge case (TDD "Edge Cases & Failure Modes"). Order of operations inside the
transaction: fetch order → conditionally restore stock → delete `OrderIngredientLog` rows → delete
the `Order` row itself — this ordering matters because `restoreStockForOrder` reads the log rows
that are about to be deleted.

**Definition of Done**:
- `deleteOrder(id)` calls `await requireAdmin()` first, parses `id` via `z.string().uuid().parse(id)`.
- Inside `prisma.$transaction`: fetches the order; throws `ActionError('Order not found.',
  'NOT_FOUND')` if missing; calls `restoreStockForOrder(tx, id)` **only if**
  `order.status !== 'CANCELLED'`; then deletes `orderIngredientLog` rows and the `Order`.
- Catch block returns `toErrorResult(err, 'Could not delete this order.')`.
- Success path calls `revalidatePath('/admin/orders')`, returns `okResult(undefined)`.
- Function's return type is `Promise<ActionResult<void>>`.

**Estimated Complexity**: Medium — smaller surface than BE-009/BE-010, but the conditional-restore
guard is a correctness-critical one-liner that's easy to omit.

---

### BE-012 · Harden `updateOrderIngredients` — CANCELLED-order guard, guarded re-decrement
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-003, BE-004
**⚠ Return type change**: `void` → `ActionResult<void>` — cascades to FE-004.

**Description**: Currently reverts all existing ingredient logs (unconditionally incrementing stock
back), deletes the logs, then re-applies new deductions with an unguarded `decrement` — same
race-unsafety as `createOrder`. Adds `requireAdmin()`, zod validation (including the 50-line max),
rejects edits entirely if the order is `CANCELLED` (a corollary the TDD adds beyond the original
5-item scope, to prevent double-crediting an already-restored order), and replaces the unguarded
decrement with `decrementStockOrThrow`.

**Technical Notes**: TDD "Domain & Service Layer" — full `updateOrderIngredients` code sample, plus
the paragraph directly above it explaining why the CANCELLED guard is "the direct corollary of item
3's invariant," not scope creep. **Ordering is load-bearing**: the guarded re-decrement must run
*after* the full revert-and-delete of old logs, so `decrementStockOrThrow` checks against
`(currentStock + oldQuantityUsed)`, not the stale pre-revert value — the TDD's code comment on this
exact line ("Guard runs AFTER the revert above...") should be preserved as an in-code comment, not
just implemented correctly and left unexplained.

**Definition of Done**:
- `updateOrderIngredients(orderId, ingredients)` calls `await requireAdmin()` first, then parses
  input via `updateOrderIngredientsSchema.parse({ orderId, ingredients })` inside the try block.
- Inside `prisma.$transaction`: fetches the order; throws `ActionError('Order not found.',
  'NOT_FOUND')` if missing; throws `ActionError('Cannot edit ingredients on a cancelled order.',
  'INVALID_TRANSITION')` if `order.status === 'CANCELLED'`; reverts + deletes existing logs; then
  for each new ingredient with `quantityUsed > 0`, calls `decrementStockOrThrow(tx, ...)` before
  creating the new log row.
- Catch block returns `toErrorResult(err, "Could not update this order's ingredients.")`.
- Success path calls `revalidatePath(`/admin/orders/${orderId}`)` **and**
  `revalidatePath('/admin/inventory')` (both, unchanged from current behavior), returns
  `okResult(undefined)`.
- Function's return type is `Promise<ActionResult<void>>`.

**Estimated Complexity**: High — the revert-then-reapply-with-guard ordering is subtle and this is
the one action where getting the guard's timing wrong produces a wrong-but-plausible-looking result
(guard against stale stock) rather than an obvious crash.

---

### BE-013 · Harden `createInventoryItem` — auth, validation, `ActionResult<InventoryItem>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-004
**⚠ Return type change**: `InventoryItem` → `ActionResult<InventoryItem>` — cascades to FE-006.

**Description**: Adds `requireAdmin()` and `createInventoryItemSchema` validation to the existing
`prisma.inventoryItem.create` call; no other business logic beyond what already exists
(`minimumThreshold` defaulting behavior unchanged).

**Technical Notes**: TDD "Domain & Service Layer" — "`createInventoryItem`, `updateInventoryItem`,
`createCustomer`, and `updateCustomer` follow the identical shape (`requireAdmin()` → zod parse in a
try block → `okResult(item)` on success → `toErrorResult(err, fallback)` on failure) with no
additional guards beyond validation."

**Definition of Done**:
- `createInventoryItem(data)` calls `await requireAdmin()` first, parses `data` via
  `createInventoryItemSchema.parse(data)` inside a try block.
- Catch block returns `toErrorResult(err, 'Could not create this inventory item. Please try
  again.')` (fallback text developer's choice, consistent tone with siblings).
- Success path calls `revalidatePath('/admin/inventory')`, returns `okResult(item)`.
- Function's return type is `Promise<ActionResult<InventoryItem>>`.

**Estimated Complexity**: Low — no transaction, no special business rule beyond auth + validation.

---

### BE-014 · Harden `updateInventoryItem` — auth, validation, `ActionResult<InventoryItem>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-004
**⚠ Return type change**: `InventoryItem` → `ActionResult<InventoryItem>` — **no cascading frontend
task** (see note below).

**Description**: Same pattern as BE-013, applied to `updateInventoryItem`. **Note for the
implementer**: grepping `src/` confirms `updateInventoryItem` has zero current call sites in any
`*Client.tsx` component — `InventoryClient.tsx` only wires up `createInventoryItem` and
`deleteInventoryItem`. This action must still be hardened (it's independently POST-able regardless
of whether any UI currently links to it — the entire premise of this phase's authorization work),
but there is no Phase 3 frontend task for it since there's no call site to migrate.

**Technical Notes**: TDD "Domain & Service Layer" — same "identical shape" note as BE-013. TDD's own
"Frontend Changes" section correctly lists only 2 `InventoryClient.tsx` call sites (create, delete)
— this is the TDD being internally consistent with the actual code, not an omission.

**Definition of Done**:
- `updateInventoryItem(id, data)` calls `await requireAdmin()` first, parses `{id, ...data}` via
  `updateInventoryItemSchema.parse(...)` inside a try block.
- Catch block returns `toErrorResult(err, 'Could not update this inventory item. Please try
  again.')`.
- Success path calls `revalidatePath('/admin/inventory')`, returns `okResult(item)`.
- Function's return type is `Promise<ActionResult<InventoryItem>>`.
- Confirmed via `npm run build`/`tsc` that no `*Client.tsx` file references this function (so no
  frontend compile error is expected or masked).

**Estimated Complexity**: Low.

---

### BE-015 · Harden `deleteInventoryItem` — usage pre-check, `ActionResult<void>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002
**⚠ Return type change**: `void` → `ActionResult<void>` — cascades to FE-007.

**Description**: `OrderIngredientLog.inventoryItem` has no `onDelete` clause (defaults to Prisma's
`Restrict`), so deleting an item referenced by any order log currently throws an unhandled
`PrismaClientKnownRequestError` (`P2003`) straight to the browser as a raw 500. Adds `requireAdmin()`
plus a pre-check that counts referencing `OrderIngredientLog` rows and throws a specific,
count-based `ActionError` before attempting the delete.

**Technical Notes**: TDD "Domain & Service Layer" — full `deleteInventoryItem` code sample. Exact
message format:
`` `Cannot delete this item — it is referenced by ${usageCount} order record${usageCount === 1 ? '' : 's'}. Historical orders keep a permanent link to the ingredients they used.` ``,
`code: 'FK_CONSTRAINT'`. TDD "Edge Cases" accepts the small TOCTOU window between this count and the
actual delete as low-probability for a single-admin tool, backstopped by `toErrorResult`'s `P2003`
branch (BE-001) if it's ever hit — do not add a transaction around this pre-check + delete; the TDD
deliberately does not.

**Definition of Done**:
- `deleteInventoryItem(id)` calls `await requireAdmin()` first, parses `id` via
  `z.string().uuid().parse(id)`.
- Counts `prisma.orderIngredientLog.count({ where: { inventoryItemId: id } })`; if `> 0`, throws
  `ActionError` with the exact count-based message above, `code: 'FK_CONSTRAINT'`.
- Deletes the item; calls `revalidatePath('/admin/inventory')`; returns `okResult(undefined)`.
- Whole body wrapped in try/catch returning `toErrorResult(err, 'Could not delete this inventory
  item. Please try again.')`.
- Function's return type is `Promise<ActionResult<void>>`.

**Estimated Complexity**: Medium — same pre-check pattern as BE-018 (`deleteCustomer`); the pluralization
and exact wording must match since it's directly user-facing.

---

### BE-016 · Harden `createCustomer` — auth, contact-method validation, `ActionResult<User>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-004
**⚠ Return type change**: `User` → `ActionResult<User>` — cascades to FE-008.

**Description**: Adds `requireAdmin()` and `createCustomerSchema` validation — this is the first
place the UI's existing "at least one contact method is required" text is actually enforced
server-side (today, `createCustomer` will happily insert a customer with `name/email/phone` all
`null`).

**Technical Notes**: TDD "Domain & Service Layer" "identical shape" note, plus "Zod schema notes"
for the empty-string-normalization + `.refine()` requirement built in BE-004. `PROACTIVE-001`
(P2002 handling in `toErrorResult`) directly benefits this action — a duplicate email/phone now
surfaces a specific message instead of the generic fallback.

**Definition of Done**:
- `createCustomer(data)` calls `await requireAdmin()` first, parses `data` via
  `createCustomerSchema.parse(data)` inside a try block.
- A payload with all three fields empty/whitespace-only is rejected with `code: 'VALIDATION'` before
  reaching Prisma.
- A payload with a duplicate email/phone surfaces the PROACTIVE-001 message, not the generic
  fallback (requires PROACTIVE-001 to already be merged/available).
- Success path calls `revalidatePath('/admin/customers')`, returns `okResult(item)`.
- Function's return type is `Promise<ActionResult<User>>`.

**Estimated Complexity**: Medium — the zod refinement itself is BE-004's responsibility; this task's
complexity is mainly ensuring the try/catch/return-shape wiring is correct.

---

### BE-017 · Harden `updateCustomer` — auth, validation, `ActionResult<User>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002, BE-004
**⚠ Return type change**: `User` → `ActionResult<User>` — cascades to FE-009.

**Description**: Same pattern as BE-016, applied to `updateCustomer`.

**Technical Notes**: TDD "Domain & Service Layer" "identical shape" note. Note the current
implementation (`src/app/admin/customers/actions.ts:44-56`) unconditionally overwrites all three
fields with `data.name || null` etc. on every call — confirm this behavior is preserved (or
intentionally changed to a partial update) and, if preserved, that `updateCustomerSchema` still
enforces the same "at least one contact method" invariant on the resulting merged state, not just
the raw input, to avoid a client submitting an edit that blanks all three fields.

**Definition of Done**:
- `updateCustomer(id, data)` calls `await requireAdmin()` first, parses `{id, ...data}` via
  `updateCustomerSchema.parse(...)` inside a try block.
- Catch block returns `toErrorResult(err, 'Could not update this customer. Please try again.')`.
- Success path calls `revalidatePath('/admin/customers')`, returns `okResult(item)`.
- Function's return type is `Promise<ActionResult<User>>`.

**Estimated Complexity**: Medium.

---

### BE-018 · Harden `deleteCustomer` — order-count pre-check, `ActionResult<void>`
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-002
**⚠ Return type change**: `void` → `ActionResult<void>` — cascades to FE-010.

**Description**: `Order.customer` has no `onDelete` clause (defaults to `Restrict`) — deleting a
customer with existing orders currently throws an unhandled `P2003` straight to the browser. This is
described in the pipeline-state audit as "the worst case" of the unmigrated-call-site problem,
because today's `CustomerClient.tsx` delete handler removes the row from the table
**unconditionally**, so a failed delete currently *looks successful in the UI* even though the
customer still exists in the database. Adds `requireAdmin()` and an order-count pre-check with a
specific message.

**Technical Notes**: TDD "Domain & Service Layer" — full `deleteCustomer` code sample. Exact message
format:
`` `Cannot delete this customer — they have ${orderCount} order${orderCount === 1 ? '' : 's'} on file. Delete or reassign those orders first.` ``,
`code: 'FK_CONSTRAINT'`.

**Definition of Done**:
- `deleteCustomer(id)` calls `await requireAdmin()` first, parses `id` via `z.string().uuid().parse(id)`.
- Counts `prisma.order.count({ where: { customerId: id } })`; if `> 0`, throws `ActionError` with
  the exact count-based message above, `code: 'FK_CONSTRAINT'`.
- Deletes the user; calls `revalidatePath('/admin/customers')`; returns `okResult(undefined)`.
- Whole body wrapped in try/catch returning `toErrorResult(err, 'Could not delete this customer.
  Please try again.')`.
- Function's return type is `Promise<ActionResult<void>>`.

**Estimated Complexity**: Medium — same shape as BE-015; this is the single most consequential of
the two pre-check deletes given the pipeline-state audit's "worst case" callout for its current
frontend behavior (fixed in FE-010).

---

## Phase 3: Integration & UI

> Every task in this phase follows the same two-layer pattern per TDD "Frontend Changes": check
> `result.ok` before touching `result.data` (business-error path → `alert(result.error)`, leave
> on-screen state untouched, `return`), wrapped in an outer `try/catch` for the `AuthError` case
> (event handlers are not covered by React error boundaries — TDD cites
> `error-handling.md`'s "Error boundaries don't catch errors inside event handlers"). No new UI
> components or dependencies — `alert()` is the accepted error surface for this phase.

### FE-001 · Migrate `OrderClient.tsx` `handleAdd` to unwrap `createOrder`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-009

**Description**: `handleAdd` (`src/app/admin/orders/OrderClient.tsx:106-123`) currently does
`const newOrder = await createOrder({...}); setData([{ ...newOrder, customer: c, ingredientLogs: []
}, ...data])` — spreading the raw return value directly into a state array. After BE-009, this
spreads `{ ok: true, data: {...} }` into that array instead of the order itself, silently breaking
every column accessor (`row.original.shortId` etc. becomes `undefined`) with no compile error, since
this component's types are inline, not shared.

**Technical Notes**: TDD "Frontend Changes" → `OrderClient.tsx` (3 call sites) → first code block
(`handleAdd`), reproduced in full in the TDD — implement verbatim.

**Definition of Done**:
- `handleAdd` awaits `createOrder(...)` inside a try block, checks `!result.ok` → `alert(result.error);
  return`.
- On success, spreads `result.data` (not the raw result) into the new row:
  `setData([{ ...result.data, customer: c, ingredientLogs: [] }, ...data])`.
- Outer `catch (err)` calls `alert(err instanceof Error ? err.message : 'Could not create this order.')`.
- `setIsOpen(false)` / `setSelectedIngredients([])` only run on the success path (inside the `if
  (!result.ok) return` guard's else-continuation), not before the check.
- Manually verified: creating an order with insufficient stock shows the specific alert and leaves
  the table's existing rows unchanged (no blank row appended).

**Estimated Complexity**: Low — mechanical unwrap, TDD provides the exact code.

---

### FE-002 · Migrate `OrderClient.tsx` status `<select>` to unwrap `updateOrderStatus`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-010

**Description**: The status `<select onChange>` (`src/app/admin/orders/OrderClient.tsx:66-70`)
currently applies the new status to local state unconditionally after awaiting the action — so a
rejected transition (e.g. attempting to un-cancel a `CANCELLED` order, per BE-010) would still
visually appear applied in the table today.

**Technical Notes**: TDD "Frontend Changes" → `OrderClient.tsx` → second code block (status
`<select>` `onChange`). Note the TDD's comment: "controlled `<select>` reverts on its own — data
state is simply left unchanged" on failure — no manual revert logic needed since the `<select>`'s
`value` prop is still bound to `data`, which was never mutated on the failure path.

**Definition of Done**:
- `onChange` awaits `updateOrderStatus(...)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success, applies the new status to local state exactly as today:
  `setData(data.map(d => d.id === info.row.original.id ? { ...d, status: val } : d))`.
- Outer `catch (err)` alerts with `err.message` or a fallback.
- Manually verified: attempting to move a `CANCELLED` order to `PENDING` shows the "Cancelled orders
  cannot be reactivated..." alert and the `<select>` visibly reverts to `CANCELLED`.

**Estimated Complexity**: Low.

---

### FE-003 · Migrate `OrderClient.tsx` delete button to unwrap `deleteOrder`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-011

**Description**: The delete button's `onClick` (`src/app/admin/orders/OrderClient.tsx:87-90`)
currently filters the row out of local state unconditionally after awaiting `deleteOrder` — no
confirmation dialog exists today either (unlike the inventory/customer delete buttons), which is
preserved as-is per the TDD (not adding a `confirm()` here is not in scope for this phase).

**Technical Notes**: TDD "Frontend Changes" → `OrderClient.tsx` → third code block (delete button
`onClick`).

**Definition of Done**:
- `onClick` awaits `deleteOrder(...)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success, filters the row: `setData(data.filter(i => i.id !== info.row.original.id))`.
- Outer `catch (err)` alerts appropriately.
- No new `confirm()` dialog added (out of scope — matches existing behavior).

**Estimated Complexity**: Low.

---

### FE-004 · Migrate `OrderDetailsClient.tsx` `handleSaveIngredients` to unwrap `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-012

**Description**: `handleSaveIngredients` (`src/app/admin/orders/[id]/OrderDetailsClient.tsx:38-47`)
currently awaits `updateOrderIngredients` and unconditionally calls `setIsEditing(false)` — so an
insufficient-stock rejection or a rejected edit-on-cancelled-order (BE-012) would silently close the
edit form as if it succeeded.

**Technical Notes**: TDD "Frontend Changes" → `OrderDetailsClient.tsx` (2 call sites) → first code
block. Note the TDD's comment that no explicit `router.refresh()` is needed here — `revalidatePath`
inside the action already re-renders the route in the same round trip per Next's Server Actions
model — this matches existing (pre-phase) behavior, not a new assumption.

**Definition of Done**:
- `handleSaveIngredients` awaits `updateOrderIngredients(order.id, payload)` inside a try block,
  checks `!result.ok` → `alert(result.error); return` (inside the `try`, with `setIsSaving(false)`
  still reliably running via the existing `finally` block).
- `setIsEditing(false)` only runs on the success path.
- Outer `catch (err)` alerts with `err.message` or `"Could not update this order's ingredients."`.
- `finally { setIsSaving(false) }` preserved so the button's disabled/"Saving..." state always
  resolves regardless of outcome.
- Manually verified: editing a cancelled order's ingredients (if reachable via UI) or triggering
  insufficient stock shows the alert and the edit form stays open with unsaved changes intact.

**Estimated Complexity**: Low — TDD provides the exact code, including the `finally` interaction.

---

### FE-005 · Migrate `OrderDetailsClient.tsx` status `<select>` to unwrap `updateOrderStatus`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-010

**Description**: The status `<select onChange>` (`src/app/admin/orders/[id]/OrderDetailsClient.tsx:77-81`)
currently calls `router.refresh()` unconditionally after awaiting `updateOrderStatus` — a rejected
un-cancel attempt would trigger a refresh showing... the same (correctly unchanged) order, but with
no explanation of *why* the change didn't apply.

**Technical Notes**: TDD "Frontend Changes" → `OrderDetailsClient.tsx` → second code block (status
`<select>` `onChange`). Same underlying action (`updateOrderStatus`, BE-010) as FE-002 — this is the
second of its two call sites.

**Definition of Done**:
- `onChange` awaits `updateOrderStatus(order.id, val)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success, calls `router.refresh()` exactly as today.
- Outer `catch (err)` alerts appropriately.

**Estimated Complexity**: Low.

---

### FE-006 · Migrate `InventoryClient.tsx` `handleAdd` to unwrap `createInventoryItem`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-013

**Description**: `handleAdd` (`src/app/admin/inventory/InventoryClient.tsx:151-162`) currently does
`const newItem = await createInventoryItem({...}); setData([...data, newItem])` — same
spread-the-raw-return-value problem as FE-001/FE-008.

**Technical Notes**: TDD "Frontend Changes" → `InventoryClient.tsx` (2 call sites) → first code block.

**Definition of Done**:
- `handleAdd` awaits `createInventoryItem(...)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success: `setData([...data, result.data])`, then `setIsOpen(false)`.
- Outer `catch (err)` alerts appropriately.

**Estimated Complexity**: Low.

---

### FE-007 · Migrate `InventoryClient.tsx` delete button to unwrap `deleteInventoryItem`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-015

**Description**: The delete button's `onClick` (`src/app/admin/inventory/InventoryClient.tsx:130-134`)
currently keeps its existing `confirm(...)` guard but then filters the row unconditionally after
awaiting `deleteInventoryItem` — so attempting to delete an item referenced by existing orders
(BE-015's new FK pre-check) would currently make the row disappear from the table even though the
delete failed server-side.

**Technical Notes**: TDD "Frontend Changes" → `InventoryClient.tsx` → second code block (delete
button `onClick`). The existing `confirm(...)` call stays exactly as-is — only the post-await
handling changes.

**Definition of Done**:
- `onClick` keeps the existing `if (!confirm(...)) return` guard unchanged.
- Awaits `deleteInventoryItem(...)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success, filters the row: `setData(data.filter(i => i.id !== info.row.original.id))`.
- Outer `catch (err)` alerts appropriately.
- Manually verified: attempting to delete an item referenced by an existing order's ingredient log
  shows the specific FK-constraint alert and the row remains visible in the table.

**Estimated Complexity**: Low.

---

### FE-008 · Migrate `CustomerClient.tsx` `handleAdd` to unwrap `createCustomer`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-016

**Description**: `handleAdd` (`src/app/admin/customers/CustomerClient.tsx:111-118`) currently spreads
the raw `createCustomer` return value into the new row — same class of bug as FE-001/FE-006.

**Technical Notes**: TDD "Frontend Changes" → `CustomerClient.tsx` (3 call sites) → first code block.

**Definition of Done**:
- `handleAdd` awaits `createCustomer(...)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success: `setData([{ ...result.data, _count: { orders: 0 } }, ...data])`, then `setIsOpen(false)`.
- Outer `catch (err)` alerts appropriately.
- Manually verified: submitting the add-customer form with all three contact fields blank shows the
  server-enforced validation alert (closing the loop with BE-016/BE-004's "at least one contact
  method" refinement, previously only UI copy with no enforcement).

**Estimated Complexity**: Low.

---

### FE-009 · Migrate `CustomerClient.tsx` `handleEdit` to unwrap `updateCustomer`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-017

**Description**: `handleEdit` (`src/app/admin/customers/CustomerClient.tsx:120-128`) currently does
`.map(c => c.id === updatedItem.id ? {...} : c)` against the raw return value — per the pipeline
state audit, this **silently no-ops** once the return shape changes (`updatedItem.id` becomes
`undefined` since the real `id` is nested under `.data`), so the edit dialog would appear to close
successfully while the table silently shows the stale, pre-edit row.

**Technical Notes**: TDD "Frontend Changes" → `CustomerClient.tsx` → second code block (`handleEdit`).
This is the call site the pipeline-state audit specifically flags as the clearest example of a
*silent* runtime failure from an unmigrated call site — prioritize careful manual verification here.

**Definition of Done**:
- `handleEdit` awaits `updateCustomer(editingCustomer.id, {...})` inside a try block, checks
  `!result.ok` → `alert(result.error); return`.
- On success: `setData(prev => prev.map(c => c.id === result.data.id ? { ...c, ...result.data } : c))`,
  then `setEditingCustomer(null)`.
- Outer `catch (err)` alerts appropriately.
- Manually verified: editing a customer's email to match another existing customer's email shows
  the PROACTIVE-001 duplicate-contact alert, and the table row remains unchanged (not silently
  stuck showing stale data with no error, and not incorrectly updated).

**Estimated Complexity**: Low — mechanically simple, but flagged High-priority for manual
verification given the silent-no-op risk called out in the pipeline state.

---

### FE-010 · Migrate `CustomerClient.tsx` delete button to unwrap `deleteCustomer`'s `ActionResult`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-018

**Description**: The delete button's `onClick` (`src/app/admin/customers/CustomerClient.tsx:91-97`)
currently filters the row out unconditionally after awaiting `deleteCustomer` — per the pipeline
state audit, this is explicitly called out as "the worst case": the FK-constraint failure this phase
exists to surface would currently make the row **disappear from the table, implying success**, even
though the customer (and their order history) still exists untouched in the database.

**Technical Notes**: TDD "Frontend Changes" → `CustomerClient.tsx` → third code block (delete button
`onClick`). Highest-priority call site to get right, per the pipeline state's own framing.

**Definition of Done**:
- `onClick` keeps the existing `if (!confirm(...)) return` guard unchanged.
- Awaits `deleteCustomer(...)` inside a try block, checks `!result.ok` →
  `alert(result.error); return`.
- On success, filters the row: `setData(prev => prev.filter(i => i.id !== info.row.original.id))`.
- Outer `catch (err)` alerts appropriately.
- Manually verified end-to-end: attempting to delete a customer with existing orders shows the exact
  count-based alert from BE-018, and the customer's row **remains visible** in the table (this is
  the specific regression the pipeline state flagged as the worst-case unmigrated behavior — confirm
  it is actually fixed, not just that the code compiles).

**Estimated Complexity**: Low — mechanically simple, but flagged as the single most important manual
verification in all of Phase 3 given the explicit "worst case" callout.

---

### FE-011 · (Optional/recommended) Disable non-terminal transitions once an order is `CANCELLED`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-002, FE-005

**Description**: Both order-status `<select>` elements (`OrderClient.tsx` and
`OrderDetailsClient.tsx`) currently render every `OrderStatus` option regardless of the order's
current state, meaning an admin can attempt an un-cancel and only discover it's rejected after
submitting (via FE-002/FE-005's new alert). This task disables the other options (or the whole
control) once `status === 'CANCELLED'`, so the UI reflects the terminal-state rule proactively.

**Technical Notes**: TDD "Frontend Changes" — final paragraph: "**Recommended, not required:** ...
disable the other `<option>`s (or the whole control) once `status === 'CANCELLED'`, so the UI
reflects the new terminal-state rule directly instead of only surfacing it as a rejected-request
alert after the fact. This is a small, in-place tweak to a control this phase is already touching,
not new product surface." Explicitly framed as optional by the TDD itself — do not treat as blocking
for phase completion, but it's cheap given both `<select>` elements are already being edited in
FE-002/FE-005.

**Definition of Done**:
- In both `OrderClient.tsx` and `OrderDetailsClient.tsx`, the status `<select>` is rendered with
  `disabled={info.row.original.status === 'CANCELLED'}` (or equivalent per-option disabling) —
  developer's choice of exact UX (whole-control disable is simplest and matches "terminal" framing
  most directly).
- No new component or dependency introduced.
- Manually verified: a `CANCELLED` order's status control no longer allows selecting any other
  status from the UI.

**Estimated Complexity**: Low — small conditional prop addition to an already-open file; explicitly
optional per the TDD, so may be deferred without blocking phase sign-off.

---

## Phase 4: Testing & Polish

### TEST-001 · Unit tests: `decrementStockOrThrow`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-003, INFRA-002

**Description**: Pure unit tests against a mocked `Prisma.TransactionClient` — no real database.
Covers the three behaviors the guarded decrement must exhibit.

**Technical Notes**: TDD "Testing Strategy" → "Unit tests" → `decrementStockOrThrow` bullet.
"Exercise against a mocked `Prisma.TransactionClient` (mock `updateMany` returning `{count: 0}` /
`{count: 1}`)."

**Definition of Done**:
- `src/lib/inventory.test.ts` created.
- Test: sufficient stock → `updateMany` mock returns `{count: 1}` → function resolves with no
  throw, and `updateMany` was called with the correct `where`/`data` shape.
- Test: insufficient stock → `updateMany` mock returns `{count: 0}`, `findUnique` mock returns an
  item → throws `ActionError` with `code: 'INSUFFICIENT_STOCK'` and a message containing the item's
  name, current stock, unit, and requested quantity.
- Test: item doesn't exist → `updateMany` returns `{count: 0}`, `findUnique` returns `null` → throws
  `ActionError` with `code: 'NOT_FOUND'`.
- All three tests pass via `npm test`.

**Estimated Complexity**: Low — TDD specifies the exact mock shape needed.

---

### TEST-002 · Unit tests: `restoreStockForOrder`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-003, INFRA-002

**Description**: Pure unit test confirming every logged ingredient is restored exactly once.

**Technical Notes**: TDD "Testing Strategy" → "Unit tests" → `restoreStockForOrder` bullet.

**Definition of Done**:
- Added to `src/lib/inventory.test.ts`.
- Mocked `tx.orderIngredientLog.findMany` returns 2+ log rows referencing 2+ distinct
  `inventoryItemId`s; asserts `tx.inventoryItem.update` was called once per log row with
  `data: { currentStock: { increment: log.quantityUsed } }` and the correct `where: { id }`.
- Passes via `npm test`.

**Estimated Complexity**: Low.

---

### TEST-003 · Unit tests: `toErrorResult` (including the PROACTIVE-001 `P2002` branch)
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-001, PROACTIVE-001, INFRA-002

**Description**: Confirms every branch of the error-mapping function produces the correct
`ActionResult` shape, and — critically — that the fallback/`UNKNOWN` branch never leaks the
original error's message to the client.

**Technical Notes**: TDD "Testing Strategy" → "Unit tests" → `toErrorResult` bullet: "correctly maps
`ZodError` → `code: 'VALIDATION'`, `PrismaClientKnownRequestError` `P2003` → `code: 'FK_CONSTRAINT'`,
`P2025` → `code: 'NOT_FOUND'`, a pass-through `ActionError` → its own code/message, and an arbitrary
unknown error → `{ ok: false, code: 'UNKNOWN', error: <fallback> }` (and confirms this last branch
does not leak the original error's message into the returned string)." Extended per PROACTIVE-001 to
also cover `P2002`.

**Definition of Done**:
- `src/lib/errors.test.ts` created with one test per: `ActionError` passthrough, `z.ZodError` →
  `VALIDATION`, `P2003` → `FK_CONSTRAINT`, `P2025` → `NOT_FOUND`, `P2002` → `VALIDATION` with the
  PROACTIVE-001 message, and an arbitrary `new Error('secret internal detail')` → `UNKNOWN` with the
  caller-supplied fallback string (explicitly asserting `result.error` does **not** contain
  `'secret internal detail'`).
- All tests pass via `npm test`.

**Estimated Complexity**: Low — six small, independent branch tests.

---

### TEST-004 · Unit tests: `getCurrentDbUser` / `requireAdmin` (including the lockout-fallback case)
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-002, INFRA-002

**Description**: The security-critical unit test for this phase — confirms both the happy path and
the admin-lockout regression case work via mocked Supabase + Prisma clients (no real database or
network).

**Technical Notes**: TDD "Testing Strategy" → "Unit tests" → `getCurrentDbUser` / `requireAdmin`
bullet: covers (a) no session → `null`/`AuthError`, (b) session with matching Prisma `id` → resolves
directly, (c) session with no `id` match but a matching `email` → resolves via fallback (the lockout
regression case), (d) resolved user with `role !== ADMIN` → `AuthError`. "Assert via `await
expect(requireAdmin()).rejects.toThrow(AuthError)` for the negative cases."

**Definition of Done**:
- `src/lib/auth.test.ts` created; mocks `@/utils/supabase/server`'s `createClient` (via
  `vi.mock('@/utils/supabase/server', ...)`) and `@/lib/prisma`'s `prisma.user.findUnique`.
- Case (a): no `authUser` → `getCurrentDbUser()` resolves `null`; `requireAdmin()` rejects with
  `AuthError` and the "You must be signed in..." message.
- Case (b): `authUser.id` matches a Prisma row on the first `findUnique` call → resolves that row
  directly; the fallback email lookup is **not** called (assert `findUnique` was called exactly
  once, or that the second `where: { email }` variant was never invoked).
- Case (c) — the lockout regression: first `findUnique({ where: { id } })` returns `null`, second
  `findUnique({ where: { email } })` returns a row → `getCurrentDbUser()` resolves that row via the
  fallback.
- Case (d): resolved user has `role: 'CUSTOMER'` → `requireAdmin()` rejects with `AuthError` and the
  "You do not have permission..." message.
- All four cases pass via `npm test`.

**Estimated Complexity**: Medium — mocking two separate modules (`@/utils/supabase/server` and
`@/lib/prisma`) correctly, including simulating two sequential `findUnique` calls with different
return values in case (c), is the fiddliest unit-test setup in this phase.

---

### TEST-005 · Integration test fixture and cleanup helpers
**Category**: Testing · **Phase**: 4 · **Dependencies**: INFRA-003, PROACTIVE-002

**Description**: Shared helpers used by every integration test task below — creates and tears down
throwaway `User` (ADMIN and CUSTOMER), `InventoryItem`, `Order`, and `OrderIngredientLog` rows
directly via Prisma against the isolated `rosty_integrity_test` database, and mocks Supabase's
`auth.getUser()` per-test to simulate an authenticated session for a given fixture user (since
`requireAdmin()` calls `createClient()` → `supabase.auth.getUser()`, which integration tests must
control without a real browser session).

**Technical Notes**: TDD "Testing Strategy" → "Integration tests (real local Postgres/Supabase, per
project convention — no mocked Prisma for transaction-level behavior)" — the *database* is real; the
*Supabase auth session* is still simulated (mocked), since these are Node-side action-function calls,
not real HTTP requests through a browser. Must create fixtures with unique-enough data (e.g.
UUID-suffixed emails) to avoid colliding with any other test file running in the same isolated DB
(mitigated further by INFRA-003's sequential-execution config), and must delete everything it
created in an `afterEach`/`afterAll`, leaving `rosty_integrity_test` in the same state it found it.

**Definition of Done**:
- `tests/integration/helpers.ts` (or similar) exports functions such as
  `createTestAdmin()`/`createTestCustomer()`/`createTestInventoryItem(overrides)`/
  `createTestOrder(customerId, ingredients)` and a `cleanupAll()` (or per-test-scoped) teardown.
- Exports a `mockAuthSession(user: User)` helper that makes `requireAdmin()`/`getCurrentDbUser()`
  resolve as that user for the duration of a test (e.g. via `vi.mock`'d `createClient` returning a
  fake `auth.getUser()` resolving to `{ id: user.id, email: user.email }`), and a
  `mockNoSession()`/`mockUnauthenticatedSession()` variant.
- A trivial smoke test using these helpers (create an admin, create an inventory item, assert it
  exists, clean up) passes via `npm run test:integration` and leaves zero residual rows in
  `rosty_integrity_test` afterward (verified by a row-count check before/after).

**Estimated Complexity**: Medium — this is shared infrastructure every other Phase 4 integration
task depends on; getting the auth-session mocking right (so `requireAdmin()`'s real code path runs
against a real DB row but a fake Supabase session) is the trickiest part.

---

### TEST-006 · Integration: auth matrix for `orders/actions.ts` (createOrder, updateOrderStatus, deleteOrder, getOrders)
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-006, BE-009, BE-010, BE-011

**Description**: Directly verifies the PRD's primary success metric for this file's four actions:
unauthenticated rejects, authenticated-`CUSTOMER` rejects, authenticated-`ADMIN` succeeds.

**Technical Notes**: TDD "Testing Strategy" → "Integration tests" → first bullet: "For all 13
hardened actions... an unauthenticated call rejects (`.rejects.toThrow()`); a call from an
authenticated `CUSTOMER`-role session rejects; a call from an authenticated `ADMIN` session
succeeds."

**Definition of Done**:
- `tests/integration/orders-actions.integration.test.ts` created.
- For each of `createOrder`, `updateOrderStatus`, `deleteOrder`, `getOrders`: three test cases (no
  session, `CUSTOMER` session, `ADMIN` session) — 12 assertions total.
- Unauthenticated/`CUSTOMER` cases assert `.rejects.toThrow(AuthError)` (not `.resolves`).
- `ADMIN` case for each action asserts the call succeeds (`getOrders` resolves an array;
  `createOrder`/`updateOrderStatus` resolve `{ ok: true, ... }`; `deleteOrder` resolves `{ ok: true
  }` for a freshly-created fixture order).
- All fixtures created/cleaned up via TEST-005's helpers.

**Estimated Complexity**: Medium — mechanically repetitive across 4 actions × 3 cases, but requires
correct fixture setup (a valid customer + inventory item + order) for each.

---

### TEST-007 · Integration: auth matrix for `orders/[id]/actions.ts` (updateOrderIngredients)
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-012

**Description**: Same three-case pattern as TEST-006, applied to the single action in this file.

**Technical Notes**: TDD "Testing Strategy" → same bullet as TEST-006, scoped to this action.

**Definition of Done**:
- `tests/integration/order-ingredients-actions.integration.test.ts` created.
- Three cases (no session / `CUSTOMER` / `ADMIN`) for `updateOrderIngredients` against a fixture
  order — 3 assertions.
- Unauthenticated/`CUSTOMER` cases assert `.rejects.toThrow(AuthError)`.

**Estimated Complexity**: Low — single action, same pattern as TEST-006.

---

### TEST-008 · Integration: auth matrix for `inventory/actions.ts` (createInventoryItem, updateInventoryItem, deleteInventoryItem, getInventoryItems)
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-007, BE-013, BE-014, BE-015

**Description**: Same three-case pattern as TEST-006, applied to all four actions in this file.

**Technical Notes**: TDD "Testing Strategy" → same bullet as TEST-006. Note `updateInventoryItem`
has no frontend call site (BE-014) but must still be covered here — the auth requirement applies
regardless of UI reachability.

**Definition of Done**:
- `tests/integration/inventory-actions.integration.test.ts` created.
- 12 assertions across the 4 actions × 3 cases pattern, same shape as TEST-006.

**Estimated Complexity**: Medium.

---

### TEST-009 · Integration: auth matrix for `customers/actions.ts` (createCustomer, updateCustomer, deleteCustomer, getCustomers)
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-008, BE-016, BE-017, BE-018

**Description**: Same three-case pattern as TEST-006, applied to all four actions in this file.

**Technical Notes**: TDD "Testing Strategy" → same bullet as TEST-006.

**Definition of Done**:
- `tests/integration/customers-actions.integration.test.ts` created.
- 12 assertions across the 4 actions × 3 cases pattern.

**Estimated Complexity**: Medium.

---

### TEST-010 · Integration: insufficient-stock expected-error paths
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-009, BE-012

**Description**: Confirms `createOrder` and `updateOrderIngredients` both resolve (not reject) to
`{ ok: false, code: 'INSUFFICIENT_STOCK' }` when requested quantity exceeds available stock, and
that no partial write occurs (no `Order` row, no `OrderIngredientLog` rows left behind from the
failed attempt).

**Technical Notes**: TDD "Testing Strategy" → "Expected-error paths return values, not rejections"
bullet, and "Edge Cases" → "Transaction partial-failure on ingredient N of M during `createOrder`" —
assert with `.resolves.toMatchObject({ ok: false, code: '...' })`, explicitly **not** `.rejects`.

**Definition of Done**:
- `tests/integration/insufficient-stock.integration.test.ts` created.
- `createOrder` with an ingredient quantity exceeding a fixture item's `currentStock` resolves
  `{ ok: false, code: 'INSUFFICIENT_STOCK' }`; the fixture item's `currentStock` is unchanged
  afterward; no `Order` row exists for that attempt.
- `updateOrderIngredients` on an existing order, requesting more than available after accounting for
  the order's own already-logged quantity, resolves the same shape; the order's original ingredient
  logs remain unchanged.
- Both assertions use `.resolves.toMatchObject(...)`, not `.rejects`.

**Estimated Complexity**: Medium — requires precise fixture stock levels to reliably trigger the
insufficient-stock branch without flakiness.

---

### TEST-011 · Integration: FK-referenced-delete expected-error paths
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-015, BE-018

**Description**: Confirms `deleteCustomer` and `deleteInventoryItem` resolve `{ ok: false, code:
'FK_CONSTRAINT' }` with the correct count-based message when the target record has existing
references, instead of throwing an unhandled `P2003`.

**Technical Notes**: TDD "Testing Strategy" → "FK-guarded deletes" bullet.

**Definition of Done**:
- `tests/integration/fk-guarded-deletes.integration.test.ts` created.
- `deleteCustomer` on a fixture customer with 1+ fixture orders resolves `{ ok: false, code:
  'FK_CONSTRAINT' }` with a message containing the exact order count; the customer row still exists
  afterward.
- `deleteInventoryItem` on a fixture item referenced by 1+ `OrderIngredientLog` rows resolves the
  same shape with the exact usage count; the item row still exists afterward.
- Both use `.resolves.toMatchObject(...)`.

**Estimated Complexity**: Low — straightforward given TEST-005's fixture helpers.

---

### TEST-012 · Integration: validation expected-error paths
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-004, BE-009, BE-012, BE-016, BE-018

**Description**: Confirms malformed input is rejected with `code: 'VALIDATION'` before reaching
Prisma, across a representative sample: a non-UUID order ID, an oversized ingredient array (>50
entries), and a customer payload with all three contact fields blank.

**Technical Notes**: TDD "Edge Cases & Failure Modes" → "Non-UUID or malformed IDs" and
"Pathologically large ingredient lists" bullets; TDD "Zod schema notes" for the customer
contact-method refinement.

**Definition of Done**:
- `tests/integration/validation-errors.integration.test.ts` created.
- `deleteOrder('not-a-uuid')` (as ADMIN) resolves `{ ok: false, code: 'VALIDATION' }`.
- `createOrder` with a 51-entry `ingredients` array resolves `{ ok: false, code: 'VALIDATION' }`
  containing the "cannot list more than 50" message.
- `createCustomer({ name: '', email: '', phone: '' })` resolves `{ ok: false, code: 'VALIDATION' }`.
- All three use `.resolves.toMatchObject(...)`.

**Estimated Complexity**: Medium — three distinct scenarios in one file, each needing its own small
fixture setup.

---

### TEST-013 · Integration: order-lifecycle invariants (cancellation idempotency, un-cancel rejection, cancelled-order-edit rejection, delete-after-cancel, delete-without-cancel)
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-010, BE-011, BE-012

**Description**: The direct verification of the PRD's core integrity success metric — that
`currentStock` before order creation equals `currentStock` after a full create → cancel (or create →
delete) cycle, across every combination the TDD identifies as a distinct edge case.

**Technical Notes**: TDD "Testing Strategy" → "Cancellation idempotency," "Delete-after-cancel,"
"Delete-without-cancel," "Un-cancel rejection" bullets — implement all four as scenarios in one
file since they share the same fixture-order-with-known-ingredients setup pattern.

**Definition of Done**:
- `tests/integration/order-lifecycle.integration.test.ts` created.
- **Cancellation idempotency**: create order with known ingredient quantities → record
  `currentStock` before → cancel → assert stock restored to pre-order level → cancel again → assert
  stock unchanged from the first cancellation (no double-restore).
- **Delete-after-cancel**: cancel a fixture order, then delete it → assert stock is not
  double-restored (still equals the single-restoration level from cancellation).
- **Delete-without-cancel**: create an order, delete it directly with no prior cancellation → assert
  stock restored exactly once to the pre-order level.
- **Un-cancel rejection**: attempt to move a `CANCELLED` fixture order to any active status → assert
  `{ ok: false, code: 'INVALID_TRANSITION' }` **and** that re-fetching the order from the DB shows
  it is still `CANCELLED`.
- **Cancelled-order-edit rejection**: attempt `updateOrderIngredients` on a `CANCELLED` fixture order
  → assert `{ ok: false, code: 'INVALID_TRANSITION' }` and that its `OrderIngredientLog` rows and
  the referenced items' `currentStock` are unchanged.
- All five scenarios pass via `npm run test:integration`.

**Estimated Complexity**: High — the most scenario-dense single test file in this plan; five related
but distinct stock-reconciliation assertions, each needing careful "record before / act / assert
after" bookkeeping to avoid false positives from stale reads.

---

### TEST-014 · Integration: concurrency test for `createOrder`
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-009

**Description**: Fires two simultaneous `createOrder` calls against a fixture inventory item with
stock sufficient for exactly one of them, against the **real** isolated database (not a mock), and
asserts exactly one succeeds — the direct verification of the PRD's concurrency success metric and
the TDD's "Why this is actually race-safe" claim about Postgres row-level locking under `READ
COMMITTED`.

**Technical Notes**: TDD "Testing Strategy" → "Concurrency" bullet: "fire both `createOrder` calls
concurrently via `Promise.all` (not `Promise.allSettled` — neither call should reject) against the
real database; assert exactly one result has `ok: true` and the other has `ok: false, code:
'INSUFFICIENT_STOCK'`, and final `currentStock` is not negative." TDD "Edge Cases" reiterates: "note
**both promises resolve, neither rejects**, since this is an expected/business error, not an
exception."

**Definition of Done**:
- `tests/integration/concurrency.integration.test.ts` created.
- Seeds a fixture `InventoryItem` with `currentStock` sufficient for exactly one of two orders each
  requesting the full amount.
- Fires both `createOrder(...)` calls via `Promise.all` (not `Promise.allSettled`) as the same
  mocked `ADMIN` session.
- Asserts exactly one result is `{ ok: true, ... }` and the other is `{ ok: false, code:
  'INSUFFICIENT_STOCK' }`.
- Asserts the fixture item's final `currentStock` (re-fetched from the DB after both calls settle)
  is `>= 0` and equals the pre-test stock minus exactly one order's deduction (not zero deductions,
  not two).
- Test passes consistently across at least 3 consecutive local runs (flag as flaky and re-verify if
  it doesn't — this test's entire value is proving the race guard works, so an intermittent false
  pass defeats its purpose).

**Estimated Complexity**: High — the only test in this plan that depends on real database
concurrency behavior rather than sequential logic; correctly using `Promise.all` (not `allSettled`)
and asserting resolution (not rejection) for both branches is the detail most likely to be gotten
wrong.

---

### TEST-015 · Integration: admin-lockout regression test
**Category**: Testing · **Phase**: 4 · **Dependencies**: TEST-005, BE-002, BE-006

**Description**: Seeds a `User` row with a Prisma-generated `id` (i.e., **not** matching any
Supabase auth UUID) and a known email, simulates a Supabase session for that same email but a
*different* auth UUID (reproducing the exact divergence `src/app/auth/callback/route.ts` leaves
unreconciled for pre-existing rows), and asserts `requireAdmin()` still resolves and authorizes via
the email fallback — this is the PRD's dedicated regression test for Goal #2's "admin lockout"
failure mode, explicitly called out as needing its own test rather than being "merely fixed by
accident."

**Technical Notes**: TDD "Testing Strategy" → "Admin-lockout regression" bullet; TDD "Edge Cases &
Failure Modes" → "Admin lockout via Prisma/Supabase ID divergence" bullet; PRD Goals, second bullet.

**Definition of Done**:
- `tests/integration/admin-lockout.integration.test.ts` created.
- Creates a fixture `User` row directly via Prisma with `role: 'ADMIN'`, a known email, and a
  Prisma-generated `id` (i.e., not overridden to match any specific Supabase UUID).
- Mocks the Supabase session (via TEST-005's `mockAuthSession`-style helper, adapted to accept an
  explicit UUID different from the fixture row's `id`) to return `{ id: <a different random UUID>,
  email: <the fixture row's email> }`.
- Asserts `getCurrentDbUser()` resolves the fixture row (proving the email fallback fired) and
  `requireAdmin()` resolves without throwing.
- Also exercises one real hardened action (e.g. `getOrders()`) under this simulated session and
  asserts it succeeds rather than throwing `AuthError`, as an end-to-end confirmation the fallback
  actually unblocks a real action, not just `requireAdmin()` in isolation.

**Estimated Complexity**: Medium — conceptually the most important test in this phase per the PRD's
own framing, but mechanically similar to TEST-004's case (c), just against the real database instead
of mocks.

---

### VERIFY-001 · Static verification gate — typecheck, lint, build
**Category**: Testing · **Phase**: 4 · **Dependencies**: All BE-*, FE-*, PROACTIVE-* tasks

**Description**: The final automated gate before manual QA — confirms the entire change set
type-checks, lints cleanly, and produces a working production build, with particular attention to
every call site whose input type changed (the 10 mutating actions' `ActionResult<T>` return type is
exactly the kind of change that surfaces as a compile error at an unmigrated call site, which is a
**good** outcome here — it means Phase 3 was skipped or incomplete somewhere and TypeScript caught
it).

**Technical Notes**: TDD "Rollout Plan" → "Pre-deploy check": "run the full integration suite above
against a fresh `prisma db push` + `prisma db seed` local database" — **do this against the normal
shared local dev database only, never against `rosty_integrity_test`**, and only as a final
smoke-check after `npm run test:integration` has already passed against the isolated DB; do not
substitute this step for the isolated-DB integration run.

**Definition of Done**:
- `npx tsc --noEmit` exits 0 across the whole project.
- `npm run lint` exits 0 (or with only pre-existing warnings unrelated to this phase's files —
  confirm via `git diff` scoping if any warnings remain).
- `npm run build` completes successfully (`next build`).
- `npm test` (unit) and `npm run test:integration` (against `rosty_integrity_test`) both exit 0.
- A final `grep`-style sanity check confirms all 10 mutating actions' call sites
  (`OrderClient.tsx`, `OrderDetailsClient.tsx`, `InventoryClient.tsx`, `CustomerClient.tsx`) contain
  a `result.ok` check — i.e., no remaining direct `.data`/raw-value access on an `ActionResult`
  without a preceding guard.

**Estimated Complexity**: Low — mechanical gate-running, but treat any failure here as
phase-blocking, not something to skip.

---

### VERIFY-002 · Manual QA pass
**Category**: Testing · **Phase**: 4 · **Dependencies**: VERIFY-001

**Description**: The documented (not automated) checks the TDD explicitly calls out as needing human
confirmation, primarily because they depend on Next.js's **production** build behavior (error-message
redaction), which cannot be fully verified by `next dev`.

**Technical Notes**: TDD "Testing Strategy" → "Manual QA (documented, not automated, for this
phase)" — reproduced as the checklist below verbatim in intent. TDD "Rollout Plan" → "Post-deploy
verification" — the negative-stock check is listed there as a *deploy-time* step, included here as a
pre-merge sanity check too since it's cheap to run locally.

**Definition of Done** (run against a `next build && next start` production build, per the TDD's
explicit reasoning that dev-mode does not exercise production error redaction):
- Confirm a non-admin authenticated browser session navigating to `/admin` (or any `/admin/*` URL)
  is redirected to `/dashboard`, not a blank page, an error page, or the admin shell.
- Trigger an insufficient-stock failure via the real UI (e.g. try to create an order for more of an
  ingredient than is in stock) and confirm the alert text matches the exact "have X, need Y" format
  authored in BE-003/BE-009 — not a generic message (this is the entire point of the "Error-return
  shape" redesign — confirm it actually holds in production, not just in `next dev`).
- Trigger an `AuthError` from a non-admin session calling a hardened action directly (e.g. via
  browser devtools invoking the action, or a temporarily-demoted admin session) and observe what
  message reaches the `catch` block in production — per the TDD, if Next's redaction *does* apply to
  Server Action throws the same way it applies to render errors, a generic message is an **acceptable**
  outcome here (auth failures don't need a specific message, only to reliably block the mutation) —
  document what was actually observed rather than assuming either way.
- Run `SELECT * FROM "InventoryItem" WHERE "currentStock" < 0;` against the local dev database
  (**the normal shared one, after `prisma db seed`** — not `rosty_integrity_test`) and confirm zero
  rows.
- Attempt to delete a customer with existing orders and a inventory item referenced by an order log,
  via the real UI, and confirm both show their specific count-based messages and both rows remain
  visible in their respective tables (the two "worst case" scenarios called out in BE-015/BE-018).

**Estimated Complexity**: Medium — requires a full production build/start cycle and several manual
browser interactions; not automatable within this phase's scope (no toast/E2E framework introduced),
but each check is quick to execute once the build is running.

---

## Proactively Suggested Tasks

Both of the following are grounded directly in this specific codebase/pipeline-state, not generic
domain checklist items — everything from the generic "commonly missed" checklist that does **not**
apply here (rate limiting, audit logging, soft-delete/archival, idempotency keys for payments, toast
UI) is explicitly ruled out by the TDD's own "Security Considerations," "Follow-Up Work," and the
PRD's "Non-Goals," so it is deliberately not repeated below as a suggestion.

### PROACTIVE-001 · Extend `toErrorResult` to handle Prisma `P2002` (unique constraint violation)
See full task card under Phase 1. **Why suggested**: `prisma/schema.prisma` declares
`User.email`/`User.phone` both `@unique`, but the TDD's own `toErrorResult` code sample only maps
`P2003`/`P2025` — a duplicate email/phone on `createCustomer`/`updateCustomer` would fall through to
the generic `UNKNOWN` fallback, undermining the exact "specific, human-readable message" goal
(PRD Goal #4 / User Story #4) this phase exists to deliver, for a highly plausible real admin mistake
(re-entering an existing customer), not a contrived edge case.

### PROACTIVE-002 · Add a runtime guard asserting `DATABASE_URL` targets the isolated test DB
See full task card under Phase 1. **Why suggested**: the pipeline state's test-database-isolation
rule is framed as a hard constraint specifically because a mistake here is destructive to a
*different team's concurrent work*, not just this phase's own data — a config-level separation
(INFRA-003) is necessary but not sufficient on its own against a future misconfiguration; a cheap,
fail-loud runtime assertion is the kind of safeguard that's easy to skip under time pressure and
expensive to have skipped if it's ever needed.

---

## Environment Variables Required

No new **production** environment variables are introduced by this phase — `ADMIN_EMAIL`/
`ADMIN_PHONE` (used by `requireAdmin()`'s underlying data, via the existing `auth/callback/route.ts`
promotion logic) already exist in `.env.example` and are unchanged.

| Variable | Description | Required | Example Value | Scope |
|---|---|---|---|---|
| `DATABASE_URL` (test) | Points integration tests at the isolated `rosty_integrity_test` database instead of the shared `postgres` database used by `.env`. Set in a new `.env.test`, loaded only by `vitest.integration.config.ts` (INFRA-003). | Required for `npm run test:integration` only — not used by `npm run dev`/`build`/`test` (unit) | `postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test` | Test-only |
| `DIRECT_URL` (test) | Same isolation rationale as `DATABASE_URL` (test), matching `prisma/schema.prisma`'s `directUrl` requirement. | Required for `npm run test:integration` only | `postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test` | Test-only |

---

## Open Questions

None of the items below are blocking — every one has a safe default already in force per
`docs/.pipeline-state.md`'s orchestrator ruling, and this plan is built entirely on those defaults.
They are listed here for visibility, not as prerequisites to starting implementation.

**Carried forward from the PRD/TDD (non-blocking product decisions, defaults already in force)**:
1. **Should un-cancelling an order ever be supported?** Default in force: no — `CANCELLED` is
   terminal this phase (BE-010 rejects any transition out of `CANCELLED`). This plan builds
   exclusively on that default; revisiting it later is a product decision, not an implementation gap.
2. **Does the business owner need to retire/archive an inventory item she no longer stocks?**
   Default in force: no — any item ever referenced by an order log remains permanently
   non-deletable (BE-015's pre-check). Not blocking; flagged in the TDD's own "Follow-Up Work" as a
   future soft-delete concept, mirroring the parallel Menu & Recipe System's `Dish` pattern.

**Newly surfaced during this planning pass (informational, not blocking)**:
3. **`z.nativeEnum` is deprecated in the installed zod version.** The TDD's `updateOrderStatus` code
   sample uses `z.nativeEnum(OrderStatus)`. The installed transitive zod resolves to `4.4.3`, where
   `nativeEnum` still works but is deprecated in favor of `z.enum()` accepting a native enum object
   directly (confirmed by reading `node_modules/zod/v4/classic/schemas.d.ts:577`). BE-010/BE-012's
   technical notes recommend `z.enum(OrderStatus)` instead — functionally identical, just avoids
   introducing a new usage of a deprecated API. Not a design disagreement with the TDD, just a
   version-specific implementation detail the TDD's authoring context (likely zod v3 muscle memory)
   didn't call out.
4. **`updateInventoryItem` has no current frontend call site.** Confirmed via `grep` across `src/` —
   `InventoryClient.tsx` only wires up `createInventoryItem` and `deleteInventoryItem`. The TDD's own
   "Frontend Changes" section correctly reflects this (only 2 `InventoryClient.tsx` call sites
   listed), so this is **not** a TDD gap — flagged here only so the developer doesn't spend time
   searching for a Phase 3 task that doesn't exist for this action (BE-014 has no corresponding
   FE-0xx task, by design).

---

## Handoff

This task list is ready for the `feature-developer` agent to consume as its technical plan input.
Recommended execution order matches the phase numbering above exactly — Phase 1 must be fully merged
(or at least locally complete and typechecking) before any Phase 2 task begins, since every Phase 2
action imports from the Phase 1 `src/lib/` modules.
