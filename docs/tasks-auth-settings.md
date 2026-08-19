# Engineering Task List: Phone-OTP Login, Unified Account Notifications, and a Settings Page
**Generated**: 2026-08-19
**Source PRD**: `docs/prd-auth-settings.md`
**Source TDD**: `docs/tdd-auth-settings.md`
**Total Tasks**: 51 across 6 phases (5 Infra, 17 Backend, 8 Frontend, 14 Testing, 3 Verification, 4 Proactive)

> **Revision note (2026-08-19, post-plan):** BE-010 was originally sequenced as a spike ("verify
> whether `generateLink`'s `action_link` round-trips through `/auth/callback`"). A sibling
> `feature-developer` session ran that exact probe live against local Supabase before implementation
> started and got a conclusive, negative answer: **it does not round-trip, and cannot be made to** —
> `admin.generateLink` returns an implicit-flow link whose credentials arrive in the URL fragment
> (`#access_token=...`), which browsers never transmit to the server, so `/auth/callback`'s
> `?code=`-based PKCE exchange can never see it. This is independently corroborable as a basic web-
> platform fact (URL fragments are never sent in an HTTP request — RFC 3986), and the proposed fix
> matches Supabase's own documented server-side "confirm" route pattern (verified via a fresh
> search, not assumed). BE-010 is rewritten below into a concrete implementation task rather than a
> spike, and every task that referenced its "two possible outcomes" has been corrected. See BE-010,
> BE-011, and BE-017 below, and the "Next step" section at the end of this document.

---

## Summary

This expansion adds three things on top of the already-complete, live-verified WhatsApp/Arkesel
notifications feature on `feature/whatsapp-arkesel-notifications`: (1) self-managed phone-number
OTP login for customers who have no email, unified with today's email magic-link login behind a
single Supabase Auth identity per person (a synthetic placeholder email for phone-only customers);
(2) an account-creation notification (email + SMS only, no WhatsApp) that tells a brand-new
customer how to log in; and (3) an admin Settings page that moves all three notification
providers' credentials, plus independent email/phone login toggles, out of `.env` and into two new
DB-backed singleton tables (`NotificationSettings`, `LoginSettings`).

The single most load-bearing architectural fact in this plan is that `generateLink`'s
`verification_type` is **not constant** — a phone-only customer's first-ever login returns
`"signup"`, every subsequent login returns `"magiclink"`, and redeeming with the wrong hard-coded
literal 403s. This was verified live against local Supabase before this TDD was written (see
`docs/.pipeline-state.md`), and every task touching `mintSessionForAuthEmail`/`verifyPhoneOtp`
below carries this as an explicit, checkable acceptance criterion rather than a general reminder.
A second architectural throughline is the "DB is the sole source of truth, no env fallback"
decision: every sender module (`sms.ts`, `whatsapp.ts`, `email.ts`) and the webhook route lose
their `process.env` reads for provider credentials entirely — this is a wide, mechanical refactor
touching four already-tested files, and the plan treats each as its own task specifically because
each one's existing test suite needs a near-total rewrite of its setup/mocking layer (see "Test
Churn Summary" below) even though the transport logic inside each file does not change at all.

Phasing follows schema → shared domain/service layer → server actions → UI → tests → verification.
One item is called out as blocking rather than routine: the manual, human-approved `prisma db
push` against `rosty_integrity_test` (INFRA-003, required before any new integration test can run).
The TDD's own flagged open item — whether a `generateLink` `action_link` round-trips cleanly
through this app's existing PKCE `/auth/callback` route — has since been resolved empirically
(not just planned around): it does **not** round-trip, and the fix is a new, dedicated
`/auth/confirm` server route that redeems `generateLink`'s `hashed_token`/`verification_type`
directly via `verifyOtp`, bypassing `action_link` and `/auth/callback` entirely for this specific
flow. `/auth/callback` itself remains unchanged — it stays the PKCE-only landing route for the
browser-driven `signInWithOtp` flow that today's email magic-link login already uses.

---

## Dependency Graph

```
Phase 1  Foundation           INFRA-001 (schema) ─┬─> INFRA-002 (dev db push + generate)
  (schema/infra)                                  └─> INFRA-003 (test db push, manual)
                              INFRA-004 (.env.example additions)
                              INFRA-005 (.env.example deprecation notes)

Phase 2  Shared Domain/Lib    BE-001 otp.ts            (pure, no deps)
  (needs INFRA-001/002)       BE-002 supabase/admin.ts (pure, no deps)
                              BE-003 settings.ts        <- INFRA-001/002
                              BE-004 validation.ts      <- INFRA-001/002 (LoginMethod enum)
                              BE-005 auth.ts fix        <- INFRA-001/002, BE-002
                              BE-006 sms.ts refactor    <- BE-003
                              BE-007 whatsapp.ts refactor <- BE-003
                              BE-008 email.ts refactor  <- BE-003
                              BE-009 webhook route refactor <- BE-003
                              BE-010 /auth/confirm route (new)  (no deps — self-contained)
                              BE-011 sendAccountCreatedEmail <- BE-008
                              BE-012 notifyAccountCreated    <- BE-006, BE-011

Phase 3  Server Actions       BE-013 login/actions.ts        <- BE-001, BE-003, BE-005, BE-006
  (needs Phase 2)             BE-014 auth/callback/route.ts  <- BE-005
                              BE-015 app/page.tsx            <- BE-005
                              BE-016 admin/settings/actions.ts <- BE-003, BE-004
                              BE-017 admin/customers/actions.ts <- BE-002, BE-004, BE-010, BE-011, BE-012

Phase 4  Frontend             FE-001 switch.tsx   (pure, no deps)
  (needs Phase 3 actions)     FE-002 tabs.tsx      (pure, no deps)
                              FE-003 login/page.tsx        <- FE-002, BE-016
                              FE-004 PhoneLoginForm.tsx    <- FE-003, BE-013
                              FE-005 admin/settings/page.tsx   <- BE-016
                              FE-006 admin/settings/SettingsClient.tsx <- FE-001, FE-002, BE-016
                              FE-007 Sidebar.tsx   <- FE-005 (soft)
                              FE-008 CustomerClient.tsx <- BE-004, BE-017

Phase 5  Testing              TEST-001..014 — see per-task deps; TEST-010/011/012 need INFRA-003;
                              TEST-014 (new) needs BE-010

Phase 6  Verification         VERIFY-001 gate re-measure <- everything above
                              VERIFY-002 manual QA        <- VERIFY-001
                              VERIFY-003 rollout runbook  <- VERIFY-001

Proactive (cross-cutting)     PROACTIVE-001..004 — see own section; PROACTIVE-001 gates VERIFY-002's
                              manual OTP QA (log hygiene), others are independent hardening
```

No circular dependencies were found. BE-010 and BE-011 were originally in a "wait for a decision"
relationship (see the Revision note above) — that is now resolved into a normal, one-directional
build-order dependency: BE-011 (`sendAccountCreatedEmail`) takes a plain `magicLink` string
parameter and has no code-level dependency on BE-010 at all, but the caller that *constructs* that
string (BE-017, `createCustomer`) does depend on BE-010's route existing and its exact query-param
contract (`token_hash`, `type`). BE-005's `mintSessionForAuthEmail` (phone-OTP path) is **not**
affected by any of this and has no dependency on BE-010 — it calls `verifyOtp({ token_hash, type })`
directly, in-process, inside a Server Action, and never involves a browser following a link at all;
BE-010 and BE-005 are sibling implementations of the same underlying Supabase redemption call, not
a sequential pair.

---

## Test Churn Summary

Baseline, measured directly at branch tip before this expansion (`docs/.pipeline-state.md`):
**252 passed / 16 unit files**, **90 passed / 14 integration files**, 0 lint errors, build succeeds.

**Files where an *existing* assertion will break, and must be fixed by updating the assertion to
the new intended behavior — never by reverting the feature:**

