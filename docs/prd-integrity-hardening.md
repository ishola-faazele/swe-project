# PRD: Order & Inventory Integrity + Authorization Hardening (Phase 0)

## Status
Draft

## Problem Statement
"Chop with Rosty" is a single-admin catering-operations tool that the business owner relies on
as her one source of truth for what's in stock, what customers owe, and what's already been
promised to them. Today that trust is not earned by the software: every write operation behind
`/admin` — creating an order, editing inventory, deleting a customer — is reachable by *any*
authenticated user (not just the owner) because none of the ten mutation entry points check who
is calling them; cancelling or deleting an order silently fails to give back the ingredients it
consumed, so `currentStock` drifts away from reality with every cancellation; two orders placed
back-to-back can drive stock negative; and when something does go wrong (deleting a customer who
has orders, for example), the app crashes with a raw, unexplained error instead of telling her
what happened. None of this is visible in the UI today — it only becomes visible the day it
causes a real mistake: overselling a dish she can't actually make, or a customer account
poking at data it shouldn't be able to touch.

## Goals
- We will know this is successful when all ten identified Server Actions
  (`createOrder`, `updateOrderStatus`, `deleteOrder`, `updateOrderIngredients`,
  `createInventoryItem`, `updateInventoryItem`, `deleteInventoryItem`, `createCustomer`,
  `updateCustomer`, `deleteCustomer`) reject any caller who is not an authenticated `ADMIN`,
  verified by an automated test suite covering unauthenticated, authenticated-non-admin, and
  authenticated-admin cases for each action.
- We will know this is successful when any non-admin authenticated user who reaches an
  `/admin/*` URL is redirected to `/dashboard` with zero exceptions — including the specific
  case of an admin whose Prisma user row predates the Supabase-auth-ID reconciliation gap (the
  "admin lockout" failure mode), which must be covered by a dedicated regression test rather
  than merely fixed by accident.
- We will know this is successful when cancelling or deleting an order always restores the
  exact ingredient quantities it deducted — verified by a test asserting `currentStock` before
  order creation equals `currentStock` after a full create → cancel (or create → delete) cycle,
  including orders whose ingredients were edited at least once first.
- We will know this is successful when concurrent order creation against a low-stock item can
  never drive `InventoryItem.currentStock` below zero — verified by a concurrency test that
  fires simultaneous order-creation requests against a real database connection and asserts
  exactly one succeeds when stock is only sufficient for one.
- We will know this is successful when the highest-risk failure paths (insufficient stock,
  deleting a customer or inventory item that has existing orders attached, malformed input)
  surface a specific, human-readable message on screen instead of an unhandled exception, a
  blank failure, or a raw framework/database error.

## Non-Goals
- No new user-facing screens or product surface. This is a correctness/security pass on the
  three existing admin screens (orders, inventory, customers), not a feature.
- No changes to the Menu/Recipe system, `Dish`/`DishIngredient` models, or what an order "is" —
  that is owned by a separate, parallel workstream.
- No mobile nav, currency formatting, due-date UI, or brand asset/PWA work — a separate Phase 1.
- No fix for the `<DialogTrigger render={<Button />}>` bug — a separate, already-known issue.
- No Row Level Security (RLS) work. Prisma via `DATABASE_URL` remains the only database access
  path; Supabase's client is used only for auth, never for `.from()` queries.
- No support for re-activating a cancelled order (moving it back to an active status). Once an
  order is `CANCELLED`, it is treated as terminal for this phase — see the TDD for the reasoning
  and the recommended alternative (create a new order).
- No inventory "soft delete" / archival concept. An inventory item that has ever been used in an
  order remains permanently un-deletable in this phase (see TDD Open Questions for the
  fast-follow this implies).
- No structural fix to `src/app/auth/callback/route.ts`'s user-ID reconciliation. This phase
  works around the resulting lockout risk (see Goals, item 2) rather than fixing its root cause,
  which would require a data migration on `Order.customerId` foreign keys. Flagged explicitly as
  a residual risk, not something silently left undiscovered.

## User Stories
1. As the business owner (admin), I want every admin action to require my authenticated admin
   session, so that a customer account — or anyone who discovers a Server Action's endpoint
   directly — can never create, edit, or delete an order, inventory item, or customer record on
   my behalf.
2. As the business owner, I want cancelling or deleting an order to automatically give back the
   ingredients it used, so my stock counts stay trustworthy without me manually recalculating
   after every cancellation.
3. As the business owner, I want the system to refuse to create or edit an order when there
   isn't enough stock for it — even if two orders come in at nearly the same moment — instead of
   silently letting stock go negative, so I never unknowingly promise food I can't make.