- **`src/lib/auth.test.ts:80-93`** (`describe('getCurrentDbUser')`, "case (c) — lockout regression")
  and **`src/lib/auth.test.ts:122-127`** (`describe('requireAdmin')`, "case (c) — lockout
  regression"). Both mock exactly two sequential `findUnique` results
  (`.mockResolvedValueOnce(null).mockResolvedValueOnce(row)`) and assert exactly two calls. The new
  `id → authEmail → email` resolution order (TDD, `getCurrentDbUser`) makes a *third* `findUnique`
  call in this exact scenario (the `authEmail` lookup, which misses because these fixtures never
  set `authEmail`) before falling through to the real `email` fallback that used to be the second
  call. Left unfixed, both tests get an unmocked third call returning `undefined`, and the final
  assertion (`toEqual(row)`) fails. Fix: insert a `null` between the two existing
  `mockResolvedValueOnce` calls, and update the call-count/`toHaveBeenNthCalledWith` assertions from
  2 calls to 3, with call 2 now `{ where: { authEmail: ... } } }` and call 3 now
  `{ where: { email: ... } } }`. This is purely mechanical — the resulting *behavior* asserted
  (resolves via a fallback, not the divergent id) is unchanged.
- **`src/lib/notifications/sms.test.ts`** — near-total rewrite of the setup layer only. The
  `stubConfiguredEnv()` helper (`:24-27`) and every direct `vi.stubEnv('ARKESEL_API_KEY', ...)` /
  `vi.stubEnv('ARKESEL_SENDER_ID', ...)` call site (e.g. `:55-56`, `:65-66`) become inert once
  `sendSms` reads `getNotificationSettings()` instead of `process.env` (BE-006) — the env stubs
  will silently do nothing and the "unconfigured" tests will start hitting a real (mocked-away)
  Prisma call instead. Every request-shape and success/failure-mapping assertion in this file
  (`:95-252`) is otherwise **unchanged** — the Arkesel v1 transport itself is explicitly untouched
  by this expansion.
- **`src/lib/notifications/whatsapp.test.ts`** — same shape of churn as `sms.test.ts`:
  `stubConfiguredEnv()` (`:26-33`) and every `vi.stubEnv('WHATSAPP_...')` call site become inert
  once `whatsapp.ts` reads `getNotificationSettings()` (BE-007). All request-body/failure-mapping
  assertions are otherwise unchanged.
- **`src/app/api/webhooks/whatsapp/route.test.ts`** — same shape again: every
  `vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', ...)` / `vi.stubEnv('WHATSAPP_APP_SECRET', ...)` call
  site becomes inert once the route reads `getNotificationSettings()` (BE-009). The HMAC
  verification logic itself, the raw-body-read-before-JSON.parse ordering, and the fail-closed
  403/503 status codes are explicitly **not** to be touched — only what feeds the "is this
  configured" check.

**Files requiring a structural addition (not a broken assertion, but load-bearing for correctness)**
- **`tests/integration/customers-actions.integration.test.ts`** does not currently
  `vi.mock('@/lib/notifications', ...)` at all, because today's `createCustomer` never calls it. Once
  BE-017 wires in `notifyAccountCreated`, every existing test in this file that calls
  `createCustomer` (e.g. `:60-65`) will, if left unmocked, execute the real notification module
  against the real `rosty_integrity_test` database — which lazily creates a real
  `NotificationSettings`/`LoginSettings` row via `getNotificationSettings()`'s find-or-create, a side
  effect this file's `TestRegistry`/`cleanupRegistry()` pattern does not track or clean up. TEST-011
  adds the module-level mock this file needs; this is additive to the file (a new `vi.mock` block
  affecting every test in the file, not a change to any existing assertion).

**Confirmed zero-churn, stated explicitly:**
- **`tests/integration/admin-lockout.integration.test.ts`** needs no change at all. Its fixture
  (`createTestAdmin`) never sets `authEmail`, so the new middle `authEmail` lookup step in
  `getCurrentDbUser` misses and falls through to the exact same `email` fallback this test already
  asserts — the *call count* changes (2 → 3) internally, but this test only asserts the final
  resolved user and role, not call counts, so it keeps passing unmodified.
- **`src/lib/notifications/index.test.ts`** needs no change for the accessor refactor — it mocks
  `./email`/`./sms`/`./whatsapp` wholesale (`:14-25`), so it never observes what those modules read
  internally. It *does* gain new, purely additive `describe` blocks for `notifyAccountCreated`
  (TEST-009), but nothing existing in this file is touched.
- **`tests/integration/validation-errors.integration.test.ts`** needs no change. Its one
  `createCustomer` call (`:75-82`) is rejected by schema validation (`code: 'VALIDATION'`) before
  `notifyAccountCreated` would ever be reached, and this file already mocks `@/lib/notifications`
  wholesale (`:13-16`) for its order-action tests, so there is no unmocked side-effect risk here
  either.
- **Every other integration fixture file** (`fixtures.integration.test.ts`,
  `concurrency.integration.test.ts`, `orders-actions.integration.test.ts`, etc.) creates `User` rows
  via direct Prisma calls that never set `authEmail`/`preferredLoginMethod` — both new columns are
  nullable-with-default, so no existing fixture-creation call breaks.

---

## Phase 1: Foundation — Schema & Environment

### INFRA-001 · Extend the Prisma schema with the auth-settings expansion's models
- **Category**: Infrastructure & Config
- **Phase**: 1
- **Dependencies**: None
- **Description**: Add `User.authEmail` (nullable, unique) and `User.preferredLoginMethod`
  (`LoginMethod`, default `EMAIL`) to the existing `User` model; add the new `LoginMethod` enum,
  `OtpCode` model, `NotificationSettings` model, and `LoginSettings` model, exactly as specified in
  the TDD's "New/changed Prisma models" section.
- **Technical Notes**: `authEmail` **must** be `String? @unique`, not the plan's original "always
  set" phrasing — Postgres permits multiple `NULL`s under `UNIQUE`, which is what the backfill
  design in BE-005 requires. `NotificationSettings`/`LoginSettings` use the same
  `id String @id @default(uuid())` convention every other model in this schema already uses — do
  **not** introduce a fixed-literal integer PK singleton pattern (TDD, "Alternatives Considered
  #2" — rejected deliberately). This is purely additive: no column is removed or renamed, so no
  data-preserving migration script is needed (locked decision, PRD Non-Goals).
- **Definition of Done**:
  - `prisma/schema.prisma` contains all four new/changed shapes verbatim per the TDD.
  - `User.authEmail` is `String?` with `@unique`, not required/non-null.
  - `OtpCode` has `@@index([phone, createdAt])`.
  - Schema is internally consistent (no dangling relation references); `npx prisma validate`
    (or equivalent) passes.
- **Estimated Complexity**: Low — a mechanical schema addition with no logic.

### INFRA-002 · Generate the Prisma client and push the schema to the local dev database
- **Category**: Infrastructure & Config
- **Phase**: 1
- **Dependencies**: INFRA-001
- **Description**: Run `npx prisma generate` so every new model's TypeScript types exist before any
  code imports them, then `npx prisma db push` against the shared local dev `postgres` database at
  `127.0.0.1:54322`. The user has explicitly pre-approved resetting dev data for this — no
  data-preserving path is required.
- **Technical Notes**: This is the *dev* database push only — do not conflate with INFRA-003, the
  separate, manual push against the isolated test database. Confirm local Supabase is running
  (`npm run supabase:start`) first.
- **Definition of Done**:
  - `npx prisma generate` completes with no errors; `@prisma/client`'s generated types include
    `OtpCode`, `NotificationSettings`, `LoginSettings`, `LoginMethod`, and the new `User` fields.
  - `npx prisma db push` against the dev `postgres` database completes with no errors.
  - `npx prisma studio` (or equivalent) confirms the four new/changed tables exist.
- **Estimated Complexity**: Low — standard local tooling, no custom logic.

### INFRA-003 · Manually push the schema to the isolated integration-test database
- **Category**: Infrastructure & Config
- **Phase**: 1
- **Dependencies**: INFRA-001
- **Description**: Run `npx prisma db push` **once, by hand**, against `rosty_integrity_test`
  specifically (`DATABASE_URL` from `.env.test`) — never the shared `postgres` database. This is a
  hard, explicit prerequisite: no integration test that touches `OtpCode`, `NotificationSettings`,
  or `LoginSettings` (TEST-010, TEST-011, TEST-012) can pass until this has run.
- **Technical Notes**: `vitest.integration.config.mts`'s own header comment forbids scripting
  `prisma db push`/`db seed` into any test run, and `prisma/seed.ts` opens with destructive
  `deleteMany()` calls that must never run against this database as part of a loop. This task is
  the one deliberate, human-approved exception to that rule — run it directly, once, with
  `DATABASE_URL` pointed at `rosty_integrity_test`, and confirm via `guard-database-url.ts`'s own
  logic (or a direct `psql` check) that the target was correct before running it.
- **Definition of Done**:
  - `rosty_integrity_test` has the four new/changed tables present, confirmed via direct
    inspection (`psql -d rosty_integrity_test -c '\dt'` or equivalent), not just "the command
    exited 0."
  - The shared `postgres` database was **not** touched by this task.
  - This step is documented as a manual, one-off action in the PR/handoff notes — not added to any
    `package.json` script or CI step.
- **Estimated Complexity**: Low — but explicitly gates three later test tasks, so sequence it early.

### INFRA-004 · Add the two new required secrets to `.env.example`
- **Category**: Infrastructure & Config
- **Phase**: 1
- **Dependencies**: None
- **Description**: Add `SUPABASE_SERVICE_ROLE_KEY` and `OTP_HASH_SECRET` to `.env.example`, each
  with a comment explaining what reads it and what breaks without it.
- **Technical Notes**: `SUPABASE_SERVICE_ROLE_KEY` is the single highest-sensitivity new secret in
  this expansion (TDD, Security Considerations) — bypasses RLS entirely, must be marked
  **server-only, never `NEXT_PUBLIC_`-prefixed**, and only `src/utils/supabase/admin.ts` (BE-002)
  may read it. This worktree's actual `.env` already has the local Supabase demo-key value set (not
  a real secret, identical on every machine) — no action needed there. `OTP_HASH_SECRET` is the
  HMAC pepper `src/lib/otp.ts` (BE-001) uses to hash OTP codes; rotating it invalidates every
  outstanding unexpired code (documented, accepted side effect per the TDD).
- **Definition of Done**:
  - `.env.example` has both new vars, each with a comment matching the style of existing entries
    (what reads it, what the no-op/failure behavior is if unset).
  - Comment on `SUPABASE_SERVICE_ROLE_KEY` explicitly states "server-only, bypasses RLS, never
    `NEXT_PUBLIC_`."
  - No real secret value is committed.
- **Estimated Complexity**: Low.

### INFRA-005 · Mark the now-superseded provider-credential env vars in `.env.example` as deprecated
- **Category**: Infrastructure & Config
- **Phase**: 1
- **Dependencies**: None
- **Description**: `.env.example` currently documents `RESEND_API_KEY`, `FROM_EMAIL`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_LOW_STOCK_TEMPLATE_NAME`,
  `WHATSAPP_TEMPLATE_LANGUAGE`, `ARKESEL_API_KEY`, and `ARKESEL_SENDER_ID` as the vars the sender
  modules read. Once BE-006/007/008/009 land, none of these are read by application code anymore —
  update each comment block to say so explicitly, so a future developer setting one of these in a
  local `.env` doesn't get confused about why nothing changes.
- **Technical Notes**: This is not explicitly called out in the TDD's file list, but follows
  directly from the TDD's own locked decision ("no env-var fallback... one source of truth, no
  exceptions" — Alternatives Considered #1). Leaving the existing comments as-is would be
  misleading in the opposite direction from what that decision was trying to prevent: a developer
  reading `.env.example` would reasonably expect setting `ARKESEL_API_KEY` there to work. **Do not
  delete these lines** — a developer may still want `ARKESEL_SENDER_ID="Rostty"` etc. as a reference
  for what to paste into the new `/admin/settings` UI. `WHATSAPP_API_VERSION` is explicitly
  **not** part of this deprecation — it stays a real, live-read env var per the TDD.
  `ADMIN_ALERT_EMAIL`/`ADMIN_ALERT_PHONE` are also **not** part of this deprecation — those are the
  admin's own contact info for low-stock alerts, read directly at the `notifyLowStock` call site in
  `src/app/admin/orders/actions.ts:136-137`, and are untouched by this expansion.
- **Definition of Done**:
  - Every provider-credential var listed above has an updated comment stating it is no longer read
    by application code and that the equivalent setting now lives in `/admin/settings`.
  - `WHATSAPP_API_VERSION`, `ADMIN_ALERT_EMAIL`, `ADMIN_ALERT_PHONE`, `ADMIN_EMAIL`, `ADMIN_PHONE`,
    `NEXT_PUBLIC_SITE_URL`, Supabase/DB vars, and `NEXT_PUBLIC_CURRENCY` are left untouched.
- **Estimated Complexity**: Low.

---

## Phase 2: Shared Domain / Service Layer

### BE-001 · Create `src/lib/otp.ts` — OTP generation and hashing
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: None (pure module)
- **Description**: Implement `OTP_LENGTH`, `OTP_EXPIRY_MS`, `OTP_COOLDOWN_MS`, `MAX_OTP_ATTEMPTS`,
  `generateOtpCode()`, `hashOtpCode()`, and `verifyOtpCodeHash()` exactly as specified in the TDD.
- **Technical Notes**: Follows `src/lib/phone.ts`'s "no Prisma, no `next/*`" pure-module convention
  where possible (hashing needs `node:crypto` and `process.env.OTP_HASH_SECRET`, so it isn't fully
  pure, but has zero Next.js/Prisma coupling). `verifyOtpCodeHash` must reuse the exact
  length-check-before-`timingSafeEqual` guard already established in
  `src/app/api/webhooks/whatsapp/route.ts:75-76` — `timingSafeEqual` throws a `RangeError` on
  mismatched buffer lengths, so the length comparison must short-circuit first via `&&`.
- **Definition of Done**:
  - `generateOtpCode()` always returns a 6-character, zero-padded numeric string.
  - `hashOtpCode()` throws a clear error if `OTP_HASH_SECRET` is unset (mirrors the existing
    fail-loud pattern for missing required secrets in this codebase).
  - `verifyOtpCodeHash()` never throws on a mismatched-length stored hash — returns `false`.
  - All four exported constants match the TDD's values exactly (`OTP_LENGTH=6`,
    `OTP_EXPIRY_MS=10*60*1000`, `OTP_COOLDOWN_MS=60*1000`, `MAX_OTP_ATTEMPTS=5`).
- **Estimated Complexity**: Low — small, pure, well-specified module.

### BE-002 · Create `src/utils/supabase/admin.ts` — service-role Supabase client
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: None
- **Description**: A new, minimal factory function `createAdminClient()` wrapping
  `@supabase/supabase-js`'s plain `createClient`, using `SUPABASE_SERVICE_ROLE_KEY` and no cookie
  handlers — server-only, deliberately separate from `client.ts`/`server.ts`/`session.ts`, all
  three of which wrap SSR/browser cookie handling that this client must not have.
- **Technical Notes**: This client is what `mintSessionForAuthEmail` (BE-005) uses for
  `admin.auth.admin.generateLink`, and what BE-017's magic-link generation for email-preferred
  new customers uses. **Never** import this file from a `"use client"` component, and never expose
  the key via a `NEXT_PUBLIC_` prefix — enforce this by convention/review, this codebase has no
  automated boundary check for it today.
- **Definition of Done**:
  - `createAdminClient()` returns a Supabase client configured with `autoRefreshToken: false,
    persistSession: false` (no session state to manage — every call is one-shot admin work).
  - The file has zero `"use client"` directive and is never imported from any `"use client"` file
    (grep-verifiable).
  - A short header comment states this is server-only and bypasses RLS, matching the TDD's own
    code sample comment.
- **Estimated Complexity**: Low — a small, well-specified wrapper matching an existing pattern.

### BE-003 · Create `src/lib/settings.ts` — the DB-backed settings accessor
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: INFRA-001, INFRA-002
- **Description**: Implement `getNotificationSettings()`, `getLoginSettings()`, and
  `getMaskedNotificationSettings()` per the TDD's find-or-create singleton pattern. This is the
  single most-depended-on new module in this expansion — every sender module, both login actions,
  and the settings actions all import from it.
- **Technical Notes**: The find-or-create race on the very first read (two concurrent requests both
  finding no row) is an accepted, self-healing gap — same category of trade-off this codebase
  already accepts for `deleteCustomer`'s count-then-delete TOCTOU window (TDD, "Singleton pattern").
  Do not add any locking/transaction around this. `getMaskedNotificationSettings()` must **never**
  return a raw secret value — only booleans for the four secret fields
  (`resendApiKeySet`, `arkeselApiKeySet`, `whatsappAccessTokenSet`, `whatsappAppSecretSet`,
  `whatsappWebhookVerifyTokenSet`); non-secret configuration (from-email, sender id, template
  names/language, the three `*Enabled` flags) round-trips in full.
- **Definition of Done**:
  - `getNotificationSettings()`/`getLoginSettings()` both do `findFirst()` then `create({data:{}})`
    if absent, relying entirely on the schema's own column defaults for the created row.
  - `getMaskedNotificationSettings()`'s return shape contains zero fields whose value could be a
    raw stored secret — verified by a test in TEST-003 that seeds a real secret value and asserts
    it never appears anywhere in the masked object (`JSON.stringify` containment check, matching
    this codebase's existing "no secrets in logs" test style).
  - Calling either getter twice in sequence returns the same row (id-stable) rather than creating a
    second one on a warm read.
- **Estimated Complexity**: Medium — small in code size, but its find-or-create shape has to be
  exactly right since every other DB-config-reading task in this plan depends on it.

### BE-004 · Extend `src/lib/validation.ts` with the new refinements and settings schemas
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: INFRA-001, INFRA-002 (needs the `LoginMethod` enum from the generated client)
- **Description**: Add a `preferredLoginMethod` field (constrained to the `LoginMethod` enum) to
  both `createCustomerSchema` and `updateCustomerSchema`, plus the refinement rejecting a mismatch
  between the chosen method and the contact fields actually present. Add two new schemas,
  `updateNotificationSettingsSchema` and `updateLoginSettingsSchema`, for BE-016's admin actions.
- **Technical Notes**: Reuses this file's existing `optionalContactField`/refinement house style
  (see `hasAtLeastOneContactMethod`, `:24-30`) rather than inventing a new validation idiom. The
  refinement text from the TDD:
  ```ts
  .refine(
    (v) => !v.preferredLoginMethod ||
      (v.preferredLoginMethod === 'EMAIL' ? Boolean(v.email) : Boolean(v.phone)),
    { message: 'Preferred login method must match a contact field that is actually filled in.' }
  )
  ```
  Since `updateCustomerSchema` overwrites all three contact fields on every call (existing,
  unchanged behavior — `validation.ts:132-137`'s own comment), this refinement is what stops an
  edit from silently leaving `preferredLoginMethod` pointing at a channel the same edit just
  blanked out. The two new settings schemas have no TDD-specified exact shape — model them on every
  secret field being `z.string().trim().optional()` (blank = "keep stored value," per BE-016) and
  every `*Enabled`/toggle field being `z.boolean()`.
- **Definition of Done**:
  - `createCustomerSchema`/`updateCustomerSchema` both accept an optional `preferredLoginMethod`
    and reject (with the exact message above) a value that doesn't match a filled contact field.
  - `updateNotificationSettingsSchema` accepts every field in the TDD's `NotificationSettings`
    model except `id`/`updatedAt`, with every secret field optional-and-blankable.
  - `updateLoginSettingsSchema` accepts `emailLoginEnabled`/`phoneLoginEnabled` as required
    booleans (this is an explicit admin toggle write, not a partial patch).
- **Estimated Complexity**: Low — mechanical additions following an established local pattern.

### BE-005 · Fix `src/lib/auth.ts` — the prerequisite identity-sync unification
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: INFRA-001, INFRA-002, BE-002
- **Description**: Implement `isAdminIdentity()`, `syncPrismaUser()`, `syntheticEmailForPhone()`,
  `resolveCustomerForPhoneLogin()`, and `mintSessionForAuthEmail()` in `src/lib/auth.ts`, and update
  `getCurrentDbUser()` to the new `id → authEmail → email` resolution order. This is the
  prerequisite fix the TDD calls out explicitly: today's two independently-drifting sync
  implementations (`auth/callback/route.ts`, `page.tsx`) are both email-only and would silently
  drop or duplicate a phone-only sign-in.
- **Technical Notes**: `resolveCustomerForPhoneLogin` is deliberately a **separate** function from
  `syncPrismaUser`, not a branch inside it — the phone path decides `authEmail` *before* a Supabase
  identity exists, the email path only ever runs *after* one already does (TDD, Alternatives
  Considered #3 — merging them was explicitly rejected). `mintSessionForAuthEmail` **must** read
  back `data.properties.verification_type` from the same `generateLink` response and pass it as
  `verifyOtp`'s `type` — **never** a hard-coded `'magiclink'` literal. This is the single most
  important acceptance criterion in this entire task list: hard-coding it works for every returning
  customer and silently 403s on exactly one path, a phone-only customer's very first login, which
  is this feature's highest-value scenario and something a unit test mocking `generateLink`'s
  response would never catch (per the live probe recorded in `docs/.pipeline-state.md`).
  `generateLink` must be called on the service-role client from BE-002; `verifyOtp` must be called
  on the existing cookie-writing SSR client (`src/utils/supabase/server.ts`) — calling `verifyOtp`
  on the service-role client mints a session nobody's browser receives. `getCurrentDbUser()`'s
  existing final `email`-fallback branch (`auth.ts:29-31` today) must be **preserved**, not removed
  — it's what keeps `admin-lockout.integration.test.ts` passing unmodified (see Test Churn Summary).
- **Definition of Done**:
  - `syncPrismaUser`'s resolution order is `id → authEmail (if email present) → OR-on-{email,phone}`,
    matching the TDD's code sample exactly, including the `needsAuthEmailBackfill`/`needsPromotion`
    update branch.
  - `resolveCustomerForPhoneLogin` creates a brand-new row with `authEmail:
    syntheticEmailForPhone(phone)` and `preferredLoginMethod: 'PHONE'` when no row matches `phone`,
    and backfills `authEmail` onto an existing phone-matched row that has none.
  - `mintSessionForAuthEmail` reads `type` from the `generateLink` response's own
    `properties.verification_type` — grep-verifiable: no string literal `'magiclink'` or `'signup'`
    appears as the `type` argument to `verifyOtp` anywhere in this function.
  - `getCurrentDbUser()`'s new middle step queries `authEmail`, and its final fallback step (query
    by real `email`) is unchanged from today's implementation.
  - `src/lib/auth.test.ts`'s two known-breaking assertions are fixed as part of this task (see Test
    Churn Summary) — this task is not complete until `npm test` is green for this file.
- **Estimated Complexity**: High — the most architecturally sensitive file in the whole expansion;
  correctness here is what stops phone and email login from creating duplicate accounts (the PRD's
  own top success metric).

### BE-006 · Refactor `src/lib/notifications/sms.ts` to read from `NotificationSettings`
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: BE-003
- **Description**: Replace `sendSms`'s `process.env.ARKESEL_API_KEY`/`ARKESEL_SENDER_ID` reads with
  `getNotificationSettings()`, adding the new independent `smsEnabled` check ahead of the existing
  "are credentials present" check.
- **Technical Notes**: **The Arkesel v1 query-string transport logic — the URL construction, the
  `response=json` param, the dual-signal success/failure mapping — must not change at all.** This
  file (`src/lib/notifications/sms.ts:33-92`) is explicitly called out as preserved, live-verified
  code (one real SMS sent, confirmed working). The only change is the config-read block at the top
  of `sendSms` (`:34-40` today): add `if (!settings.smsEnabled) return { success: false, reason:
  'sms_disabled' }` as a **new, distinct** no-op reason, independent of and checked before the
  existing `sms_not_configured` check (which now reads `settings.arkeselApiKey`/
  `settings.arkeselSenderId` instead of `process.env`). `sendOrderStatusSms`/`sendLowStockSms`
  (`:94-120`) call `sendSms` and need no change at all — they don't read config directly.
- **Definition of Done**:
  - `sendSms` calls `getNotificationSettings()` exactly once per invocation; no `process.env.
    ARKESEL_*` read remains anywhere in the file.
  - A settings row with `smsEnabled: false` (regardless of whether credentials are present) no-ops
    with `{ success: false, reason: 'sms_disabled' }` and never calls `fetch`.
  - A settings row with `smsEnabled: true` but a null `arkeselApiKey`/`arkeselSenderId` no-ops with
    `{ success: false, reason: 'sms_not_configured' }`, exactly matching today's message/behavior.
  - Every existing request-shape and success/failure-mapping assertion in `sms.test.ts` still
    describes true behavior once its setup is updated (TEST-005) — no transport-level change.
- **Estimated Complexity**: Medium — small code diff, but the "don't touch the transport logic"
  constraint means this needs a careful, surgical edit, not a rewrite.

### BE-007 · Refactor `src/lib/notifications/whatsapp.ts` to read from `NotificationSettings`
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: BE-003
- **Description**: Replace both `sendOrderStatusWhatsApp` and `sendLowStockWhatsApp`'s
  `process.env.WHATSAPP_*` reads (access token, phone number id, template name(s), template
  language) with `getNotificationSettings()`, adding an independent `whatsappEnabled` check ahead
  of the existing "are credentials present" check in each function.
- **Technical Notes**: `WHATSAPP_API_VERSION` is explicitly **excluded** from this refactor — it
  stays an env var (`whatsapp.ts:18-25`'s `graphUrl()` helper is unaffected). The Graph API request
  construction, header shape, and error-envelope handling (`:71-110`, `:134-168`) do not change.
  Two separate template names (`whatsappTemplateName`, `whatsappLowStockTemplateName`) must map to
  their respective functions exactly as the two env vars did — do not collapse them into one
  setting.
- **Definition of Done**:
  - Both exported functions call `getNotificationSettings()` and no longer read any
    `process.env.WHATSAPP_*` var except (indirectly, unchanged) `WHATSAPP_API_VERSION` inside
    `graphUrl()`.
  - `whatsappEnabled: false` no-ops both functions with a new, distinct `reason:
    'whatsapp_disabled'`, independent of credential presence.
  - `whatsappEnabled: true` with missing token/phone-number-id still no-ops with the existing
    `reason: 'whatsapp_not_configured'`.
  - `sendLowStockWhatsApp` continues to read `whatsappLowStockTemplateName`, never
    `whatsappTemplateName` — regression-tested by the existing "does not read
    WHATSAPP_TEMPLATE_NAME for the low-stock alert" case (`whatsapp.test.ts:333-340`), ported to
    the settings-mock shape in TEST-006.
- **Estimated Complexity**: Medium — same shape and risk profile as BE-006, doubled across two
  functions.

### BE-008 · Refactor `src/lib/notifications/email.ts` to read from `NotificationSettings` and fix the stale-client cache bug
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: BE-003
- **Description**: Replace `process.env.RESEND_API_KEY`/`FROM_EMAIL` reads in
  `sendOrderStatusEmail`/`sendLowStockAlert` with `getNotificationSettings()`, add an independent
  `emailEnabled` check, and remove the module-scope `_resend` singleton cache (`email.ts:3-9`) —
  construct a fresh `Resend(apiKey)` per call instead.
- **Technical Notes**: This is a **real bug fix**, not just a refactor, and the TDD calls it out
  explicitly: once the API key can change at runtime via the Settings UI with no redeploy, the
  existing singleton would keep using a stale/rotated-away key until the process restarts — a
  correctness gap that didn't exist before this expansion (there was no way to rotate the key
  without a redeploy, which also restarted the process). `Resend`'s client construction is cheap
  (no network call at construction time), so there is no meaningful performance cost to dropping
  the cache.
- **Definition of Done**:
  - No module-scope `let _resend` / `getResend()` singleton remains; a fresh `new Resend(apiKey)` is
    constructed inside each send function, reading the key from `getNotificationSettings()`.
  - `emailEnabled: false` no-ops with a new `reason: 'email_disabled'`, independent of whether
    `resendApiKey` is present.
  - `resendApiKey` absent (regardless of `emailEnabled`) no-ops with the existing `reason:
    'no_api_key'`.
  - A regression test (in TEST-008, since no `email.test.ts` exists today — see that task) proves
    two sequential calls with two different stored API keys each use their own key rather than a
    cached first one.
- **Estimated Complexity**: Medium — the accessor swap is mechanical, but the cache-removal fix
  needs its own explicit regression test to be verifiably fixed rather than just "probably fixed."

### BE-009 · Refactor the WhatsApp webhook route to read secrets from `NotificationSettings`
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: BE-003
- **Description**: Replace `process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN` (GET handler) and
  `process.env.WHATSAPP_APP_SECRET` (POST handler) in
  `src/app/api/webhooks/whatsapp/route.ts` with `getNotificationSettings()`.
- **Technical Notes**: **Every other line of this file is explicitly out of scope** — the raw-body-
  read-before-`JSON.parse` ordering (`:63`), the HMAC computation and `timingSafeEqual` length-guard
  (`:65-76`), and the fail-closed 403/503 status codes on missing secrets must be preserved exactly.
  The fail-closed behavior is a named Security Consideration in the TDD: when
  `NotificationSettings.whatsappWebhookVerifyToken`/`whatsappAppSecret` are unset (the real deployed
  state immediately after this ships, before the admin visits Settings — see Rollout Plan), `GET`/
  `POST` must continue to reject rather than silently accept unverified requests. This route stays
  unauthenticated by design (`requireAdmin()` does not apply — Meta calls this, not a logged-in
  admin) — do not add auth here.
- **Definition of Done**:
  - `GET` and `POST` both call `getNotificationSettings()` instead of reading
    `process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET`.
  - An empty/null `whatsappWebhookVerifyToken` still yields a 403 on `GET`; an empty/null
    `whatsappAppSecret` still yields a 503 on `POST` before the body is even read.
  - The route remains on the Node runtime (no `export const runtime = 'edge'` added) —
    `crypto.createHmac`/`timingSafeEqual` require it.
  - `npm run build` still registers this route as a dynamic, server-rendered function (matching
    today's confirmed build output).
- **Estimated Complexity**: Low — a narrow, well-bounded two-line-per-handler change with a strict
  "don't touch anything else" constraint.

### BE-010 · Create `src/app/auth/confirm/route.ts` — server-side redemption of `generateLink`'s hashed token
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: None (self-contained — uses only the existing `src/utils/supabase/server.ts`
  SSR client and `next/navigation`'s `redirect`)
- **Description**: **This was originally planned as a spike** ("verify whether `generateLink`'s
  `action_link` round-trips through `/auth/callback`"). A sibling `feature-developer` session ran
  that exact probe live against local Supabase before implementation began and got a conclusive
  answer: **it does not round-trip, and cannot be made to.** `admin.generateLink` returns an
  implicit-flow `action_link` whose session credentials arrive in the URL **fragment**
  (`#access_token=...&refresh_token=...&type=signup`), not a `?code=` query parameter — and
  browsers never transmit a URL fragment to the server on a `Location:` redirect, so a Server
  Component/route handler can never read it, no matter how `/auth/callback` is written. This is
  independently corroborable as basic web-platform behavior (RFC 3986: fragments are
  client-side-only), and separately matches Supabase's own documented pattern for exactly this
  situation. This task builds the resolution: a new `GET` route handler,
  `src/app/auth/confirm/route.ts`, that reads `token_hash` and `type` from the query string and
  redeems them **server-side** via `supabase.auth.verifyOtp({ token_hash, type })` on the existing
  cookie-writing SSR client — the same underlying Supabase call `mintSessionForAuthEmail` (BE-005)
  already uses, just reached by a clicked email link instead of an in-process Server Action call.
- **Technical Notes**:
  - Read `token_hash`/`type` from `new URL(request.url).searchParams` (a plain `Request`, not
    dynamic-route `params`, so Next.js 16's async-`params`/`searchParams` breaking change does not
    apply here — this route takes no dynamic segments).
  - **`type` must be passed through verbatim from whatever value the link's query string carries —
    never a hard-coded `'magiclink'` or `'signup'` literal** — this is the exact same binding
    directive BE-005's `mintSessionForAuthEmail` already follows for the phone-OTP path, now
    applied to this second, independent call site of `verifyOtp`. The peer session's probe returned
    `type=signup` for a first-time user (an admin-created customer's very first login link), which
    is precisely the case this route exists to handle correctly.
  - Call `verifyOtp` on `src/utils/supabase/server.ts`'s `createClient()` (the cookie-writing SSR
    client) — **not** `src/utils/supabase/admin.ts`'s service-role client (BE-002). This route
    needs no admin/service-role access at all; it only needs to write session cookies into the
    current, unauthenticated request/response cycle, exactly like `/auth/callback` does today for
    the PKCE flow.
  - On success, redirect to `/` (mirroring `auth/callback/route.ts`'s existing role-based landing
    logic, which already lives in `src/app/page.tsx` and will route on to `/admin`/`/dashboard` via
    `syncPrismaUser`, BE-015) or directly to a `next` param if one is present, matching
    `auth/callback/route.ts`'s existing `next` handling.
  - On a missing, expired, or otherwise-rejected `token_hash`, redirect to
    `/login?message=...` with a clear, generic message — never let `verifyOtp`'s error throw
    unhandled through the route handler.
  - This route **must** be reachable without an existing session (it *establishes* one) — do not
    add `requireAdmin()`/any auth guard, matching `/auth/callback`'s own unauthenticated-by-design
    posture.
  - `supabase/config.toml`'s `additional_redirect_urls = ["http://127.0.0.1:3000/*",
    "http://localhost:3000/*"]` already wildcard-allows this new path locally — no config change
    needed there for local dev; confirm the production Supabase project's redirect allow-list
    covers it before rollout (VERIFY-003).
  - **`/auth/callback/route.ts` itself is explicitly out of scope for this task and remains
    unchanged** — it stays the PKCE-only landing route for the browser-driven `signInWithOtp` flow
    that today's email magic-link login already uses (BE-014 only replaces its inline Prisma-sync
    block with `syncPrismaUser`, nothing about its `code`-exchange logic).
- **Definition of Done**:
  - `GET /auth/confirm?token_hash=<hash>&type=<type>` calls `verifyOtp({ token_hash, type })` on
    the SSR cookie client and, on success, results in a session cookie being set and a redirect
    away from `/auth/confirm`.
  - `type` is read from the request's own query string in every code path — grep-verifiable: no
    string literal appears as the `type` argument to `verifyOtp` in this file.
  - An invalid, expired, or already-consumed `token_hash` redirects to `/login?message=...` rather
    than throwing an unhandled error or rendering a raw 500.
  - The route has no `requireAdmin()`/session-required guard of any kind.
  - `src/app/auth/callback/route.ts` has zero diff attributable to this task.
- **Estimated Complexity**: Medium — small in line count, but it's a second, independent
  `verifyOtp` call site in the codebase and needs the same care BE-005 already requires around the
  `type` binding directive.

### BE-011 · Add `sendAccountCreatedEmail` to `src/lib/notifications/email.ts`
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: BE-008
- **Description**: New exported function `sendAccountCreatedEmail({ to, name, magicLink })` sending
  a transactional email with a working, click-to-log-in link, following this file's existing
  no-throw/try-catch/settings-gated shape.
- **Technical Notes**: `generateLink` itself does **not** send an email — Supabase only auto-sends
  for flows like `signInWithOtp`/`inviteUserByEmail`, not `admin.generateLink`. This function is
  what actually delivers the link, via the same `Resend` client BE-008 already refactored (fresh
  client per call, not the removed singleton). **This function itself has no dependency on
  BE-010** — it just formats an email body around whatever string it's handed as `magicLink`; it
  does not construct that URL and does not need to know it points at `/auth/confirm`. (Building
  the actual `/auth/confirm?token_hash=...&type=...` URL is BE-017's job, at the `createCustomer`
  call site — see that task's revised Technical Notes. The two were previously coupled only
  because BE-010 was a spike with an undetermined outcome; that coupling is gone now that the
  outcome is known.)
- **Definition of Done**:
  - `sendAccountCreatedEmail` no-ops (mirroring `sendOrderStatusEmail`'s existing shape) when
    `emailEnabled` is false or `resendApiKey` is unset, returning the same style of `{ success:
    false, reason }` result.
  - The email body includes a working link built from the `magicLink` parameter — no
    hard-coded fallback URL, and no assumption baked into this file about the URL's shape (e.g. no
    `action_link`-specific parsing).
  - This function never throws; a Resend API failure is caught and returned as `{ success: false,
    error }`, matching every other sender in this file.
- **Estimated Complexity**: Low — small, additive function following an established local template.

### BE-012 · Add `notifyAccountCreated` to `src/lib/notifications/index.ts`
- **Category**: Backend
- **Phase**: 2
- **Dependencies**: BE-006, BE-011
- **Description**: New exported function `notifyAccountCreated(data)` per the TDD's exact
  code sample — fans out to `sendAccountCreatedEmail` for an EMAIL-preferred customer with an email
  and a magic link, or `sendSms` for a PHONE-preferred customer with a phone, never both, never
  WhatsApp.
- **Technical Notes**: **The SMS copy in the TDD's own code sample (`"Welcome to Chop with Rostty!
  Visit our login page and enter your phone number to receive a login code."`) does not include a
  site URL — but the locked decision for the PRD's Open Question #1 (recorded in
  `docs/.pipeline-state.md`, not restated in the TDD's code block) requires pointing the customer at
  `NEXT_PUBLIC_SITE_URL`, not just a generic "visit our login page" phrase.** Implement the actual
  copy with the real URL interpolated in, not the TDD's literal example text, and put the copy in
  one named constant (e.g. `ACCOUNT_CREATED_SMS_MESSAGE` or a small template function) so the
  wording can be revised later without touching fan-out logic — this was the explicit reasoning
  behind that locked decision. `./whatsapp` must **not** be imported into this function at all — no
  new WhatsApp sender, no `account_created` template, not even as a no-op branch (PRD Non-Goals,
  reiterated forcefully in the TDD's Domain & Service Layer section and the pipeline-state's scope
  correction). Neither branch is a fallback for the other — a `PHONE`-preferred customer's SMS
  failing does not trigger an email attempt, and vice versa; each branch is gated purely on
  `preferredLoginMethod` plus the matching contact field's presence.
- **Definition of Done**:
  - `notifyAccountCreated({ preferredLoginMethod: 'EMAIL', customerEmail, magicLink, ... })` calls
    `sendAccountCreatedEmail` exactly once and never calls `sendSms`.
  - `notifyAccountCreated({ preferredLoginMethod: 'PHONE', customerPhone, ... })` calls `sendSms`
    exactly once, with the site-URL-inclusive copy, and never calls any email function.
  - A name-only customer (`customerEmail: null, customerPhone: null`) — a case
    `createCustomerSchema` legitimately allows — resolves to `{}` with neither branch firing, and
    the function never throws.
  - `grep`-verifiable: this file has zero import of anything from `./whatsapp`.
- **Estimated Complexity**: Medium — small in code size, but the site-URL copy correction and the
  strict "no WhatsApp, ever, for this notification" constraint are both easy to get subtly wrong.

---

## Phase 3: Server Actions & Route Wiring

### BE-013 · Implement `requestPhoneOtp`/`verifyPhoneOtp` in `src/app/login/actions.ts`
- **Category**: Backend
- **Phase**: 3
- **Dependencies**: BE-001, BE-003, BE-005, BE-006
- **Description**: Two new, public (pre-auth) Server Actions per the TDD's exact code sample:
  `requestPhoneOtp` generates and SMS-delivers a code with per-phone cooldown enforcement;
  `verifyPhoneOtp` validates it with a race-safe attempt cap and, on success, mints a real session
  via `resolveCustomerForPhoneLogin` + `mintSessionForAuthEmail`.
- **Technical Notes**: Both actions are **intentionally not `requireAdmin()`-gated** — this is the
  pre-authentication login flow, the same trust boundary as today's `login()` action in this same
  file. Both must independently re-check `LoginSettings.phoneLoginEnabled` and
  `NotificationSettings.smsEnabled`/`arkeselApiKey` on **every call**, not just once at page render
  — every Server Action in this app is an independently-POST-able endpoint (the same reasoning the
  existing Phase 0 hardening work already established for admin actions, now applied to a public
  one). The attempt-cap guard **must** use the race-safe `updateMany`-with-conditional-`WHERE`
  pattern from the TDD (`{ where: { id, attempts: { lt: MAX_OTP_ATTEMPTS }, consumedAt: null } }`),
  mirroring the same TOCTOU-safe pattern already established for stock decrement
  (`decrementStockOrThrow` in `src/lib/inventory.ts`) — a plain find-then-update has a gap two
  concurrent verify calls could both slip through. Error messages must stay generic (`'Incorrect
  code.'`, never a remaining-attempts count) per the PRD's explicit anti-brute-force requirement.
- **Definition of Done**:
  - `requestPhoneOtp` rejects with a generic message (not exposing which check failed) when
    `phoneLoginEnabled`/`smsEnabled`/`arkeselApiKey` isn't fully satisfied, before creating any
    `OtpCode` row.
  - A second `requestPhoneOtp` call for the same phone inside 60 seconds of a prior success is
    rejected with the cooldown message, without creating a new row.
  - `verifyPhoneOtp` rejects an expired or already-consumed code, rejects after 5 incorrect
    attempts on the same code, and never reveals a remaining-attempts count in any rejection
    message.
  - A correct, unexpired, under-cap code succeeds, marks the `OtpCode` row `consumedAt`, and
    returns `{ ok: true, data: { redirectTo: '/admin' | '/dashboard' } }` based on the resolved
    user's role.
  - Any thrown error from `resolveCustomerForPhoneLogin`/`mintSessionForAuthEmail` is caught and
    returned as an `ActionResult` failure (`toErrorResult`), never an unhandled rejection.
- **Estimated Complexity**: High — the highest-stakes action pair in this expansion; combines rate
  limiting, a race-safe counter, hashing, and cross-module session minting in two functions.

### BE-014 · Replace `src/app/auth/callback/route.ts`'s inline sync block with `syncPrismaUser`
- **Category**: Backend
- **Phase**: 3
- **Dependencies**: BE-005
- **Description**: Delete the route's own inline `prisma.user.findFirst`/`create`/`update` block
  (`route.ts:26-55`) and replace it with a single call:
  `const dbUser = await syncPrismaUser({ id: user.id, email: user.email, phone: user.phone })`.
- **Technical Notes**: This route currently guards the whole sync block on `user?.email` (`:28`) —
  that guard must be removed too, since `syncPrismaUser` now correctly handles a phone-only
  `authUser`, purely for defense-in-depth and consistency with the shared function's own contract.
  **Note (post-plan correction — see this document's Revision note):** in practice, neither
  BE-010's `/auth/confirm` route nor BE-013's phone-OTP path ever redirects through
  `/auth/callback` — `/auth/callback` remains reachable only via the browser-driven, PKCE
  `signInWithOtp` flow `login/actions.ts` already uses, where `authUser.email` is always present.
  This task's justification is therefore the TDD's general prerequisite-fix mandate (one shared
  identity-resolution function, not three independently-drifting inline copies), not a claim that
  phone-only sessions route through this specific file. Everything else in this file — the
  deliberate non-`origin`-based redirect-URL construction and its explanatory comment (`:6-16`),
  the PKCE `exchangeCodeForSession` call — is unrelated to this task and must not change.
- **Definition of Done**:
  - No inline `prisma.user.findFirst`/`create`/`update` or `isAdmin` computation remains in this
    file — all of it now lives in `syncPrismaUser`/`isAdminIdentity`.
  - The route still redirects to `${origin}${next}` on success and to the existing error-message
    redirect on failure, unchanged.
  - A phone-only `authUser` (email absent, a synthetic-email-carrying session) now syncs correctly
    instead of being silently skipped by the old `if (user?.email)` guard.
- **Estimated Complexity**: Low — a deletion-and-substitution task once BE-005 exists.

### BE-015 · Replace `src/app/page.tsx`'s inline sync block with `syncPrismaUser`
- **Category**: Backend
- **Phase**: 3
- **Dependencies**: BE-005
- **Description**: Delete the landing page's own inline `prisma.user.findFirst`/`create`/`update`
  block (`page.tsx:16-42`) and replace it with the same `syncPrismaUser` call as BE-014.
- **Technical Notes**: This file's existing `OR: [{email}, {phone}]` lookup (`:18-22`) is exactly
  the kind of partial, independently-drifting sync logic the TDD's prerequisite fix is meant to
  retire — do not leave it as a second, parallel path.
- **Definition of Done**:
  - No inline `prisma.user.findFirst`/`create`/`update` or local `isAdmin` computation remains in
    this file.
  - The role-based redirect to `/admin` vs `/dashboard` (`:44-48`) is preserved, now driven by
    `syncPrismaUser`'s returned `dbUser.role`.
- **Estimated Complexity**: Low — same shape as BE-014.

### BE-016 · Create `src/app/admin/settings/actions.ts`
- **Category**: Backend
- **Phase**: 3
- **Dependencies**: BE-003, BE-004
- **Description**: Three new `requireAdmin()`-gated Server Actions: `getSettings()` (returns the
  masked notification shape plus the raw `LoginSettings` row), `updateNotificationSettings(data)`,
  and `updateLoginSettings(data)`.
- **Technical Notes**: `updateNotificationSettings` must implement "blank secret field = keep
  stored value" — for each secret field, if the incoming value is an empty/whitespace string (after
  `.trim()`), write `undefined` (Prisma no-op for that field) rather than overwriting the stored
  value with `''`. Non-secret fields (from-email, sender id, template name/language, the three
  `*Enabled` flags) always overwrite, matching a normal form submission. Follow this codebase's
  established `ActionResult<T>`/`toErrorResult` convention (`src/lib/errors.ts`) — do not invent a
  new response shape for these three actions.
- **Definition of Done**:
  - All three actions call `requireAdmin()` first and let `AuthError` propagate unwrapped, matching
    every other read/write action pair in this app (`getCustomers()`/`createCustomer()` in
    `customers/actions.ts` as the reference pattern).
  - Submitting `updateNotificationSettings` with a blank `arkeselApiKey` field, when a real key is
    already stored, leaves the stored key unchanged — verified by TEST-012.
  - Submitting `updateNotificationSettings` with a non-blank `arkeselApiKey` field overwrites the
    stored value.
  - `updateLoginSettings` calls `revalidatePath('/admin/settings')` on success, matching this
    codebase's mutation convention.
- **Estimated Complexity**: Medium — the "blank means keep" semantics are easy to get backwards
  (accidentally clearing a secret on every save that doesn't touch that field).

### BE-017 · Wire account creation and preferred-login-method into `src/app/admin/customers/actions.ts`
- **Category**: Backend
- **Phase**: 3
- **Dependencies**: BE-002, BE-004, BE-010, BE-011, BE-012
- **Description**: `createCustomer` computes an explicit `preferredLoginMethod` (input value if
  provided, else `email ? 'EMAIL' : phone ? 'PHONE' : 'EMAIL'`), calls
  `createAdminClient().auth.admin.generateLink({ type: 'magiclink', email: input.email })` when the
  resolved method is `EMAIL` and an email is present, builds a `magicLink` URL from that response
  pointing at BE-010's new route, and calls `notifyAccountCreated` fire-and-forget with the
  resulting data. `updateCustomer` picks up `preferredLoginMethod` as a normal field write; its new
  blank-out protection comes entirely from BE-004's schema refinement, no new logic needed in this
  file.
- **Technical Notes**: **Corrected post-plan** (see this document's Revision note): the `magicLink`
  passed to `notifyAccountCreated`/`sendAccountCreatedEmail` is **not** `generateLink`'s
  `action_link` field — that field's redemption path was empirically confirmed to be broken for a
  server-rendered app (see BE-010). Build it instead as:
  ```ts
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: input.email })
  const magicLink = data?.properties
    ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=${data.properties.verification_type}`
    : null
  ```
  **`type` in that URL must be `data.properties.verification_type` read back from the response —
  never a hard-coded `'magiclink'` or `'signup'` literal** — the same binding directive as
  everywhere else this pattern appears in this expansion (BE-005, BE-010). Passing
  `options: { redirectTo: ... }` to this `generateLink` call is no longer necessary — this task
  never follows `action_link`, so Supabase's own redirect-URL validation on that field is moot for
  this call site; omit it unless a future need arises. **Fire-and-forget, exactly like every other
  notification call site in this app** (`src/app/admin/orders/actions.ts:116`, `:132`, `:189`) —
  call `notifyAccountCreated(...)` without `await`ing it in a way that blocks or fails the
  customer-creation response, and never inside the `prisma.$transaction` this action may otherwise
  use. The Prisma column default (`EMAIL`) on `preferredLoginMethod` is a safe fallback for the
  name-only-customer edge case only — this task must still always compute an explicit value rather
  than relying on the DB default for a customer who does have contact info. A name-only customer
  produces no magic link (no email to send it to) and `notifyAccountCreated` no-ops cleanly per
  BE-012 — this must never surface as an error or fail the `createCustomer` response. A
  `generateLink` failure (`error` present, or `data.properties` absent) must also degrade to
  `magicLink: null` rather than throwing — `createCustomer` itself must still succeed even if the
  link generation fails, consistent with this app's fire-and-forget notification discipline.
- **Definition of Done**:
  - `createCustomer({ name, email })` (no phone) with no explicit `preferredLoginMethod` persists
    `preferredLoginMethod: 'EMAIL'`, calls `generateLink`, builds a `magicLink` pointing at
    `${NEXT_PUBLIC_SITE_URL}/auth/confirm?token_hash=...&type=...` (never at `action_link` or at
    `/auth/callback`), and fires `notifyAccountCreated` with that link.
  - `createCustomer({ name, phone })` (no email) persists `preferredLoginMethod: 'PHONE'`, calls no
    `generateLink`, and fires `notifyAccountCreated` with `customerPhone` set and `magicLink: null`.
  - `createCustomer({ name })` (neither contact method) succeeds, persists the schema default
    (`EMAIL`), and `notifyAccountCreated` no-ops with no thrown error and no crash — verified by
    TEST-011.
  - A `generateLink` failure results in `magicLink: null` being passed onward, not a thrown error —
    `createCustomer`'s returned `ActionResult` is unaffected either way.
  - A notification failure (e.g. `notifyAccountCreated` internally logging an SMS no-op) never
    changes `createCustomer`'s returned `ActionResult` — the customer row is created and returned
    regardless.
- **Estimated Complexity**: Medium — the magic-link generation is new plumbing this file didn't
  have before, and the fire-and-forget discipline is easy to accidentally violate with an
  unnecessary `await`.

---

## Phase 4: Frontend

### FE-001 · Create `src/components/ui/switch.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: None
- **Description**: A thin wrapper around `@base-ui/react/switch`'s `Switch.Root`/`Switch.Thumb`,
  matching `src/components/ui/dialog.tsx`'s existing wrapper convention exactly.
- **Technical Notes**: Confirmed present in this repo's installed `@base-ui/react@1.6.0`
  (`node_modules/@base-ui/react/package.json`'s `exports` map lists `./switch`) — this is a real,
  installed subpath, not an assumption. Import as `import { Switch as SwitchPrimitive } from
  "@base-ui/react/switch"`, matching the exact naming convention `dialog.tsx` uses for its own
  primitive import. Add `data-slot="switch"` and merge `className` via `cn()`, matching every other
  wrapper in `components/ui/`.
- **Definition of Done**:
  - `Switch` is exported, renders `Switch.Root`/`Switch.Thumb`, and accepts/forwards standard
    props (`checked`, `onCheckedChange`, `disabled`) plus `className`.
  - Visually consistent with this app's existing dark enterprise theme (uses the same
    `bg-primary`/`ring-ring` token vocabulary as `button.tsx`/`input.tsx`).
- **Estimated Complexity**: Low.

### FE-002 · Create `src/components/ui/tabs.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: None
- **Description**: A thin wrapper around `@base-ui/react/tabs`, same convention as FE-001.
- **Technical Notes**: Also confirmed present in the installed package's `exports` map (`./tabs`).
  Needs at minimum `Tabs`, `TabsList`, `TabsTrigger`, `TabsPanel`/`TabsContent` exports (naming to
  match Base UI's actual `Tabs.Root`/`Tabs.List`/`Tabs.Tab`/`Tabs.Panel` primitives) — both FE-003
  (login page's Email/Phone switcher) and FE-006 (Settings' Notifications/Login switcher) depend on
  this file's exact export names, so pick them once here and keep them consistent across both call
  sites.
- **Definition of Done**:
  - Exports cover root, list, trigger, and panel, each with `data-slot` attributes and `cn()`-merged
    `className`, matching the dialog.tsx convention.
  - Keyboard navigation (arrow keys between tabs) works out of the box via the underlying Base UI
    primitive — no custom keyboard handling added.
- **Estimated Complexity**: Low.

### FE-003 · Make `src/app/login/page.tsx` settings-aware with an Email/Phone tab switcher
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: FE-002, BE-016 (reuses `getLoginSettings`/`getNotificationSettings`, not the
  admin-gated actions themselves — see Technical Notes)
- **Description**: This already-async Server Component fetches `LoginSettings` and
  `NotificationSettings` server-side and conditionally renders the Phone tab only when
  `phoneLoginEnabled && smsEnabled && arkeselApiKey` are all true — otherwise it renders exactly
  today's single email form, unchanged.
- **Technical Notes**: Call `getLoginSettings()`/`getNotificationSettings()` from `src/lib/settings.ts`
  directly (BE-003) — **not** `getSettings()` from BE-016, which is `requireAdmin()`-gated and would
  incorrectly block this public, pre-auth page. The PRD is explicit that the Phone tab must be
  "hidden entirely" (not just visually disabled) when unavailable — this is a server-side rendering
  decision, not a client-side conditional, so a customer with JS disabled or dev tools open never
  sees a tab that leads nowhere.
- **Definition of Done**:
  - When phone login is fully available, both tabs render and the existing email form (`login()`
    action, unchanged) still works exactly as today when the Email tab is active.
  - When any one of `phoneLoginEnabled`/`smsEnabled`/`arkeselApiKey` is false/absent, only the email
    form renders — no Phone tab exists in the server-rendered HTML at all.
  - The existing `message` query-param banner (`:59-74`) still renders for both tabs.
- **Estimated Complexity**: Medium — the "hidden entirely, not just disabled" requirement needs the
  gating to happen server-side, before any client hydration.

### FE-004 · Create `src/app/login/PhoneLoginForm.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: FE-003, BE-013
- **Description**: A new `"use client"` component implementing the two-step phone-login UI: a
  phone-number input calling `requestPhoneOtp`, then an inline 6-digit code-entry step using
  `@base-ui/react/otp-field`'s `OTPField.Root`/`OTPField.Input`, wired to `verifyPhoneOtp` via
  `onValueComplete` for auto-submit once all 6 digits are entered.
- **Technical Notes**: `otp-field` is confirmed present in this repo's installed `@base-ui/react`
  (`./otp-field` in the package's `exports` map) — not a hand-rolled 6-input hack. Auto-submit on
  completion (rather than a separate "Verify" button tap) is a deliberate UX call in the TDD for a
  non-technical, one-handed mobile user — keep it. The retry-cooldown UI is a **static** message
  ("please wait before requesting another code") per the locked decision on the PRD's Open Question
  #2 — do **not** build a live countdown timer; this was explicitly decided to avoid advertising
  exact rate-limit timing and to avoid timer-state complexity. On a wrong code, show a generic
  "Incorrect code" message and keep the code-entry step open for retry, per the PRD's UX Flow
  Summary — never a remaining-attempts count (matches BE-013's server-side message discipline).
- **Definition of Done**:
  - Submitting a phone number calls `requestPhoneOtp` and, on success, reveals the 6-digit
    `OTPField` inline on the same page — no navigation/route change.
  - Entering all 6 digits auto-submits via `verifyPhoneOtp` without a separate button press.
  - A `requestPhoneOtp` cooldown rejection shows the static message, not a countdown.
  - A `verifyPhoneOtp` failure shows "Incorrect code" (or the server's exact generic message) and
    leaves the code-entry step open, not the phone-number step.
  - On success, the browser navigates to the `redirectTo` the action returned (`/admin` or
    `/dashboard`).
- **Estimated Complexity**: High — the most interactive new UI in this expansion, coordinating
  two-step client state with two different server actions and a not-yet-used-anywhere-in-this-repo
  Base UI primitive.

### FE-005 · Create `src/app/admin/settings/page.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: BE-016
- **Description**: A new Server Component calling `requireAdmin()`, fetching
  `getMaskedNotificationSettings()` + `getLoginSettings()`, and passing both as `initialData` to
  `SettingsClient` — matching the `page.tsx`/`*Client.tsx`/`actions.ts` convention every other admin
  screen in this app already follows (`src/app/admin/inventory/page.tsx` as the reference).
- **Technical Notes**: Calling `requireAdmin()` here is intentionally redundant with
  `src/app/admin/layout.tsx`'s own route-level gate (`layout.tsx:14-19`) — this matches the TDD's
  explicit "every Settings mutation is `requireAdmin()`-gated, same as every other admin action"
  principle, applied here to the read path too, and mirrors this app's existing pattern of actions
  re-verifying rather than trusting the layout alone.
- **Definition of Done**:
  - Page throws/redirects via `requireAdmin()`'s existing `AuthError` behavior for a non-admin
    session (defense in depth alongside the layout gate).
  - `SettingsClient` receives both the masked notification settings and the login settings as
    props, typed against BE-003's return shapes.
- **Estimated Complexity**: Low.

### FE-006 · Create `src/app/admin/settings/SettingsClient.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: FE-001, FE-002, BE-016
- **Description**: A new `"use client"` component with two `Tabs` panels — Notifications and Login
  — matching the TDD's UX Flow Summary. Notifications: one card per channel (Email/SMS/WhatsApp)
  with masked secret `Input`s and a `Switch`. Login: two independent `Switch` toggles (Email login,
  Phone login), with the Phone login toggle visually disabled and annotated when SMS isn't fully
  configured+enabled yet.
- **Technical Notes**: Secret fields render blank/masked — "•••• saved" once configured, **never**
  round-tripping the real secret to the browser (this is enforced upstream by
  `getMaskedNotificationSettings()`'s shape in BE-003/FE-005; this component just needs to render
  that shape correctly, e.g. a placeholder of `"•••• saved"` when `arkeselApiKeySet: true` and an
  empty placeholder otherwise). Calls `updateNotificationSettings`/`updateLoginSettings`
  (BE-016) and optimistically updates local state on success, same convention as
  `CustomerClient.tsx`'s `handleAdd`/`handleEdit`. The "Phone login toggle visually disabled" state
  is UI-only politeness — BE-013's server-side re-checks are the actual enforcement boundary, not
  this component.
- **Definition of Done**:
  - Every secret `Input` shows a masked placeholder (never a real value) when its corresponding
    `*Set` boolean is true, and an empty field otherwise.
  - Submitting a Notifications-tab card with a secret field left blank does not visually or
    functionally suggest the secret was cleared (matches BE-016's "blank = keep" semantics).
  - The Phone login `Switch` is disabled with a visible explanatory note when
    `smsEnabled && arkeselApiKeySet` isn't both true, per the PRD's UX Flow Summary point 6.
  - A successful save updates the local `initialData` state without a full page reload
    (`revalidatePath` alone, matching every other `*Client.tsx` mutation flow).
- **Estimated Complexity**: High — the most complex admin UI in this expansion (two tabs, multiple
  cards, masked-secret semantics, a conditionally-disabled toggle).

### FE-007 · Add a Settings entry to `src/components/layout/Sidebar.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: FE-005 (soft — the nav entry is meaningless without a route to point at)
- **Description**: One new nav item, `{ name: 'Settings', href: '/admin/settings', icon: <lucide
  icon>, exact: false }`, added to the existing `MANAGEMENT` section (alongside Inventory, Menu,
  Customers) in `navItems` (`Sidebar.tsx:9-19`).
- **Technical Notes**: Use a lucide-react icon already a dependency of this project (e.g.
  `Settings` from `lucide-react`, matching the existing `LayoutDashboard`/`Users`/`Package`/
  `ShoppingCart`/`UtensilsCrossed` import style on `Sidebar.tsx:6`). No structural change to the
  `{ label, items: [...] }` grouping shape.
- **Definition of Done**:
  - A "Settings" link appears in the sidebar's MANAGEMENT section, navigating to
    `/admin/settings`.
  - Active-route highlighting (`isActive`, `Sidebar.tsx:29-31`) works for this new entry exactly as
    it does for the other four.
- **Estimated Complexity**: Low.

### FE-008 · Add "Preferred login method" to `src/app/admin/customers/CustomerClient.tsx`
- **Category**: Frontend
- **Phase**: 4
- **Dependencies**: BE-004, BE-017
- **Description**: Both the Add and Edit customer dialogs (`CustomerClient.tsx:167-216`) gain a
  `<select>` for `preferredLoginMethod`, with its options filtered to whichever of email/phone are
  currently filled in on the form.
- **Technical Notes**: This needs to be a **controlled** field reacting to the email/phone inputs'
  live values (to filter the available options), which is a step up in interactivity from this
  form's current fully-uncontrolled `<Input defaultValue=...>` pattern (`:203-212`) — introduce
  local `useState` for email/phone/preferredLoginMethod specifically for this dialog, without
  converting the rest of the form to controlled inputs unnecessarily. Never offer a choice the
  current form state can't support, mirroring this app's existing `optionsForRow`-style
  reinjection spirit noted in the TDD.
- **Definition of Done**:
  - With only an email filled in, the select offers only `EMAIL`.
  - With only a phone filled in, the select offers only `PHONE`.
  - With both filled in, both options are offered.
  - Submitting the form sends `preferredLoginMethod` to `createCustomer`/`updateCustomer`, and a
    server-side rejection (BE-004's refinement) surfaces via this form's existing `alert(result.
    error)` pattern (`:127-129`, `:145-147`) — no new error-display mechanism introduced.
- **Estimated Complexity**: Medium — the option-filtering-by-live-form-state requirement is more
  interactive than anything else in this specific file today.

---

## Phase 5: Testing

### TEST-001 · `src/lib/otp.test.ts` (new)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-001
- **Description**: Unit tests for `generateOtpCode`, `hashOtpCode`, `verifyOtpCodeHash`.
- **Technical Notes**: Mirror the webhook route's existing `timingSafeEqual` length-guard test
  style. Include a "never logs the OTP secret/hash" style assertion if any logging is added (none
  is expected in this pure module, but the check costs little and matches this codebase's
  established `PROACTIVE-001`-style vigilance for secret-adjacent code).
- **Definition of Done**:
  - `generateOtpCode()` produces a 6-digit, zero-padded numeric string across many samples
    (including the edge case of a randomly-generated value below `100000`, to catch a missing
    `padStart`).
  - `hashOtpCode`/`verifyOtpCodeHash` round-trip correctly for a real code.
  - `verifyOtpCodeHash` returns `false`, not a thrown error, for a stored hash of the wrong length.
  - `hashOtpCode` throws when `OTP_HASH_SECRET` is unset (`vi.stubEnv`).
- **Estimated Complexity**: Low.

### TEST-002 · `src/lib/auth.test.ts` (extend + fix known-breaking assertions)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-005
- **Description**: Fix the two breaking assertions identified in the Test Churn Summary, and add
  new coverage for `syncPrismaUser`'s id/authEmail/email resolution and backfill-vs-create
  branches, `resolveCustomerForPhoneLogin`'s create/backfill/already-synced branches, and
  `getCurrentDbUser`'s new `authEmail` fallback step — all with mocked Prisma, per this file's
  existing style.
- **Technical Notes**: See "Test Churn Summary" above for the exact fix required to
  `:80-93`/`:122-127`. New cases to add: (a) `syncPrismaUser` finds an existing row by `authEmail`
  and does no write (already-synced, common case); (b) `syncPrismaUser` finds a pre-existing
  admin-created row by real `email`/`phone` with no `authEmail` yet and backfills it; (c)
  `syncPrismaUser` creates a brand-new row when nothing matches; (d) `resolveCustomerForPhoneLogin`
  creates a new row with a synthetic `authEmail` when no `phone` match exists; (e)
  `resolveCustomerForPhoneLogin` backfills `authEmail` onto an existing phone-matched row with none;
  (f) the `isAdmin`-promotion branch fires in both `syncPrismaUser` and
  `resolveCustomerForPhoneLogin` when the identity matches `ADMIN_EMAIL`/`ADMIN_PHONE`.
- **Definition of Done**:
  - `npm test -- auth.test.ts` is fully green, including the two fixed cases.
  - Every branch listed above has at least one dedicated test.
  - No test in this file makes a real Prisma/Supabase call — `prisma.user.*` and `createClient`
    remain fully mocked, matching this file's existing convention.
- **Estimated Complexity**: Medium — mostly additive, but the two fixes require care to get the
  exact new call sequence right.

### TEST-003 · `src/lib/settings.test.ts` (new)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-003
- **Description**: Unit tests for the singleton get-or-create behavior of
  `getNotificationSettings`/`getLoginSettings`, and for `getMaskedNotificationSettings`'s masked
  shape.
- **Technical Notes**: Mock `prisma.notificationSettings.findFirst`/`create` and
  `prisma.loginSettings.findFirst`/`create` directly (this codebase's established mocking style for
  Prisma-touching unit tests, per `auth.test.ts`).
- **Definition of Done**:
  - `getNotificationSettings()`/`getLoginSettings()` call `create()` only when `findFirst()` returns
    `null`, and return the existing row unchanged otherwise.
  - `getMaskedNotificationSettings()`'s output, `JSON.stringify`-checked against a seeded real
    secret value (e.g. `'super-secret-key'`), never contains that string anywhere in the result.
  - `getMaskedNotificationSettings()`'s `*Set` booleans correctly reflect presence/absence for
    each of the five secret fields independently.
- **Estimated Complexity**: Low.

### TEST-004 · `src/app/login/actions.test.ts` (new)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-013
- **Description**: Unit tests for `requestPhoneOtp`/`verifyPhoneOtp` per the TDD's Testing Strategy
  — cooldown rejection, invalid-phone rejection, disabled/unconfigured rejection for
  `requestPhoneOtp`; expired/missing-code, attempt-cap, wrong-code rejection, and correct-code
  success for `verifyPhoneOtp`.
- **Technical Notes**: Mock `prisma.otpCode.*`, `sendSms`, `getLoginSettings`/
  `getNotificationSettings`, and `resolveCustomerForPhoneLogin`/`mintSessionForAuthEmail` — this is
  a unit test, not an integration test, so no real DB or Supabase call. Include a case proving the
  attempt-cap guard uses the `updateMany`-with-`WHERE`-conditional pattern correctly: mock
  `prisma.otpCode.updateMany` to return `{ count: 0 }` (simulating a code already at the cap or
  already consumed) and assert the action rejects **without** ever calling
  `verifyOtpCodeHash` — this is the regression test for the TOCTOU-safe design itself, not just the
  cap's numeric threshold.
- **Definition of Done**:
  - Every branch named in the TDD's Testing Strategy for this file has a dedicated test.
  - The `updateMany`-count-zero-means-reject-before-hash-check case is present and passes.
  - No test asserts a specific remaining-attempts count in any error message (would itself be a
    regression against the "generic error" security requirement).
- **Estimated Complexity**: Medium — the most business-logic-dense action pair in this expansion.

### TEST-005 · `src/lib/notifications/sms.test.ts` (config-layer rewrite)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-006
- **Description**: Replace `stubConfiguredEnv()` (`:24-27`) and every `vi.stubEnv('ARKESEL_...')`
  call site with a `getNotificationSettings` mock (`vi.mock('@/lib/settings', ...)`), keeping every
  existing request-shape/success-failure-mapping assertion intact. Add new cases proving
  `smsEnabled`/credential-presence are checked independently.
- **Technical Notes**: See Test Churn Summary for exactly which lines become inert. New cases to
  add: `smsEnabled: false` with valid credentials present → `{ success: false, reason:
  'sms_disabled' }`, no `fetch` call; `smsEnabled: true` with credentials absent → the existing
  `sms_not_configured` reason, unchanged.
- **Definition of Done**:
  - No `vi.stubEnv('ARKESEL_...')` call remains anywhere in this file.
  - Every existing assertion this file made about the v1 query-string request shape, the
    success/failure body mapping, and the "no secrets in logs" cases still passes, unmodified in
    intent (mechanically rewritten only where the setup needed to change).
  - The two new independence cases above are present.
- **Estimated Complexity**: Medium — large mechanical diff, low logical risk given the transport
  layer itself is untouched.

### TEST-006 · `src/lib/notifications/whatsapp.test.ts` (config-layer rewrite)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-007
- **Description**: Same treatment as TEST-005, applied to `whatsapp.test.ts`'s `stubConfiguredEnv()`
  (`:26-33`) and every `vi.stubEnv('WHATSAPP_...')` call site.
- **Technical Notes**: New cases: `whatsappEnabled: false` → `reason: 'whatsapp_disabled'`, no
  `fetch` call, for both `sendOrderStatusWhatsApp` and `sendLowStockWhatsApp`. Preserve the existing
  "uses a template DISTINCT from the order-status one" (`:321-331`) and "does not read
  WHATSAPP_TEMPLATE_NAME for the low-stock alert" (`:333-340`) cases — these prove the two template
  settings fields stay independent, which remains true after the refactor and must stay tested.
- **Definition of Done**:
  - No `vi.stubEnv('WHATSAPP_...')` call remains anywhere in this file.
  - All existing request-body/failure-mapping/no-secrets-in-logs assertions still pass.
  - The new `whatsapp_disabled` independence case is present for both exported functions.
- **Estimated Complexity**: Medium — same profile as TEST-005, doubled across two functions.

### TEST-007 · `src/app/api/webhooks/whatsapp/route.test.ts` (config-layer rewrite)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-009
- **Description**: Same treatment again, replacing every `vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN'
  , ...)`/`vi.stubEnv('WHATSAPP_APP_SECRET', ...)` call with a settings mock.
- **Technical Notes**: The fail-closed 403 (GET)/503 (POST) behavior on an unset secret is the
  single most security-relevant assertion in this file — make sure the rewritten setup still
  produces a genuinely "unset" `NotificationSettings` row for those specific cases (e.g. `{
  whatsappWebhookVerifyToken: null }}`) rather than accidentally leaving a real value populated by
  a shared mock default.
- **Definition of Done**:
  - No `vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN'|'WHATSAPP_APP_SECRET', ...)` call remains.
  - The fail-closed 403/503 cases and the successful-handshake/valid-signature cases all still
    pass.
  - The HMAC-signing test helper (`sign()`, `:35-37`) and the raw-body-read ordering assertions are
    untouched — this task only changes how the route learns its secret, not the crypto.
- **Estimated Complexity**: Medium.

### TEST-008 · `src/lib/notifications/email.test.ts` (new — despite the TDD's "extend" phrasing)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-008, BE-011
- **Description**: **No `email.test.ts` file exists in this repository today** — a grep/glob check
  confirms it (unlike `sms.test.ts`/`whatsapp.test.ts`, which do exist). The TDD's Testing Strategy
  says "extend `src/lib/notifications/{sms,email,whatsapp}.test.ts`," which is only accurate for two
  of the three files; this task creates `email.test.ts` from scratch, covering both the
  existing (`sendOrderStatusEmail`, `sendLowStockAlert`) and new (`sendAccountCreatedEmail`)
  functions plus the settings-accessor refactor and the singleton-cache removal.
- **Technical Notes**: This is the one regression test that actually proves BE-008's cache-removal
  bug fix worked, not just that the code compiles: call a send function twice with two different
  mocked `resendApiKey` values (via two different `getNotificationSettings` mock resolutions) and
  assert the underlying `Resend` constructor (mocked) was called with each distinct key — a lingering
  singleton would fail this by using only the first key both times.
- **Definition of Done**:
  - `emailEnabled: false` no-ops with `reason: 'email_disabled'` for all three functions, without
    constructing a `Resend` client.
  - `resendApiKey` absent no-ops with the existing `reason: 'no_api_key'`.
  - The two-different-keys-in-sequence regression test above is present and passes.
  - `sendAccountCreatedEmail` is covered for both its no-op and successful-send paths, including
    that the sent email actually contains the passed `magicLink` value.
- **Estimated Complexity**: Medium — new file, but follows `sms.test.ts`/`whatsapp.test.ts`'s
  established structure closely.

### TEST-009 · `src/lib/notifications/index.test.ts` (extend)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-012
- **Description**: Add `describe('notifyAccountCreated', ...)` covering the EMAIL-preferred vs.
  PHONE-preferred branching, the name-only-customer no-op case, and the
  phone-preferred-with-SMS-disabled no-op case, mocking only `./email`/`./sms` (not `./whatsapp` —
  this function never imports it).
- **Technical Notes**: Nothing in this file's existing `notifyOrderStatusChange`/`notifyLowStock`
  coverage needs to change (see Test Churn Summary) — this task is purely additive.
- **Definition of Done**:
  - EMAIL-preferred with email+magicLink calls `sendAccountCreatedEmail` once, never `sendSms`.
  - PHONE-preferred with phone calls `sendSms` once, never any email function.
  - Name-only input resolves to `{}` with neither mock called.
  - A `smsEnabled: false`-style no-op result from the mocked `sendSms` (PHONE-preferred path) still
    resolves cleanly, matching this function's fire-and-forget, never-throw contract.
  - No test in this new `describe` block imports or asserts against `./whatsapp` in any way.
- **Estimated Complexity**: Low.

### TEST-010 · `tests/integration/phone-login.integration.test.ts` (new)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: INFRA-003, BE-013
- **Description**: Integration coverage for the `OtpCode` lifecycle against the real isolated DB
  (create → rate-limit rejection → attempt-cap rejection → expiry) and
  `resolveCustomerForPhoneLogin`'s create/backfill behavior against real `User` rows, per the TDD's
  Testing Strategy.
- **Technical Notes**: `mintSessionForAuthEmail`/the Supabase Admin client boundary is **mocked**
  here, not exercised live — hitting a real Supabase Auth Admin API isn't something today's
  integration harness depends on for any existing test (it only guards `DATABASE_URL`), and this is
  explicitly not the layer BE-010's route (unit-tested in TEST-014) or VERIFY-002's manual QA are
  meant to duplicate.
  **This is the specific integration test that must cover a phone-only customer's very FIRST login
  (the create path, not just the backfill/already-synced path)** — the PRD's dispatch brief called
  this out by name as the case that must not be silently skipped in favor of only testing the
  simpler "returning customer" path.
- **Definition of Done**:
  - A fresh phone number's first `resolveCustomerForPhoneLogin` call creates a new `User` row with
    a synthetic `authEmail` and `preferredLoginMethod: 'PHONE'` — asserted against the real DB, not
    a mock.
  - A second call for the same phone returns the same row (no duplicate created) — this is the
    direct integration-level proof of the PRD's "zero duplicate `User` rows" success metric.
  - `OtpCode` rows created via direct Prisma writes correctly expire, hit the attempt cap, and
    reject a cooldown-violating second request, all against the real isolated DB.
  - This file's fixtures are registered in a `TestRegistry` and cleaned up in `afterEach`, matching
    every other integration file's convention (`tests/integration/helpers.ts`).
- **Estimated Complexity**: High — the highest-value integration test in this expansion, and the
  one place the "no duplicate accounts" success metric gets a real, DB-backed proof rather than a
  mocked one.

### TEST-011 · `tests/integration/customers-actions.integration.test.ts` (extend)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: INFRA-003, BE-017
- **Description**: Add the module-level `vi.mock('@/lib/notifications', ...)` this file currently
  lacks (see Test Churn Summary — required, not optional, to prevent every existing test's
  `createCustomer` call from hitting the real notification module against the real test DB), and
  add new tests asserting `createCustomer` fires `notifyAccountCreated` with the correct data
  shape.
- **Technical Notes**: Same split this project already uses for order-status notifications: fan-out
  logic is a unit-test concern (TEST-009), call-site wiring is an integration-test concern (this
  task). Assert the *contract* — that `notifyAccountCreated` was called with the right
  `preferredLoginMethod`/`customerEmail`/`customerPhone`/`magicLink` shape for a given `createCustomer`
  input — not its internal fan-out behavior, which is already covered elsewhere.
- **Definition of Done**:
  - `vi.mock('@/lib/notifications', () => ({ notifyAccountCreated: vi.fn().mockResolvedValue({}),
    ...(existing exports this file's other tests might indirectly need) }))` is added at the top of
    the file.
  - A new test confirms `createCustomer({ name, email })` calls `notifyAccountCreated` with
    `preferredLoginMethod: 'EMAIL'` and a non-null `magicLink`.
  - A new test confirms `createCustomer({ name, phone })` calls it with `preferredLoginMethod:
    'PHONE'` and `magicLink: null`.
  - Every pre-existing test in this file (the full auth matrix, `:49-131`) still passes unmodified
    in its assertions.
- **Estimated Complexity**: Medium — the missing-mock fix is small but load-bearing; skipping it
  would let this file start writing real `NotificationSettings`/`LoginSettings` rows into the
  shared integration DB on every run.

### TEST-012 · `tests/integration/settings-actions.integration.test.ts` (new)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: INFRA-003, BE-016
- **Description**: Integration coverage for `requireAdmin()` gating on both Settings actions, the
  blank-secret-field-does-not-clobber-stored-value behavior, and singleton get-or-create behavior
  against the real isolated DB.
- **Technical Notes**: Follows the same `vi.mock('@/utils/supabase/server', ...)` +
  `mockAuthSession`/`mockNoSession` + `TestRegistry` pattern every other file in
  `tests/integration/` already uses (`customers-actions.integration.test.ts` as the closest
  reference for an auth-matrix-plus-CRUD shape).
- **Definition of Done**:
  - `updateNotificationSettings`/`updateLoginSettings` both reject for an unauthenticated or
    `CUSTOMER`-role session, and succeed for an `ADMIN` session — the standard three-case matrix.
  - Saving with a real secret, then saving again with that field left blank, leaves the
    previously-stored value intact when re-read from the real DB.
  - Calling `getNotificationSettings()`/`getLoginSettings()` twice in the same test does not create
    two rows.
  - New rows created by this test file are cleaned up in `afterEach` (a `NotificationSettings`/
    `LoginSettings` row has no natural per-test FK to a `TestRegistry` user, so this file needs its
    own direct `deleteMany` cleanup rather than reusing `cleanupRegistry` verbatim).
- **Estimated Complexity**: Medium.

### TEST-013 · `src/app/admin/settings/SettingsClient.test.tsx` (new, optional)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: FE-006
- **Description**: A jsdom/React Testing Library smoke test for the Settings page's client
  component — not every `*Client.tsx` in this codebase has a component test today (notably
  `CustomerClient.tsx` has none), so this is recommended given FE-006's above-average complexity
  (masked secrets, two tabs, a conditionally-disabled toggle) rather than strictly required by
  established convention.
- **Technical Notes**: Focus on the two properties that are easy to silently break and hard to
  catch any other way: a masked-secret placeholder never contains a real value in the rendered DOM,
  and the Phone login toggle is actually `disabled` (not just visually dimmed) when
  `smsEnabled`/`arkeselApiKeySet` aren't both true.
- **Definition of Done**:
  - Rendering `SettingsClient` with a mock `arkeselApiKeySet: true` shows a masked placeholder, and
    `screen.queryByDisplayValue(<any real secret string>)` finds nothing.
  - Rendering with `smsEnabled: false` renders the Phone login `Switch` with `disabled` present in
    the DOM.
- **Estimated Complexity**: Low — genuinely optional; do not let this block the phase if time is
  short, per this codebase's own precedent of not testing every Client component.

### TEST-014 · `src/app/auth/confirm/route.test.ts` (new)
- **Category**: Testing
- **Phase**: 5
- **Dependencies**: BE-010
- **Description**: Added post-plan once BE-010 was rewritten from a spike into a real route (see
  this document's Revision note). Route-handler unit tests for `/auth/confirm`, following the
  pattern `src/app/api/webhooks/whatsapp/route.test.ts` already established as this repo's first
  route-handler test file — construct a real `Request`, call the exported `GET` directly, no
  server/supertest/network.
- **Technical Notes**: Mock `src/utils/supabase/server.ts`'s `createClient` (same
  `vi.mock('@/utils/supabase/server', ...)` pattern every action-level unit/integration test in
  this repo already uses) and assert the `verifyOtp` mock is called with `type` equal to whatever
  the test request's own `type` query param was — never a literal — mirroring exactly how BE-005's
  `mintSessionForAuthEmail` binding directive is tested in `auth.test.ts` (TEST-002). Cover both a
  `type=signup` request (the first-login case the peer session's live probe actually observed) and
  a `type=magiclink` request (a repeat-login case), asserting each passes its own value through
  unchanged.
- **Definition of Done**:
  - A request with `token_hash`/`type` query params that resolves successfully (mocked `verifyOtp`
    resolving with no error) redirects away from `/auth/confirm` (to `/` or a `next` param).
  - A request where the mocked `verifyOtp` call resolves with an `error` redirects to
    `/login?message=...` rather than throwing.
  - A request missing `token_hash` or `type` entirely redirects to `/login?message=...` without
    ever calling `verifyOtp`.
  - `verifyOtp` is asserted to have been called with `type` equal to the request's own query-string
    value for both a `signup`-type and a `magiclink`-type request — grep/assertion-verifiable that
    no hard-coded literal is used.
  - No test in this file makes a real Supabase network call.
- **Estimated Complexity**: Low — small, well-bounded route mirroring an established local test
  pattern.

---

## Phase 6: Verification & Rollout

### VERIFY-001 · Re-measure the full test/lint/build gate against the new baseline
- **Category**: Testing
- **Phase**: 6
- **Dependencies**: Every task above
- **Description**: Run `npm test`, `npm run test:integration`, `npm run lint`, and `npm run build`,
  and compare against the pre-expansion baseline (252 unit / 16 files, 90 integration / 14 files, 0
  lint errors, build succeeds).
- **Technical Notes**: Use `set -o pipefail` (or check `${PIPESTATUS[0]}`) when piping build output
  through `tail`/`grep` — this exact gotcha bit an earlier phase of this same project (recorded in
  `docs/.pipeline-state.md`): `npm run build 2>&1 | tail` reports `tail`'s exit code, not the
  build's, and a broken build can look green under that pattern.
- **Definition of Done**:
  - `npm test` passes with a strictly higher count than 252 (this expansion is net-additive to
    unit tests) and exactly 0 failures.
  - `npm run test:integration` passes with a strictly higher count than 90 and exactly 0 failures.
  - `npm run lint` reports 0 errors (warnings may persist at or near the existing baseline of 10;
    investigate any *new* warning category rather than assuming it's pre-existing).
  - `npm run build` succeeds, with the true exit code verified (not `tail`'s).
  - Any test failure is triaged against the Test Churn Summary above: an *expected* failure gets
    fixed per that section's guidance; anything not listed there is treated as a real regression.
- **Estimated Complexity**: Low effort, high importance — this is the single gate that confirms
  nothing above was silently left broken.

### VERIFY-002 · Manual QA — real phone-OTP login and account-creation notifications
- **Category**: Testing
- **Phase**: 6
- **Dependencies**: VERIFY-001
- **Description**: Mirrors how the existing WhatsApp/Arkesel work was verified before merge: one
  real end-to-end phone-OTP login against local Supabase (confirming the `generateLink`/`verifyOtp`
  handshake works exactly as BE-005/BE-010 implemented it), and one real account-creation SMS.
- **Technical Notes**: Explicit user authorization is required before sending a real SMS or
  consuming real Arkesel credit, matching this project's existing convention for live sends. No
  WhatsApp QA step is needed for account creation — that channel isn't part of this notification.
  The two pre-existing WhatsApp templates' own QA (order-status, low-stock) is unaffected and
  unchanged by this expansion — do not re-run it here.
- **Definition of Done**:
  - A real phone number completes phone-OTP login end-to-end (request code → receive real SMS →
    enter code → land on `/dashboard` or `/admin`), for a number that has **never** logged in
    before (the first-login/`"signup"`-type path, not a repeat login) — this is the specific,
    highest-value scenario BE-005's `mintSessionForAuthEmail` fix targets.
  - A real account-creation SMS was sent for a phone-preferred test customer and its content was
    visually confirmed (no site URL, phone number, or copy typos).
  - Results (including any failure) are written into `docs/notifications-manual-qa.md` or an
    equivalent record, matching this project's existing documentation habit for live sends.
- **Estimated Complexity**: Medium — requires coordinated access to a real phone and explicit
  authorization to spend real SMS credit.

### VERIFY-003 · Confirm the rollout runbook and its operational risk are understood before merge
- **Category**: Infrastructure & Config
- **Phase**: 6
- **Dependencies**: VERIFY-001
- **Description**: Walk through the TDD's Rollout Plan sequence explicitly with whoever will
  deploy this: schema push to dev, manual schema push to the isolated test DB (INFRA-003, already
  done earlier but reconfirmed here as part of the deploy runbook), deploy the code, **immediately**
  have the admin re-enter every provider credential at `/admin/settings`, and only then enable
  `phoneLoginEnabled` after confirming a real test SMS arrives.
- **Technical Notes**: **This is not a routine deploy.** The moment this code ships,
  `NotificationSettings` starts empty (locked "no auto-migration" decision), which means every
  customer notification — not just this expansion's new ones, but the already-shipped
  order-status/low-stock email/SMS/WhatsApp sends too — goes silent until the admin completes step
  4 of the Rollout Plan. `phoneLoginEnabled` defaults to `false` specifically so email-only login
  remains the default, unaffected behavior until SMS delivery is verified post-deploy — do not flip
  it on as part of the deploy itself. **Added post-plan (see Revision note):** confirm the
  production Supabase project's Auth redirect allow-list includes
  `${NEXT_PUBLIC_SITE_URL}/auth/confirm` (BE-010's new route) before deploy — local dev is already
  covered by `supabase/config.toml`'s `additional_redirect_urls` wildcard, but the hosted project's
  own allow-list is configured separately and won't inherit that local setting.
- **Definition of Done**:
  - The business owner's availability at/immediately after deploy is confirmed ahead of time, not
    assumed.
  - A written runbook (or this task's own completion notes) states the exact sequence and the
    notification-silence risk in plain language, for whoever executes the deploy.
  - `phoneLoginEnabled` is explicitly confirmed to remain `false` in the deployed
    `LoginSettings` row immediately after deploy, before any admin action.
  - `${NEXT_PUBLIC_SITE_URL}/auth/confirm` is confirmed present in the production Supabase
    project's Auth redirect allow-list before the first real account-creation email is sent.
- **Estimated Complexity**: Low effort, high operational stakes — this is a coordination task, not
  a code task.

---

## Proactively Suggested Tasks

These are not explicitly named in the PRD/TDD but follow directly from reading the actual
implementation this expansion builds on. Each is justified below against the specific code/TDD
passage that motivates it — none of these silently deviate from the TDD's locked decisions; they
are additive hardening within the TDD's existing architecture.

### PROACTIVE-001 · Stop `sendSms`'s "would have sent" no-op log from echoing a plaintext OTP code
- **Category**: Backend / Security
- **Phase**: Cross-cutting (implement alongside BE-006, test alongside TEST-005)
- **Why this is suggested**: The PRD's own stated success metric is "OTP codes are never
  recoverable in plaintext from the database... verified by hash comparison in tests, not literal
  equality" — but `sms.ts`'s existing unconfigured-no-op branch,
  `console.log('[SMS] Would have sent:', data)` (`sms.ts:38`), logs the **entire** `data` object,
  including `data.message` — which, for an OTP send, is the literal, plaintext 6-digit code. This
  branch fires in a real, expected deployed state: immediately after this expansion ships and
  before the admin re-enters Arkesel credentials at `/admin/settings` (see VERIFY-003's
  notification-silence window), every `requestPhoneOtp` call during that window would print a
  usable, unexpired login code straight to server logs. This does not violate the PRD's literal
  metric (the *database* never stores plaintext), but it defeats the metric's evident intent, and
  it is exactly the kind of gap that only surfaces by reading the actual no-op branch, not the
  TDD's Security Considerations section (which discusses API-key/access-token log hygiene but never
  mentions the outbound message body).
- **Description**: When `sendSms`'s config-check no-ops (either the new `sms_disabled` or the
  existing `sms_not_configured` reason), log `{ to: data.to }` only — never `data.message` — or
  redact/omit the message specifically when it looks like it might contain a code (simplest and
  most robust: just never log the full message body in this branch, regardless of content, since
  order-status/low-stock text isn't sensitive enough to be worth the risk of a future sensitive
  message type being added and forgotten about here).
- **Definition of Done**:
  - `sendSms`'s no-op log lines no longer include `data.message`'s literal content.
  - A regression test (extending TEST-005) seeds an OTP-shaped message and asserts it never appears
    in any `console.log`/`console.error` call during a no-op path, mirroring this file's existing
    "no secrets in logs" test style (`sms.test.ts:254-286`) but for the message body, not the API
    key.
- **Estimated Complexity**: Low.

### PROACTIVE-002 · Harden `resolveCustomerForPhoneLogin`'s create path against a first-login double-submit race
- **Category**: Backend / Robustness
- **Phase**: Cross-cutting (implement alongside BE-013, test alongside TEST-004/TEST-010)
- **Why this is suggested**: The TDD's own Edge Cases section analyzes concurrent `verifyPhoneOtp`
  calls with the correct code and concludes the outcome is harmless ("two valid sessions... is
  harmless"). That analysis is accurate for a **returning** customer (the backfill path, updating an
  existing row), but not for a customer's **very first** login: two concurrent requests racing
  through `resolveCustomerForPhoneLogin`'s `if (!user) { ... prisma.user.create(...) }` branch for
  the *same* `phone` value will not both succeed — `User.phone` is `@unique`, so the second `create`
  throws a Prisma `P2002`. `verifyPhoneOtp`'s surrounding `try/catch` (per BE-013) converts that,
  via this codebase's existing `toErrorResult` (`errors.ts:40-52`), into `{ ok: false, error: 'A
  customer with that email or phone number already exists.', code: 'VALIDATION' }` — a confusing
  message for a customer who just entered a correct code and has no "existing account" context to
  make sense of it, shown on exactly the highest-value path this whole feature is built around (a
  double-tap on a slow mobile connection is a realistic trigger, not a contrived one).
- **Description**: Catch a `P2002` on the unique-`phone` constraint specifically inside
  `resolveCustomerForPhoneLogin`'s create branch, and on that specific collision, re-fetch the
  now-existing row by `phone` and proceed with the normal already-exists/backfill path instead of
  letting the error propagate — turning the race into the same harmless "two valid sessions" outcome
  the TDD already accepts for the returning-customer case, rather than a user-facing error.
- **Technical Notes**: This does not change the TDD's accepted, harmless double-session race — it
  only closes the *different*, error-surfacing race the TDD's analysis didn't cover for the
  create-not-backfill case. Scope this narrowly to the `phone`-unique-constraint P2002, not a
  blanket catch-all.
- **Definition of Done**:
  - A test simulating two concurrent `resolveCustomerForPhoneLogin(phone)` calls for a phone with
    no existing row results in both resolving to the **same** `User` row, neither surfacing a
    `P2002`-derived error.
  - The existing "customer already exists" `toErrorResult` message remains reachable and correct
    for its real, intended case (an admin trying to create a duplicate customer via
    `createCustomer`) — this fix is scoped to `resolveCustomerForPhoneLogin` only.
- **Estimated Complexity**: Medium — narrow in scope, but concurrency bugs are inherently fiddly to
  test correctly.

### PROACTIVE-003 · Scope `authEmail` out of client-facing Prisma `User` queries
- **Category**: Backend / Security
- **Phase**: Cross-cutting (implement alongside BE-017, verify alongside VERIFY-001)
- **Why this is suggested**: The TDD's Security Considerations section states `authEmail` "must
  never be displayed, exported, or included in any notification... no code path in this design
  reads it outside `src/lib/auth.ts`/`src/utils/supabase/admin.ts` — keep it that way in review."
  That statement is true of application *logic*, but it does not account for how Next.js Server
  Components pass data to Client Components: `getCustomers()` (`customers/actions.ts:10-25`) does
  `prisma.user.findMany(...)` with no field-level `select`/`omit`, returning full `User` rows —
  including the new `authEmail` column — as `initialData` props into `CustomerClient.tsx`. Props
  passed from a Server Component to a Client Component are serialized into the page's RSC payload
  and are inspectable in the browser (page source / React DevTools) regardless of whether any table
  column actually renders `authEmail` — so, unmodified, this expansion **does** ship a synthetic
  internal identity string (or, for email-first customers, a duplicate of their real email) to
  every browser that loads `/admin/customers`, contradicting the TDD's own stated intent even
  though no application code path "reads" it in the sense the TDD means. The same pattern exists in
  `orders/actions.ts`'s `getOrders()`/`updateOrderStatus()`, both of which do `include: { customer:
  true }` (`orders/actions.ts:17`, `:181`) with no scoping, flowing into `OrderClient.tsx`/
  `OrderDetailsClient.tsx`.
- **Description**: Add an explicit `omit: { authEmail: true }` (Prisma 6's per-query `omit` API,
  confirmed available at this project's pinned `prisma@^6.19.3`) to every `User`-returning Prisma
  call whose result reaches a Client Component: `getCustomers()`, `createCustomer()`'s and
  `updateCustomer()`'s returned rows, and the `customer: true` includes in `orders/actions.ts`.
- **Technical Notes**: **Do not** apply this as a single global `omit` on the shared
  `PrismaClient` instance in `src/lib/prisma.ts` — `src/lib/auth.ts`'s own internal logic
  (`syncPrismaUser`, `resolveCustomerForPhoneLogin`, `getCurrentDbUser`) reads `authEmail` directly
  and would silently break under a global omit unless every one of those internal calls then added
  an explicit `omit: { authEmail: false }` override, which is more invasive and easier to get wrong
  than scoping the omit at each client-facing call site individually. Per-query `omit` is the safer,
  more surgical fix given this codebase has no existing `select`/`omit` convention to build on.
- **Definition of Done**:
  - `getCustomers()`, `createCustomer()`, `updateCustomer()` (`customers/actions.ts`) all use
    `omit: { authEmail: true }`.
  - `getOrders()`/`updateOrderStatus()`'s `customer: true` includes in `orders/actions.ts` are
    updated to omit `authEmail` on the nested relation.
  - A test (component or integration) confirms `authEmail`'s value is absent from the serialized
    props/response these call sites produce.
  - `src/lib/auth.ts`'s own queries are **unaffected** — still return `authEmail` where needed —
    verified by `auth.test.ts` continuing to pass without modification for this specific concern.
- **Estimated Complexity**: Medium — mechanically simple per call site, but requires an accurate,
  complete inventory of every `User`-returning query that reaches a Client Component, and a mistake
  here (over-scoping the omit onto an internal `auth.ts` call) would reintroduce the exact lockout
  bug `getCurrentDbUser` already has a regression test for.

### PROACTIVE-004 · Consider (but do not build yet) a Settings-change audit trail
- **Category**: Infrastructure & Config / Future consideration
- **Phase**: Not scheduled — documented for awareness only
- **Why this is suggested**: This is the standard "who changed a credential and when" gap common to
  any admin-facing secret-rotation UI. It is explicitly **not** recommended as a task for this
  expansion: the PRD's Non-Goals already accept "no encryption-at-rest for provider secrets... an
  explicit, accepted trade-off for this app's single-admin scale, not an oversight," and this app
  has exactly one admin account by design (`ADMIN_EMAIL`/`ADMIN_PHONE`-gated). An audit trail
  answering "which of several admins changed this" has no meaning yet in a single-admin system —
  building it now would be speculative scope against the TDD's own stated scale assumptions.
- **Description**: If this app ever grows beyond a single admin account, revisit adding an
  `updatedBy`/change-log table for `NotificationSettings`/`LoginSettings` mutations. Not a task for
  this expansion.
- **Definition of Done**: N/A — intentionally not scheduled.
- **Estimated Complexity**: N/A.

---

## Environment Variables Required

| Variable | Description | Required | Example Value |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role Supabase key for `src/utils/supabase/admin.ts` (BE-002) — `generateLink` for phone-OTP session minting and account-creation magic links. Bypasses RLS entirely; server-only, never `NEXT_PUBLIC_`. Local dev already has the well-known local Supabase demo value in this worktree's `.env`; production needs a real value from the owner's Supabase project settings (business/external prerequisite, not code-blocking). | Yes (phone login and email-preferred account-creation links are entirely broken without it — fails gracefully as an `ActionResult` error, per `mintSessionForAuthEmail`'s catch, not a crash) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (local demo key) |
| `OTP_HASH_SECRET` | HMAC-SHA256 pepper `src/lib/otp.ts` (BE-001) uses to hash OTP codes before storage. Rotating it invalidates every outstanding unexpired code (accepted). | Yes (phone-OTP login is entirely broken without it — `hashOtpCode` throws) | `a-long-random-string-generated-once-per-environment` |
| `RESEND_API_KEY`, `FROM_EMAIL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_LOW_STOCK_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`, `ARKESEL_API_KEY`, `ARKESEL_SENDER_ID` | **No longer read by application code after BE-006/007/008/009** — the DB (`NotificationSettings`, via `/admin/settings`) is now the sole source of truth. Left in `.env.example` (INFRA-005) as reference values only, with updated comments. | No (deprecated — setting these locally has no effect once BE-006/007/008/009 ship) | (unchanged from existing `.env.example`) |
| `WHATSAPP_API_VERSION` | Graph API version segment — **not** moved to the DB (TDD, explicit exclusion). Unchanged from today. | No — defaults to `v24.0` in code | `v24.0` |
| `ADMIN_ALERT_EMAIL`, `ADMIN_ALERT_PHONE` | The admin's own contact info for low-stock alerts — **not** moved to the DB (these identify a person, not a provider credential). Unchanged from today. | No | (unchanged) |
| All other existing vars (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `ADMIN_EMAIL`, `NEXT_PUBLIC_SITE_URL`, etc.) | Unaffected by this expansion. | (unchanged) | (unchanged) |

---

## Open Questions

### Would genuinely block `feature-developer` if not resolved before implementation reaches that point
- **None.** Every ambiguity the PRD originally raised was decided by the orchestrator before this
  plan was written (site-URL SMS copy, static cooldown message, no auto-updating
  `preferredLoginMethod`, DB-as-sole-source-of-truth with no env fallback — all baked into the tasks
  above as settled). The one item the TDD itself flagged as implementation-blocking — whether
  `generateLink`'s `action_link` round-trips through `/auth/callback` cleanly — is **no longer
  open**: a sibling `feature-developer` session ran that exact probe live against local Supabase and
  got a conclusive negative answer (see this document's Revision note and BE-010), which is now
  fully specified as a concrete implementation task rather than an unresolved spike.

### Worth confirming, but not blocking
- **BE-010's route must be added to the production Supabase project's redirect allow-list** (the
  local `supabase/config.toml` wildcard already covers it for dev) — flagged in BE-010's Technical
  Notes and folded into VERIFY-003's rollout runbook, but worth a final human check before deploy.
- **PROACTIVE-002** (the first-login double-submit P2002 race) is my own finding, not something
  either the PRD or TDD names — worth a deliberate yes/no from whoever reviews this plan rather than
  being silently folded into BE-013's scope, since it does add a small amount of new error-handling
  code beyond the TDD's literal pseudocode.
- **PROACTIVE-003** (`authEmail` client-payload exposure) is likewise my own finding. It's a real
  gap against the TDD's own stated intent ("never displayed, exported"), but it is not something
  the TDD's code samples show how to fix, and it touches two files (`customers/actions.ts`,
  `orders/actions.ts`) beyond this expansion's otherwise-tight scope — worth confirming the
  per-query `omit` approach (rather than, say, a `select`-based rewrite of these queries, which
  would be a larger diff) before implementation.
- **Business/external prerequisites** (not code-blocking, per the TDD's own Open Questions
  section): a real, production-grade `SUPABASE_SERVICE_ROLE_KEY` must come from the owner's
  Supabase project; the manual `rosty_integrity_test` schema push (INFRA-003) needs a human to run
  it, not a pipeline; and the rollout-day credential re-entry (VERIFY-003) needs the business
  owner's actual availability at deploy time, given the notification-silence window this ships
  with.

---

**Next step**: hand this file to `feature-developer` as its technical plan input, phase-by-phase in
the order above (Phase 1 → 6). BE-010 is now a fully-specified implementation task (not a spike) —
build it directly, no separate research step needed. `feature-developer` should not skip INFRA-003
before attempting TEST-010/011/012, and should build BE-010 before BE-017 (which links to it).