4. As the business owner, I want a clear, specific error message (e.g. "not enough rice — have
   2kg, need 5kg") when something goes wrong, instead of a blank failure or a crashed page, so I
   know exactly what to do next.
5. As a non-admin authenticated user (e.g. a customer who has logged in to check their orders), I
   want to be redirected to my own dashboard if I land on an admin URL, so that I never see — or
   accidentally touch — the operational backend of the business.
6. As the business owner, I want to only be able to delete a customer or inventory item when it's
   actually safe to do so (no orders reference it), with a plain-language explanation when it's
   not, so a delete attempt never turns into an unexplained crash.

## Success Metrics
- 10/10 hardened Server Actions reject unauthenticated and non-admin callers (100%), measured by
  the integration test suite added in this phase — today this is 0/10.
- 0 instances of `InventoryItem.currentStock` observed negative in the local/staging database
  after this ships, measured by a scheduled or ad-hoc integrity check (`SELECT * FROM
  "InventoryItem" WHERE "currentStock" < 0`) — today this is unbounded/unmeasured.
- 100% of order cancel/delete operations leave `currentStock` reconciled to pre-order levels
  (net of any other legitimate orders), verified in the test suite — today this is 0%
  (cancellation and deletion never restore stock at all).
- 0 raw/unhandled 500 responses surfaced to the browser for `createOrder`, `deleteCustomer`,
  `deleteInventoryItem`, and the other seven hardened actions under the failure scenarios covered
  by the test suite (insufficient stock, FK-referenced delete, invalid input, unauthorized
  caller).
- 0 successful non-admin requests to any of the 10 hardened Server Actions during manual QA
  (tested by directly invoking each action's endpoint from a non-admin session), replacing what
  is today a 100% success rate for such requests.

## UX/Flow Summary
Visually, almost nothing changes on the three existing admin screens — this is intentional. What
changes is what happens underneath each existing interaction:

1. **Authorization.** Every button click or form submission on the Orders, Inventory, and
   Customers screens that currently triggers a Server Action now silently re-verifies, on the
   server, that the caller is signed in *and* holds the `ADMIN` role before doing anything else.
   A logged-in customer who somehow ends up on an admin page, or anyone directly replaying one of
   these requests, gets rejected with a permission error instead of the action succeeding.
2. **Route-level gate.** If a non-admin authenticated user (or a stale/mismatched admin session —
   see the TDD's "admin lockout" discussion) navigates to any `/admin/*` URL, they are redirected
   to `/dashboard` before the page renders, rather than seeing the admin shell at all.
3. **Order lifecycle.** Moving an order's status to `CANCELLED` now restores every ingredient
   quantity that order had deducted back onto the relevant inventory items, in the same
   transaction as the status change. Deleting an order does the same restoration first (unless
   the order was already `CANCELLED`, in which case its stock was already given back and nothing
   is double-credited), then removes its ingredient logs and the order itself. Attempting to move
   a `CANCELLED` order back to any active status is rejected with an explanatory message; the
   recommended path is to create a new order instead.
4. **Stock-safe order creation/editing.** Creating an order or editing an existing order's
   ingredient list now checks, atomically, that there is enough stock for each ingredient at the
   moment of deduction. If not, the entire order creation or edit is rolled back — nothing is
   partially applied — and the admin sees exactly which ingredient was short and by how much.
5. **Error surfacing.** Where an action previously either did nothing visible on failure or
   crashed the page, it now shows a specific, plain-language message (e.g. via a simple alert
   consistent with the app's existing `confirm()`-based delete-confirmation pattern — no new UI
   library is introduced) and leaves the on-screen data untouched, so the admin never sees a
   corrupted or half-updated table.

## Open Questions
- Should un-cancelling an order (moving it back to an active status) ever be supported? This PRD
  recommends against it for this phase (see Non-Goals and the TDD's rationale) — confirm this
  matches how the owner actually corrects a mistaken cancellation today (e.g., "just create a new
  order") before treating it as final.
- Once an inventory item has been used in any order, it becomes permanently non-deletable under
  this design (its `OrderIngredientLog` rows keep it referenced forever). Is that acceptable, or
  does the owner need a way to retire an ingredient she no longer stocks (e.g., a future
  "archive" concept similar to the Menu & Recipe System's dish soft-delete)? Not building this
  now — flagging so it isn't mistaken for an oversight later.

**Resolved during spec review** (kept here for the record, not because they're still open):
`alert()`/`confirm()` is confirmed acceptable for this phase's error UI — no toast/notification
component is introduced; UI polish is owned by a separate Phase 1 workstream. The admin-lockout
root cause (Prisma `User.id` diverging from the Supabase auth UUID for pre-existing rows) is
confirmed out of scope for this phase — the authorization check's email-fallback mitigation
stands as the accepted long-term workaround, and the reconciliation itself is tracked as explicit
follow-up work in the TDD rather than scheduled now.
