# Engineering Task List: Real Customer Notifications (WhatsApp Business Cloud API + Arkesel SMS)
**Generated**: 2026-08-18
**Source PRD**: `docs/prd-notifications.md`
**Source TDD**: `docs/tdd-notifications.md`
**Pipeline state**: `docs/.pipeline-state.md`
**Total Tasks**: 17 across 4 phases (INFRA 1, BE 6, TEST 7, PROACTIVE 2, VERIFY 1)

All file paths below are relative to the worktree root:
`/home/ishola/jar/compENG/sem-8/swe-project-notifications`

---

## Summary

This phase turns two no-op notification channels into real ones (SMS via Arkesel, WhatsApp via
Meta's Cloud API, both new) and adds the one Route Handler Meta requires to operate the Cloud API
at all (`/api/webhooks/whatsapp`), without touching the transactional core (`createOrder`,
`updateOrderStatus`, stock deduction/restoration) at all. The TDD is fully prescriptive — exact
function signatures, exact request/response shapes, an exact webhook algorithm ordering, and a
resolved env var table — so this plan is pure decomposition and sequencing, not redesign. Three
genuinely new architectural pieces carry the weight: `src/lib/phone.ts` (a Ghana→E.164 normalizer
both providers need), a required new `orderShortId: number` field on `notifyOrderStatusChange`
(closing a real gap — the existing data shape only carried the internal UUID, and `AGENTS.md`
bans UUIDs in customer-facing strings), and the webhook route itself, which is unauthenticated by
design and fails closed on any missing secret.

**Expected test churn is zero — this is unusual and worth stating plainly.** All six integration
test files that exercise `createOrder`/`updateOrderStatus` (`orders-actions`, `order-lifecycle`,
`menu-order-actions`, `concurrency`, `validation-errors`, `insufficient-stock`) mock the entire
`@/lib/notifications` module with `vi.fn().mockResolvedValue({})` and — verified directly against
every one of those files — **none of them asserts on the mock's call arguments today**. Adding a
required `orderShortId` field therefore breaks nothing that currently exists; it only becomes
observable once TEST-006/TEST-007 below *add* the first such assertions. **All 111 existing unit
tests and all 88 existing integration tests must still pass, completely unchanged, after every
task in this plan.** This feature only adds tests — TEST-006 and TEST-007 are the only tasks that
touch a pre-existing test file, and both only *add* new assertions/`it()` blocks to files that
currently assert nothing about these call arguments. Any drop below 111/88 at VERIFY-001 is a real
regression in the new code, never a reason to revert, weaken, or delete a test.

**A finding from cross-referencing the current worktree state against the TDD, not called out in
either document: real WhatsApp credentials now live in this worktree's `.env`** (a genuine
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, and
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, confirmed by direct read), and `vitest.config.mts`'s `node`
project loads `.env` via `import 'dotenv/config'` at config-eval time, overriding only
`DATABASE_URL`/`DIRECT_URL` — **not** any `WHATSAPP_*`/`ARKESEL_*` variable. That means the
"unconfigured env → no-op" unit test branch for WhatsApp and the webhook's "unset secret → fail
closed" branches can no longer rely on ambient absence the way they could when the TDD was
written — the ambient values are no longer absent. `ARKESEL_API_KEY`/`ARKESEL_SENDER_ID` are still
genuinely empty, so SMS's unconfigured-branch test is unaffected. This is threaded through as an
explicit, load-bearing acceptance criterion in TEST-002 and TEST-004 (`vi.stubEnv`/explicit
deletion required, never rely on `.env`'s current state) rather than left as a silent trap for
whoever writes those tests first.

Also worth noting for whoever implements against this plan: the TDD's own code sample for
`src/app/admin/orders/actions.ts` shows a simplified, pre-hardening shape (no `requireAdmin()`, no
zod validation, no `ActionResult` wrapping). The real current file — read in full while producing
this plan — already has all of that from the merged Integrity Hardening phase. This is a
documentation-staleness gap, not a design conflict: the three call-site edits this phase needs
(`orderShortId` at two `notifyOrderStatusChange` calls, `adminPhone` at one `notifyLowStock` call)
land at the exact same points in the real, more-evolved function bodies — see BE-006's Technical
Notes for the verified real line numbers.

Phasing: **Phase 1** builds the one dependency-free shared primitive (`phone.ts`) and the
`.env.example` reference update. **Phase 2** builds the three independent, TDD-fully-specified
pieces that only depend on Phase 1 or nothing at all — `whatsapp.ts`, the rewritten `sms.ts`, and
the webhook route — each with its own unit/route test. **Phase 3** is the wiring phase: fan
WhatsApp into `index.ts`'s two entry points, then thread the two new fields into their one caller,
`actions.ts`, with call-site-contract-only integration test additions. **Phase 4** is proactive
hardening (a no-secrets-in-logs test sweep, a manual-QA runbook) plus the final green-suite gate.

## Dependency Graph

```
Phase 1: Foundation
  INFRA-001 (.env.example)                          [no deps]
  BE-001 (src/lib/phone.ts)                          [no deps]
    └─> TEST-001 (phone.test.ts)

Phase 2: Core Logic (channel senders + webhook — mutually independent)
  BE-001 ──> BE-002 (whatsapp.ts) ──> TEST-002 (whatsapp.test.ts)
  BE-001 ──> BE-003 (sms.ts, modify) ──> TEST-003 (sms.test.ts)
             BE-004 (webhook route.ts) ──> TEST-004 (route.test.ts)   [no deps — independent track]

Phase 3: Fan-Out Wiring & Call Sites
  BE-002, BE-003 ──> BE-005 (index.ts, modify — add orderShortId + WhatsApp fan-out)
                        └─> TEST-005 (index.test.ts, NEW)
  BE-005 ──> BE-006 (actions.ts, modify — orderShortId + adminPhone at 3 call points)
                ├─> TEST-006 (extend menu-order-actions.integration.test.ts)
                └─> TEST-007 (extend order-lifecycle.integration.test.ts)

Phase 4: Testing & Polish
  TEST-002, TEST-003, TEST-004 ──> PROACTIVE-001 (no-secrets-in-logs assertions)
  [no deps]                    ──> PROACTIVE-002 (manual QA runbook doc)
  BE-001..006, TEST-001..007, PROACTIVE-001 ──> VERIFY-001 (final gate)
```

No circular dependencies. BE-004 (webhook route) is the one genuinely independent track — it
shares no code with `phone.ts`/`whatsapp.ts`/`sms.ts`/`index.ts` and could be built in any order
relative to them; it is placed in Phase 2 for narrative grouping ("the three new/modified sender
surfaces"), not because anything forces it there.

**No frontend tasks exist in this plan.** The TDD is explicit ("Frontend Changes: None") and this
was verified directly: no page, component, or client-side data-fetching hook changes — the admin's
existing order-status `<select>` and order-creation form already call the two Server Actions this
phase modifies internally, and neither call site's own signature changes.

---

## Phase 1: Foundation

### INFRA-001 · Update `.env.example` — WhatsApp block, `ARKESEL_*` replacing `TWILIO_*`, `ADMIN_ALERT_PHONE`
**Category**: Infrastructure & Config · **Phase**: 1 · **Dependencies**: None

**Description**: `.env.example` is the app's only complete reference of every env var it reads.
Today it documents the dead `TWILIO_*` placeholders (never read by any code — `sms.ts` is a
stub) and has no `WHATSAPP_*`/`ARKESEL_*`/`ADMIN_ALERT_PHONE` entries at all. This task brings it
in line with what the finished feature actually reads, so a fresh clone has a genuinely complete
template rather than a misleading partial one — matching this file's own stated design intent
(see its header comment).

**Technical Notes**: TDD "Env Var Table" — reproduce every row (`WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`,
`WHATSAPP_LOW_STOCK_TEMPLATE_NAME`, `WHATSAPP_API_VERSION`, `ARKESEL_API_KEY`,
`ARKESEL_SENDER_ID`, `ADMIN_ALERT_PHONE`) with the same one-line "why/where read" comment style
already used for every other block in this file (see `ADMIN_ALERT_EMAIL`'s existing comment for
the pattern). `WHATSAPP_API_VERSION`'s example value must be `"v24.0"` — **not** the TDD's
originally-considered `v22.0** (superseded within the same TDD; the TDD's own default is already
`v24.0`, see its "Graph API version" section). Remove the `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/
`TWILIO_PHONE_NUMBER` block entirely — it documents a provider this codebase never integrated.

**Definition of Done**:
- `TWILIO_*` block removed from `.env.example`.
- New `# ── WhatsApp (Meta Cloud API) ──` and `# ── SMS (Arkesel) ──` sections added, each var
  commented with which file reads it and its behavior when unset (no-op / fail-closed, per the
  TDD's Env Var Table column).
- `ADMIN_ALERT_PHONE` documented alongside the existing `ADMIN_ALERT_EMAIL` entry, noting it falls
  back silently exactly like `ADMIN_ALERT_EMAIL` does today.
- `WHATSAPP_API_VERSION`'s example value is `"v24.0"`.
- No other existing section of the file is reordered or reworded.

**Estimated Complexity**: Low — pure documentation, no code path depends on this file's contents.

---

### BE-001 · Create `src/lib/phone.ts` — Ghana → E.164 phone normalizer
**Category**: Backend · **Phase**: 1 · **Dependencies**: None

**Description**: Both new providers need a clean `233XXXXXXXXX`-shaped destination (no leading
`+`) — WhatsApp Cloud API's `to` field and Arkesel's v1 `to` query parameter both expect this exact
shape (see BE-003 for why Arkesel's real API is v1, a single `to` value, not a `recipients` array
as originally assumed). `User.phone` is an unconstrained nullable string today with no format
guarantee, so this is
a pure, standalone normalization function with no Prisma/`next/*` dependency, following the same
"deliberately pure" convention already established by `src/lib/recipe.ts`.

**Technical Notes**: TDD "`src/lib/phone.ts` (new)" — implement `toGhanaE164` exactly as
specified: strip to digits+`+`, accept `+233`/bare `233`/local `0`-prefixed forms, reject anything
else (including other countries' prefixes) rather than guessing, then validate the final shape is
exactly `233` + 9 digits. This is outbound-formatting only — never mutates `User.phone` as stored.

**Definition of Done**:
- `src/lib/phone.ts` exports `toGhanaE164(raw: string | null | undefined): string | null` matching
  the TDD's implementation exactly (including its doc comment).
- `null`/`undefined`/`''` input returns `null` without throwing.
- A non-Ghana-prefixed number (e.g. `+234...`) returns `null`, not a mis-normalized Ghana number.
- File has zero imports from `@prisma/client`, `next/*`, or any `src/app/**` path.
- Compiles with `tsc --noEmit`.

**Estimated Complexity**: Low — fully specified pure function, no external dependency.

---

### TEST-001 · Unit tests for `src/lib/phone.ts`
**Category**: Testing · **Phase**: 1 · **Dependencies**: BE-001

**Description**: Establishes correctness for the one function every SMS/WhatsApp send depends on
to avoid sending to a malformed destination. Covers every case the TDD's Testing Strategy names
explicitly, including the case that matters most against this repo's own seed data.

**Technical Notes**: TDD "Testing Strategy" → `src/lib/phone.test.ts` bullet — reproduce every
named case, including the explicit callout that seeded/fixture customers use Nigerian (`+234`)
numbers (TDD "Edge Cases & Failure Modes"), so a non-`233`/`0`-prefixed input must return `null`,
never a guessed Ghana number.

**Definition of Done**:
- `src/lib/phone.test.ts` created, auto-discovered by `vitest.config.mts`'s `node` project glob
  (`src/**/*.test.ts`) with zero config changes.
- Covers: local `0XXXXXXXXX` → `233XXXXXXXXX`; `+233XXXXXXXXX` → `233XXXXXXXXX` (leading `+`
  stripped); bare `233XXXXXXXXX` → unchanged; numbers with spaces/dashes (`024 123 4567`,
  `024-123-4567`) → correctly normalized; too-short/garbage input → `null`; a non-Ghana country
  code (e.g. `+234...`) → `null`; `null`/`undefined`/`''` → `null`.
- `npm test` passes with these cases included; no case is skipped or marked `.todo`.

**Estimated Complexity**: Low — straightforward table-driven unit tests against a pure function.

---

## Phase 2: Core Logic

### BE-002 · Create `src/lib/notifications/whatsapp.ts` — Cloud API template-message sender
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001

**Description**: The new WhatsApp channel. Exports `sendOrderStatusWhatsApp` and
`sendLowStockWhatsApp`, mirroring `email.ts`'s established shape exactly: lazy env read (no SDK,
just `fetch`), env-gated no-op when unconfigured, try/catch around the network call that never
throws. Uses two **separate** Meta-approved templates (`order_status_update`, `low_stock_alert`)
since a WhatsApp template's approved body text cannot be swapped per-call — only its four
parameter values can.

**Technical Notes**: TDD "`src/lib/notifications/whatsapp.ts` (new)" — implement both exported
functions exactly as specified, including: `GRAPH_API_VERSION` defaults to `'v24.0'` (not the
TDD's originally-considered `v22.0` — confirmed already corrected in the TDD body and in `.env`'s
`WHATSAPP_API_VERSION="v24.0"`), the short-label `statusLabels` map (distinct from `email.ts`'s
full-sentence copy), and the `{{4}}` due-date placeholder using a single space `' '` — not an
empty string — when `dueDate` is absent (TDD "Template parameter empty-string risk": some Cloud
API template implementations reject an empty-string parameter outright; this is a defensive,
unverified-but-safe hedge). `sendLowStockWhatsApp` must read `WHATSAPP_LOW_STOCK_TEMPLATE_NAME`
(default `'low_stock_alert'`), **not** `WHATSAPP_TEMPLATE_NAME` — these are two independently
configured templates by design (TDD "The low-stock template gap").

**Definition of Done**:
- `src/lib/notifications/whatsapp.ts` exports `sendOrderStatusWhatsApp(phone, customerName,
  orderShortId, newStatus, dueDate?)` and `sendLowStockWhatsApp(phone, itemName, currentStock,
  unit)`, both `async`, both returning `{success: boolean, ...}` and never throwing.
- Both functions no-op with `{success: false, reason: 'whatsapp_not_configured'}` when
  `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` is unset — checked before any `fetch` call.
- Both functions no-op with `{success: false, reason: 'invalid_phone'}` when `toGhanaE164` returns
  `null` for the input phone — checked before any `fetch` call.
- The POST body sent to `graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
  matches the TDD's exact shape: `messaging_product: 'whatsapp'`, `type: 'template'`, the correct
  `template.name`/`template.language.code`, and all 4 body `parameters` in `{{1}}`–`{{4}}` order.
- Non-2xx response → `{success: false, reason: 'api_error', status, data}`; thrown `fetch` error →
  caught, `{success: false, error}`, no exception escapes the function.
- `sendOrderStatusWhatsApp` reads `WHATSAPP_TEMPLATE_NAME`/`WHATSAPP_TEMPLATE_LANGUAGE`;
  `sendLowStockWhatsApp` reads `WHATSAPP_LOW_STOCK_TEMPLATE_NAME`/`WHATSAPP_TEMPLATE_LANGUAGE` —
  confirmed as two distinct template-name env vars, not one shared between both functions.
- Compiles with `tsc --noEmit`.

**Estimated Complexity**: Medium — fully specified by the TDD, but two near-identical functions
with several conditional no-op branches each need care to keep symmetric and correct.

---

### TEST-002 · Unit tests for `src/lib/notifications/whatsapp.ts`
**Category**: Testing · **Phase**: 2 · **Dependencies**: BE-002

**Description**: Full failure-mode matrix for both exported functions, mocking `global.fetch` —
no real network call is ever made. This is the test suite proving the PRD's "zero unhandled
exceptions, zero blocked order-status changes" success metric for the WhatsApp channel
specifically.

**Technical Notes**: TDD "Testing Strategy" → `src/lib/notifications/whatsapp.test.ts` bullet —
reproduce the full matrix for `sendOrderStatusWhatsApp`: unconfigured env → no-op, `fetch` never
called; configured + invalid phone → no-op, `fetch` never called; configured + valid phone +
mocked 200 → `{success: true, data}` **and** assert the exact request body shape (recipient `to`,
template `name`/`language`, all 4 parameters in order); mocked non-2xx → `{success: false, reason:
'api_error', status, data}`; `fetch` throwing → caught, no exception escapes. Repeat the same
matrix for `sendLowStockWhatsApp`, additionally asserting it targets
`WHATSAPP_LOW_STOCK_TEMPLATE_NAME`, distinct from `sendOrderStatusWhatsApp`'s template.

**⚠ Load-bearing, not in the TDD**: this worktree's `.env` now has real, non-empty
`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` values, and `vitest.config.mts`'s `node`
project loads `.env` via `dotenv/config` without overriding either var. **Do not rely on ambient
env absence for the "unconfigured" test cases** — they would silently pass for the wrong reason
(or worse, become flaky if `.env` is ever edited). Use `vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')` /
`vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')` (or delete via `vi.unstubAllEnvs()` in `afterEach` +
explicit stub per test) to force the unconfigured branch deterministically, and stub real-looking
values for the configured branches instead of depending on whatever `.env` currently contains.

**Definition of Done**:
- `src/lib/notifications/whatsapp.test.ts` created; `global.fetch` mocked via `vi.stubGlobal` or
  equivalent — no real network call occurs (verified by running with network disabled).
- Every unconfigured/invalid-phone/success/failure/throw case above is present for both exported
  functions.
- Every test that needs a specific configured/unconfigured state uses explicit `vi.stubEnv(...)` /
  `vi.unstubAllEnvs()` — no test's pass/fail depends on `.env`'s current contents.
- The success-case assertion checks the actual `fetch` call's second-argument `body` (parsed JSON)
  matches the exact shape specified in the TDD, not just that `fetch` was called.
- `npm test` passes with these included.

**Estimated Complexity**: Medium — the matrix is mechanical but wide (10+ cases across two
functions), and the env-stubbing requirement is easy to skip if not flagged explicitly.

---

### BE-003 · Modify `src/lib/notifications/sms.ts` — real Arkesel **v1** (query-string) call, `orderShortId` param
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001
**⚠ Deviates from the TDD — flagged, not silent.** The TDD designed `sendSms` against Arkesel's
**v2** REST API (`POST /api/v2/sms/send`, JSON body, `api-key` header) based on public-docs
research done with no live account to test against. This account's dashboard actually issues the
**legacy v1 query-string API** instead — confirmed two ways: (1) a sibling pipeline session ran a
live, read-only balance check against the real `ARKESEL_API_KEY` now in this worktree's `.env` and
got back `HTTP 200`, `{"balance":523,"user":"Faazele Ishola","country":"Ghana"}`, which is the v1
envelope shape, not v2's; (2) independently corroborated by this worktree's own `.env` comment
above `ARKESEL_API_KEY` (added the same day), which states the same finding before this task list
was corrected. Implement against v1 below, not the TDD's v2 code sample.

**Description**: Replaces `sendSms`'s hardcoded stub body with a real Arkesel v1 `GET` call
(`https://sms.arkesel.com/sms/api?action=send-sms&api_key=...&to=...&from=...&sms=...` — no
request body, `api_key`/`to`/`from`/`sms` are all URL query parameters). `sendOrderStatusSms`
gains a new required `orderShortId` parameter and its message templates are updated to lead with
`#{shortId}`, closing an existing `AGENTS.md` violation (SMS copy never mentioned the order's
human-facing ID) rather than leaving it inconsistent next to the now-correct WhatsApp copy.
`sendLowStockSms`'s shape is unchanged. The commented-out Twilio example is deleted as dead
documentation. `ARKESEL_SENDER_ID` needs no pre-approval on this account (sender IDs auto-register
on the fly, per the account owner) — no separate registration task is needed.

**Technical Notes**: Confirmed v1 shape (send): `GET
https://sms.arkesel.com/sms/api?action=send-sms&api_key=API_KEY&to=PhoneNumber&from=SenderID&sms=YourMessage`.
`api_key` is a **query parameter**, not an `api-key` header; there is **no JSON body**; `to` takes
a single phone number (from `toGhanaE164(data.to)`), not a `recipients` array like v2; the message
text goes in `sms` and **must be `encodeURIComponent`-escaped** before being placed in the query
string, since it can contain spaces, quotes, and `#`. **The success/failure mapping must stay
defensive because the v1 envelope shape genuinely varies by action** — the balance-check response
above has no `code` field at all, while the documented `send-sms` success shape is
`{"code":"ok","message":"Successfully Send","balance":<n>,"user":"..."}` with numeric-string
failure codes (e.g. `"102"` = Authentication Failed). Unlike the TDD's v2 design, **HTTP status
alone is not sufficient here** — a v1 query-string API can return `200` even for some logical
failures — so the mapping is: non-2xx status → failure; `200` **and** a body `code` field that is
present but not `"ok"` → failure; `200` and no recognizable `code` field at all (unparseable body,
or a differently-shaped success payload) → treat as success, never throw or crash on its absence.
Both existing callers' signatures stay intact except `sendOrderStatusSms(phone, orderShortId,
orderDescription, newStatus)` — `orderShortId` is the new **second** parameter, before
`orderDescription`. Message templates: `` `Your order #${orderShortId} ("${orderDescription}")
has been received.` `` (and the five sibling status messages, matching the TDD's copy exactly —
only the transport underneath changes, not the message text). Delete `sms.ts:23-30`'s commented
Twilio block. **No task anywhere in this plan sends a real SMS** — every `fetch` call in every
test is mocked; a live send costs real Arkesel credits and reaches a real phone, and needs
explicit user sign-off outside this build.

**Definition of Done**:
- `sendSms(data: SmsData)` no-ops with `{success: false, reason: 'sms_not_configured'}` when
  `ARKESEL_API_KEY`/`ARKESEL_SENDER_ID` is unset; no-ops with `{success: false, reason:
  'invalid_phone'}` when `toGhanaE164(data.to)` returns `null`; otherwise issues a `GET` to
  `https://sms.arkesel.com/sms/api` with `action=send-sms`, `api_key`, `to`, `from`
  (`ARKESEL_SENDER_ID`), and `sms` (the URL-encoded message) as query parameters — **not** a
  `POST`, **not** a JSON body, **not** an `api-key` header.
- Non-2xx response → `{success: false, reason: 'api_error', status, data}`.
- `200` response whose parsed body has a `code` field present and `!== 'ok'` → `{success: false,
  reason: 'api_error', status, data}`.
- `200` response with no `code` field at all (or an unparseable body) → `{success: true, data}` —
  absence of a recognizable success signal is not treated as failure, and never throws.
- Thrown `fetch` error → caught, `{success: false, error}` — never throws past this function.
- `sendOrderStatusSms`'s new signature is `(phone: string, orderShortId: number, orderDescription:
  string, newStatus: string)`, and every one of its 6 status-message templates includes
  `#${orderShortId}` leading the existing description text.
- `sendLowStockSms`'s exported signature and message format are byte-for-byte unchanged.
- The commented-out Twilio example block is removed.
- Compiles with `tsc --noEmit`.

**Estimated Complexity**: Medium-High — the transport itself (a `GET` with query params) is
simpler than a POST+JSON call, but the defensive success mapping now genuinely depends on
inspecting the body (not just the HTTP status, per the TDD's original v2-only assumption), and the
parameter-order change on `sendOrderStatusSms` still needs the same care as before (a wrong
parameter order silently produces a valid-looking but wrong string, not a compile error).

---

### TEST-003 · Unit tests for `src/lib/notifications/sms.ts`
**Category**: Testing · **Phase**: 2 · **Dependencies**: BE-003

**Description**: Full failure-mode matrix for `sendSms`, plus targeted assertions that the two
callers still produce the right message shape — most importantly, that `sendOrderStatusSms`'s
message actually includes the new `orderShortId`.

**Technical Notes**: Updated for BE-003's v1 correction (see that task's TDD-deviation note) —
reproduce the configured/unconfigured/invalid-phone/success/failure matrix for `sendSms` against
the **v1 query-string shape**, mocking `global.fetch`: unconfigured → no fetch call; invalid phone
→ no fetch call; configured + valid + `200` + body `{"code":"ok",...}` → `{success: true, data}`,
**and** assert the actual `fetch` call was a `GET` (or default method) to a URL containing
`action=send-sms`, `api_key=...`, `to=...`, `from=...`, and a **URL-encoded** `sms=...` — not a
`POST` with a JSON body; configured + valid + `200` + body `{"code":"102",...}` (a documented
Arkesel failure code) → `{success: false, reason: 'api_error', ...}`; configured + valid + `200`
+ a body with **no `code` field at all** (e.g. shaped like the balance-check response) →
`{success: true, data}` — this is the regression test for "don't require the field to exist,
don't crash on its absence"; non-2xx status → `{success: false, reason: 'api_error', ...}`;
`fetch` throwing → caught, no exception escapes. Also assert `sendOrderStatusSms`'s message body
includes `#${orderShortId}` for at least the `PENDING` case (ideally all 6, cheaply, in a table);
confirm `sendLowStockSms`'s behavior/shape is otherwise unchanged from before this phase.

**⚠ Env-stubbing note — now equally critical as TEST-002's, not lighter.** Unlike when the TDD was
written, `ARKESEL_API_KEY`/`ARKESEL_SENDER_ID` are **no longer empty** in this worktree's `.env` —
both are now real, live-confirmed-valid values (`ARKESEL_SENDER_ID="Rostty"`). `vitest.config.mts`'s
`node` project loads `.env` via `dotenv/config` without overriding either. **Do not rely on ambient
env absence for the "unconfigured" test case** — it would silently pass for the wrong reason. Use
`vi.stubEnv('ARKESEL_API_KEY', '')`/`vi.stubEnv('ARKESEL_SENDER_ID', '')` (and `vi.unstubAllEnvs()`
afterward) exactly as TEST-002 does for the WhatsApp vars, and stub explicit test values for the
configured branches rather than depending on `.env`'s real (now-live) values.

**Definition of Done**:
- `src/lib/notifications/sms.test.ts` created; `global.fetch` mocked, no real network call occurs
  (verified by running with network disabled) — **no task in this plan sends a real SMS**.
- Every unconfigured/invalid-phone/success(`code:"ok"`)/failure(non-`"ok"` code)/
  success-with-no-`code`-field/non-2xx/throw case is present for `sendSms`.
- At least one assertion confirms the request URL/params match the v1 shape (`action=send-sms`,
  `api_key`, `to`, `from`, URL-encoded `sms`) — not a JSON body or `api-key` header.
- At least one assertion confirms `sendOrderStatusSms(phone, 42, 'jollof', 'PENDING')`'s resulting
  message contains the literal substring `#42`.
- `sendLowStockSms`'s message format assertion is unchanged from what it would have been before
  this phase (no `orderShortId` leaks into it — it doesn't take one).
- All env-dependent cases use explicit `vi.stubEnv(...)`/`vi.unstubAllEnvs()` — none rely on
  `.env`'s current (now real) `ARKESEL_*` values.
- `npm test` passes with these included.

**Estimated Complexity**: Medium — wider matrix than the TDD's original v2 design called for (the
"200-but-no-code-field" case is new, and the query-string URL assertion replaces a JSON-body
assertion), plus the same env-stubbing and parameter-order care as before.

---

### BE-004 · Create `src/app/api/webhooks/whatsapp/route.ts` — verification handshake + signed event logging
**Category**: Backend · **Phase**: 2 · **Dependencies**: None

**Description**: The Meta-mandated webhook endpoint — the first file in a new `src/app/api/`
directory and the first use of Node's `crypto` module anywhere in this codebase. `GET` completes
Meta's one-time ownership-verification handshake; `POST` verifies each event's HMAC-SHA256
signature before logging it. **Unauthenticated by design** — Meta calls this endpoint, not a
logged-in admin — `requireAdmin()`/`getCurrentDbUser()` must not be added.

**Technical Notes**: TDD "`src/app/api/webhooks/whatsapp/route.ts` (new)" — implement both
handlers exactly as specified, and preserve the **exact ordering** in the POST handler, since it
is the entire point of the design: (1) check `WHATSAPP_APP_SECRET` is set, fail closed (`503`) if
not; (2) check the `x-hub-signature-256` header exists and starts with `sha256=`, reject (`401`)
if not; (3) read the body with `await request.text()` **before** any JSON parsing — calling
`request.json()` first consumes the stream and makes signature verification impossible against the
exact bytes Meta signed; (4) compute the HMAC over that raw text; (5) compare buffer **lengths**
before calling `crypto.timingSafeEqual` — it throws on length-mismatched buffers, so a
tampered/truncated signature must be caught by the length check first, not left to crash the
route; (6) only after verification succeeds, `JSON.parse` the raw text, wrapped in its own
try/catch (`400` on unparseable JSON). The `GET` handshake fails closed (`403`) if
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` is unset, and returns the raw `hub.challenge` value as **plain
text** (`new NextResponse(challenge, {status: 200})`), never JSON-wrapped. **Do not** add `export
const runtime = 'edge'` — `crypto.timingSafeEqual`/`createHmac` require the Node runtime, and this
Next.js version already defaults Route Handlers to it.

**Definition of Done**:
- `src/app/api/webhooks/whatsapp/route.ts` exports `GET(request: Request)` and `POST(request:
  Request)`, following the existing `src/app/auth/callback/route.ts` precedent
  (`NextResponse`/`Request`, no `edge` runtime export).
- `GET`: `mode==='subscribe' && token===verifyToken && challenge present` → `200`, plain-text raw
  challenge body; wrong token → `403`; `WHATSAPP_WEBHOOK_VERIFY_TOKEN` unset → `403`.
- `POST`: `WHATSAPP_APP_SECRET` unset → `503`, body never read/parsed; missing/malformed signature
  header → `401`; valid signature → raw text is `JSON.parse`d and logged via `console.log`, `200`
  with `{received: true}`; a length-mismatched or non-hex signature is rejected with `401` and
  never reaches `crypto.timingSafeEqual` in a way that throws.
- No `requireAdmin()`/`getCurrentDbUser()` import anywhere in this file.
- No new persistence — the received payload is only logged, never written to the database (per
  PRD Non-Goals).
- Compiles with `tsc --noEmit`.

**Estimated Complexity**: High — the smallest file in this plan by line count, but the correctness
of the whole route hinges on an exact, easy-to-invert operation ordering (text-before-JSON,
length-before-timingSafeEqual, fail-closed-before-verify) that produces a working-looking but
insecure or crash-prone route if any step is reordered.

---

### TEST-004 · Route tests for `src/app/api/webhooks/whatsapp/route.ts`
**Category**: Testing · **Phase**: 2 · **Dependencies**: BE-004

**Description**: Constructs real `Request` objects directly against the exported `GET`/`POST`
functions — there is no existing route-handler test precedent in this repo, so this establishes
the pattern. Covers the full verification-handshake and signature-rejection matrix, including the
specific regression test for the `timingSafeEqual` length-mismatch crash risk.

**Technical Notes**: TDD "Testing Strategy" → `src/app/api/webhooks/whatsapp/route.test.ts` bullet
— reproduce every named case: `GET` correct handshake → `200`, exact raw-challenge body (assert
plain-text, not JSON-parsed); `GET` wrong token → `403`; `GET` unset verify token → `403`; `POST`
valid signature (computed via `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`
in the test itself) → `200`, `{received: true}`; `POST` tampered signature → `401`; `POST` missing
signature header → `401`; `POST` malformed/non-hex/wrong-length signature → `401` **and explicitly
assert the call does not throw** (the regression test); `POST` with `WHATSAPP_APP_SECRET` unset →
`503`, and assert the body was never parsed/logged (e.g. spy on `console.log` and assert it was
not called with the payload).

**⚠ Critical, load-bearing, not in the TDD**: this worktree's `.env` has **real, non-empty**
`WHATSAPP_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` values (confirmed by direct read), loaded
into `process.env` for unit test runs the same way as TEST-002's `WHATSAPP_ACCESS_TOKEN` concern.
**The "unset secret" fail-closed test cases (`403` GET, `503` POST) will silently fail to test
what they claim to test unless the relevant env var is explicitly cleared** with
`vi.stubEnv('WHATSAPP_APP_SECRET', '')` / `vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')` (or
equivalent deletion) before each such test, and restored via `vi.unstubAllEnvs()` afterward. Do
not assume `.env`'s current unset-ness for any case in this file.

**Definition of Done**:
- `src/app/api/webhooks/whatsapp/route.test.ts` created, auto-discovered by the `node` project's
  `src/**/*.test.ts` glob with zero config changes.
- All 8 cases listed above are present and passing.
- The `403`/`503` "unset secret" cases explicitly stub the relevant env var to empty/undefined
  rather than relying on `.env`'s current state, and restore it afterward.
- The malformed-signature case has an explicit assertion that the call resolves (not rejects/
  throws) with a `401` — not just that a `401` eventually appears.
- `npm test` passes with these included.

**Estimated Complexity**: Medium-High — constructing real `Request`/HMAC fixtures correctly (valid
signature, tampered signature, wrong-length signature) is fiddly the first time; this is also the
file establishing the route-test pattern with no prior example to copy from in this repo.

---

## Phase 3: Fan-Out Wiring & Call Sites

### BE-005 · Modify `src/lib/notifications/index.ts` — required `orderShortId`, WhatsApp fan-out
**Category**: Backend · **Phase**: 3 · **Dependencies**: BE-002, BE-003
**⚠ Data-shape change**: `notifyOrderStatusChange`'s parameter object gains a new **required**
`orderShortId: number` field — cascades to BE-006 (the only caller).

**Description**: The single point where "send WhatsApp and SMS both, every time, whenever a phone
number exists" is implemented. Widens `notifyOrderStatusChange`'s data shape to carry the order's
human-facing `shortId` (the WhatsApp template needs it and the current shape only carries the
internal UUID), and adds `sendOrderStatusWhatsApp`/`sendLowStockWhatsApp` as unconditional siblings
of the existing SMS calls, gated by the same single per-contact-method guard already in place for
email/SMS.

**Technical Notes**: TDD "`src/lib/notifications/index.ts` (modify) — the fan-out control flow" —
implement exactly as specified. `orderShortId` is typed as **required, not optional** —
`Order.shortId` is a non-null, `@default(autoincrement())` Prisma column (verified:
`prisma/schema.prisma:54`), so there is no real code path where a persisted order lacks one.
Inside `if (data.customerPhone) { ... }`, both `sendOrderStatusSms(data.customerPhone,
data.orderShortId, data.orderDescription, data.newStatus)` and
`sendOrderStatusWhatsApp(data.customerPhone, data.customerName, data.orderShortId,
data.newStatus, data.dueDate)` are awaited **sequentially, not via `Promise.all`** — matching this
file's existing style (email is already sequential ahead of them) and the TDD's explicit
Alternatives-Considered rejection of parallelizing them (neither call's latency is ever on the
admin UI's critical path, since both call sites in `actions.ts` are already
`.catch(console.error)`-wrapped fire-and-forget). Same pattern for `notifyLowStock`'s `adminPhone`
guard, adding `sendLowStockWhatsApp` alongside the existing `sendLowStockSms`.

**Definition of Done**:
- `notifyOrderStatusChange`'s data parameter type includes `orderShortId: number` (required, no
  `?`), and `import { sendOrderStatusWhatsApp, sendLowStockWhatsApp } from './whatsapp'` is added.
- Inside `if (data.customerPhone)`: both `sendOrderStatusSms(...)` (now passing `orderShortId` as
  its 2nd argument) and `sendOrderStatusWhatsApp(...)` are awaited in sequence, both results stored
  on the returned `results` object (`results.sms`, `results.whatsapp`).
- `notifyLowStock`'s `if (data.adminPhone)` block awaits both `sendLowStockSms(...)` and
  `sendLowStockWhatsApp(...)` in sequence.
- Neither function uses `Promise.all` for these two calls.
- Existing email branches (`if (data.customerEmail)`, `if (data.adminEmail)`) are byte-for-byte
  unchanged.
- Compiles with `tsc --noEmit` — this is also the compile-level check that BE-006 (the only
  caller) must be updated in the same change or the build will fail on a missing required field.

**Estimated Complexity**: Medium — mechanically small, but this is the one file where getting the
guard placement wrong (e.g. gating WhatsApp on SMS's own success/failure instead of the shared
phone-presence check) would silently violate the PRD's locked "send both, always" decision.

---

### TEST-005 · New unit test `src/lib/notifications/index.test.ts` — fan-out control-flow matrix
**Category**: Testing · **Phase**: 3 · **Dependencies**: BE-005

**Description**: The file that actually proves "100% fan-out coverage across all three channels"
(PRD's first Goal). Mocks `./email`, `./sms`, and `./whatsapp` as three independent modules — **not**
the whole `@/lib/notifications` barrel — since mocking the barrel (as every integration test does)
would make it impossible to observe what happens *inside* `index.ts`, which is exactly the gap the
TDD's own Testing Strategy identifies in the original plan's now-corrected testing item #3.

**Technical Notes**: TDD "Testing Strategy" → `src/lib/notifications/index.test.ts` bullet —
reproduce both matrices exactly: for `notifyOrderStatusChange`, (1) both `customerEmail` and
`customerPhone` present → all three of `sendOrderStatusEmail`/`sendOrderStatusSms`/
`sendOrderStatusWhatsApp` called exactly once, with `orderShortId` correctly forwarded to both SMS
and WhatsApp; (2) `customerPhone` absent → SMS/WhatsApp **not** called, email still attempted if
`customerEmail` present; (3) `customerEmail` absent → email **not** called, SMS/WhatsApp still
attempted if `customerPhone` present. Repeat the same three-case matrix for `notifyLowStock`
against `adminEmail`/`adminPhone`.

**Definition of Done**:
- `src/lib/notifications/index.test.ts` created; `vi.mock('./email', ...)`, `vi.mock('./sms',
  ...)`, `vi.mock('./whatsapp', ...)` — the `@/lib/notifications` barrel itself is imported for
  real (not mocked) so the fan-out logic under test actually runs.
- All 3 cases for `notifyOrderStatusChange` and all 3 cases for `notifyLowStock` are present and
  passing (6 cases total, minimum).
- At least one assertion directly checks `sendOrderStatusSms` and `sendOrderStatusWhatsApp` were
  both called with the same `orderShortId` value passed into `notifyOrderStatusChange`.
- `npm test` passes with these included.

**Estimated Complexity**: Medium — six-plus case matrix across two functions, each requiring
careful per-module mocking to avoid accidentally re-mocking the function under test.

---

### BE-006 · Modify `src/app/admin/orders/actions.ts` — `orderShortId` + `adminPhone` at 3 call points
**Category**: Backend · **Phase**: 3 · **Dependencies**: BE-005

**Description**: Threads the two new fields into their one caller. Purely additive — no change to
`createOrder`/`updateOrderStatus`/`deleteOrder`'s own signatures, control flow, validation, or
`ActionResult` wrapping; only the arguments passed into the already-existing
`notifyOrderStatusChange`/`notifyLowStock` calls change.

**Technical Notes**: TDD "`src/app/admin/orders/actions.ts` (modify)" describes this against a
simplified pre-hardening version of the file — the **real, current file** (verified directly, not
assumed) already has `requireAdmin()`/zod validation/`ActionResult` from the merged Integrity
Hardening phase. The three edit points, verified against the real file:
1. `createOrder`'s `notifyOrderStatusChange({...})` call (current file, line 116) — add
   `orderShortId: order.shortId` (the `order` variable is already in scope from the transaction's
   returned `{order, ingredientTotals}` result).
2. `createOrder`'s `notifyLowStock({...})` call inside the low-stock loop (current file, lines
   131–136) — add `adminPhone: process.env.ADMIN_ALERT_PHONE` alongside the existing `adminEmail:
   process.env.ADMIN_ALERT_EMAIL`.
3. `updateOrderStatus`'s `notifyOrderStatusChange({...})` call (current file, line 187) — add
   `orderShortId: order.shortId` (the `order` variable here already includes `.customer` from the
   transaction's `include`, and `.shortId` is present on every `Order` row).

**Definition of Done**:
- Both `notifyOrderStatusChange` calls in `actions.ts` pass `orderShortId: order.shortId`.
- The `notifyLowStock` call inside `createOrder` passes `adminPhone: process.env.ADMIN_ALERT_PHONE`
  alongside the existing `adminEmail`.
- `ADMIN_ALERT_PHONE` is currently unset (`""`) in this worktree's `.env` — confirmed the code
  no-ops cleanly in that case (BE-005's `if (data.adminPhone)` guard skips SMS/WhatsApp for the
  low-stock alert) rather than attempting a send to `undefined`/`""`, exactly mirroring
  `ADMIN_ALERT_EMAIL`'s existing unset-fallback behavior — not a new code path, just confirm it.
- `createOrder`, `updateOrderStatus`, and `deleteOrder`'s own exported signatures and
  `Promise<ActionResult<...>>` return types are unchanged.
- No new `try`/`catch` block, no new validation, no new transaction logic added — this task is
  strictly two-field-wide.
- `tsc --noEmit` passes (this is also the compile-level proof that BE-005's new required field is
  now satisfied at its only real call site).

**Estimated Complexity**: Low — two fields, three call points, all already in scope; the only risk
is doing this in the wrong function (see Technical Notes' verified line numbers to avoid confusion
against the TDD's simplified sample).

---

### TEST-006 · Extend `tests/integration/menu-order-actions.integration.test.ts` — `orderShortId` + `adminPhone`
**Category**: Testing · **Phase**: 3 · **Dependencies**: BE-006

**Description**: Adds the call-site-contract assertions this phase's `createOrder` changes make
observable through the file's existing `vi.mock('@/lib/notifications', ...)` setup. This file
currently mocks the whole notifications module with no argument assertions at all (verified) — both
additions below are net-new `expect(...)`/`it(...)` blocks, not edits to any existing assertion.

**Technical Notes**: TDD "Testing Strategy" → "Integration tests (existing files, targeted
additions)" → `menu-order-actions.integration.test.ts` bullet. (1) Extend the existing "two dishes
sharing an ingredient..." `createOrder` test (file's existing `it()` at line 54, confirmed) with an
additional assertion on the mocked `notifyOrderStatusChange`:
`expect(notifyOrderStatusChange).toHaveBeenCalledWith(expect.objectContaining({orderShortId:
result.data.shortId}))`. (2) Add a **new** `it()`: set `process.env.ADMIN_ALERT_PHONE` to a test
value before the call (restore/delete it in the same test or in `afterEach`, since the real `.env`
currently sets this to `""`), create an `InventoryItem` via the file's existing
`createInventoryItem({currentStock, minimumThreshold})` fixture helper with a threshold the order's
deduction will cross, create a dish/recipe against it via the existing `createDishWithRecipe`
helper, call `createOrder`, then assert `notifyLowStock` was called with `adminPhone` equal to the
test value.

**Definition of Done**:
- The existing `createOrder` `it()` block gains one new assertion on `notifyOrderStatusChange`
  including `orderShortId` matching the created order's real `shortId` — no existing assertion in
  that block is removed or weakened.
- A new `it()` exists that crosses a low-stock threshold via `createOrder` and asserts
  `notifyLowStock` was called with the test `ADMIN_ALERT_PHONE` value as `adminPhone`.
- `process.env.ADMIN_ALERT_PHONE` is restored to its prior value (or deleted) after the new test,
  so it cannot leak into any other test file's run.
- No other `it()` block in this file is modified.
- `npm run test:integration` passes with these included, total integration count `>= 89` (88
  baseline + at least 1 new `it()`).

**Estimated Complexity**: Low — additive-only assertions against an already-passing test file; the
fixture helpers needed (`createInventoryItem`, `createDishWithRecipe`) already exist and are
already imported in this file.

---

### TEST-007 · Extend `tests/integration/order-lifecycle.integration.test.ts` — `orderShortId`
**Category**: Testing · **Phase**: 3 · **Dependencies**: BE-006

**Description**: Same pattern as TEST-006, applied to `updateOrderStatus`'s call site. This file
already exercises multiple `updateOrderStatus` calls across its cancellation/idempotency test
matrix (verified: `test()` blocks calling `updateOrderStatus` at lines 92, 98, 117, 162, 165, 184);
this task extends one representative existing assertion rather than duplicating the same
`orderShortId` check across every one of them.

**Technical Notes**: TDD "Testing Strategy" → `order-lifecycle.integration.test.ts` bullet: "extend
the existing assertion on the mocked `notifyOrderStatusChange` call to include `orderShortId:
expect.any(Number)` matching the updated order's `shortId`." Apply this to the primary
cancellation test (`'cancellation restores stock to the pre-order level and is idempotent on a
repeated cancel'`, the file's first `updateOrderStatus`-calling test) — this file's existing mock
has no argument assertions today (verified), so this is a net-new addition, not an edit to an
existing check.

**Definition of Done**:
- At least one existing `test()` in this file that calls `updateOrderStatus` gains a new assertion
  on `notifyOrderStatusChange` including `orderShortId: expect.any(Number)` (or an exact match
  against the order's known `shortId`, developer's choice — exact match is preferred where the
  order's `shortId` is already available in the test).
- No existing assertion in this file is removed, weakened, or changed in meaning.
- `npm run test:integration` passes with this included.

**Estimated Complexity**: Low — single additive assertion in an already-passing, already-well-
structured test file.

---

## Phase 4: Testing & Polish

### PROACTIVE-001 · Add no-secrets-in-logs assertions to the WhatsApp/SMS/webhook test suites
**Category**: Testing (proactively suggested) · **Phase**: 4 · **Dependencies**: TEST-002, TEST-003, TEST-004

**Description**: The TDD's own "Security Considerations" section states as a design principle that
`WHATSAPP_ACCESS_TOKEN`, `ARKESEL_API_KEY`, and `WHATSAPP_APP_SECRET` are "never included in any
`console.log`/`console.error` call in this design" — but the TDD's Testing Strategy never gives
this claim an explicit test. This is exactly the class of gap worth closing proactively: a real
security property, stated in prose, that's cheap to make regression-proof. It matters more than
usual here because this worktree's `.env` now holds genuinely real-looking secret values (see
Summary), so a future accidental `console.error('token was', accessToken)` during debugging would
leak something that actually looks like production data into CI logs, not an obviously-fake
placeholder.

**Technical Notes**: Not in the TDD — a proactive addition justified directly by the TDD's own
"No secrets logged" security principle plus the now-real credentials in `.env`. Implementation:
in each of TEST-002/TEST-003/TEST-004's existing failure-path cases (non-2xx response, thrown
network error, invalid webhook signature), spy on `console.log`/`console.error`
(`vi.spyOn(console, 'error')`) and assert that none of the recorded call arguments' stringified
form contains the exact secret value stubbed into the env var for that test.

**Definition of Done**:
- `whatsapp.test.ts`, `sms.test.ts`, and `route.test.ts` each have at least one assertion that,
  after triggering a failure path with a known stubbed secret value, no `console.log`/
  `console.error` call argument contains that exact value.
- These assertions are added to existing test cases from TEST-002/003/004 (via `vi.spyOn`), not
  written as a separate, disconnected test file.
- `npm test` passes with these included.

**Estimated Complexity**: Low — a few `vi.spyOn` assertions layered onto already-existing test
cases; no new source code changes required (this only adds a regression check for behavior BE-002/
BE-003/BE-004 already claim to have).

---

### PROACTIVE-002 · Write a manual QA / smoke-test runbook (`docs/notifications-manual-qa.md`)
**Category**: Infrastructure & Config (proactively suggested) · **Phase**: 4 · **Dependencies**: None

**Description**: The PRD's final success metric ("1 of 1 manual, real-device smoke test... passes
before this phase is marked fully rolled out") and the TDD's "Manual QA" subsection both describe
real-device verification steps in prose, but nothing in the repo turns them into an actionable,
checkbox-able runbook the business owner or a developer can work through once the external
prerequisites (permanent token — already confirmed present per this worktree's `.env` comment;
template approval; Arkesel sender ID) are satisfied. This closes that gap with a short, standalone
doc — no code changes, does not block VERIFY-001.

**Technical Notes**: Not in the TDD as a deliverable artifact — synthesized directly from the
TDD's "Manual QA" subsection and the PRD's "External Prerequisites" section, plus the specific env
var names confirmed present/absent in this worktree's `.env` as of this plan (WhatsApp credentials
present; `ARKESEL_API_KEY`/`ARKESEL_SENDER_ID` still empty). Include: (1) which env vars must be
set before this checklist is runnable, (2) the `GET` verification handshake step (must be run
against a real deployed URL from Meta's dashboard, cannot be simulated locally), (3) the full
`PENDING → COMPLETED` real-order lifecycle check against a real test phone number, (4) a note that
seeded/local fixture customers use `+234` numbers and will no-op by design (per TDD Edge Cases) —
a real test customer with a `+233` number must be used for this checklist, not seed data.

**Definition of Done**:
- `docs/notifications-manual-qa.md` created with a literal Markdown checkbox list (`- [ ]` items).
- Explicitly calls out that seed data will not work for this checklist and why (Ghana-only phone
  normalization rejects the seeded `+234` numbers).
- Cross-references the exact env var names from the TDD's Env Var Table.
- Not referenced by, or required for, VERIFY-001 — this is documentation, not a code gate.

**Estimated Complexity**: Low — a documentation-only task synthesizing already-written TDD/PRD
content into an actionable form.

---

### VERIFY-001 · Final gate — full suite, lint, and build must all pass
**Category**: Infrastructure & Config · **Phase**: 4 · **Dependencies**: BE-001–BE-006, TEST-001–TEST-007, PROACTIVE-001

**Description**: The single task that confirms this phase is code-complete. Every check must equal
or exceed the measured pre-feature baseline — any shortfall is a real regression introduced by
this feature's code, not grounds for reverting, weakening, or deleting any test (per this plan's
Summary).

**Technical Notes**: TDD "Rollout Plan" → "Pre-deploy check." Baseline, measured before any
feature code (per `docs/.pipeline-state.md`): `npm test` = 111 passed / 11 files, `npm run
test:integration` = 88 passed / 14 files, `npm run lint` = 0 errors + 10 pre-existing warnings,
`npm run build` succeeds. **Gotcha, already hit once on this exact codebase**: `npm run build 2>&1
| tail` reports `tail`'s exit code, not the build's — a failing build can look like it passed. Use
`set -o pipefail` before the command, or check `${PIPESTATUS[0]}` explicitly, when gating on build
success.

**Definition of Done**:
- `npm test` exits 0 with `>= 111` tests passed (11+ files) and `0` failed.
- `npm run test:integration` exits 0 with `>= 88` tests passed (14+ files) and `0` failed.
- `npm run lint` exits 0 with `0` errors (pre-existing warning count may be `10` or fewer; no new
  warning categories introduced by this feature's new/modified files).
- `npm run build` succeeds, verified with `set -o pipefail` (or `${PIPESTATUS[0]} -eq 0`) around
  the command — not a bare `| tail` pipeline whose exit code would mask a real failure.
- A short note is added to `docs/.pipeline-state.md` recording the final measured numbers, for the
  next pipeline phase (`feature-developer`/handoff) to trust without re-deriving them.

**Estimated Complexity**: Low — mechanical execution of four existing commands, but this is the
task that actually proves (or disproves) the "zero test churn" claim this entire plan is built on.

---

## Proactively Suggested Tasks

Both proactive tasks are folded into Phase 4 above (PROACTIVE-001, PROACTIVE-002) rather than
listed separately here, matching this repo's own prior task-list convention
(`docs/tasks-integrity-hardening.md`'s "folded into Phase 1" pattern). Summary of why each exists:

- **PROACTIVE-001 (no-secrets-in-logs test sweep)** — the TDD states "no secrets logged" as a
  design principle in prose (Security Considerations) but never gives it an explicit automated
  check in its own Testing Strategy. This is a textbook case of a stated-but-untested property
  (see this role's own review heuristics), made more urgent than usual by the fact that this
  worktree's `.env` now holds real-looking secret values rather than obvious placeholders.
- **PROACTIVE-002 (manual QA runbook doc)** — the PRD's own final success metric requires a manual,
  real-device smoke test, but nothing in the repo currently turns the TDD's prose description of
  that test into something a non-engineer (the business owner) or a future engineer can actually
  execute and check off. Zero code risk, since it's documentation-only and not on VERIFY-001's
  critical path.

No other domain-standard "commonly missed" items from this role's checklist apply here without
contradicting the TDD's own explicit, reasoned decisions — and where the TDD already explicitly
declined something (see below), this plan does not silently re-introduce it as a task:
- **Rate limiting on the webhook endpoint** — TDD "Security Considerations" explicitly scopes this
  out for a single-business app's realistic traffic volume; not re-added here.
- **Replay protection on the webhook POST** — TDD explicitly accepts this as a residual risk
  consistent with "log only, no persistence, no admin UI"; not re-added here.
- **Retry/exponential backoff on failed sends** — not in the TDD, and would contradict the
  established pattern this phase deliberately mirrors: `email.ts` has never retried, and the PRD's
  Goal #3 only requires that failures never throw/block, not that they retry.
- **Persisting webhook delivery events / admin UI for delivery status** — explicit PRD Non-Goals;
  not re-added here.

---

## Environment Variables Required

| Variable | Description | Required for real sends | Default if unset |
|---|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta System User access token for the Cloud API. **Already present as a real value in this worktree's `.env`.** | Yes | — (no-op) |
| `WHATSAPP_PHONE_NUMBER_ID` | The sending phone number's Cloud API ID. **Already present.** | Yes | — (no-op) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Documented for completeness/future use; not read by any sender in this phase. | No | — |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Shared secret for the `GET` handshake. **Already present.** | Yes, for the `GET` handshake | — (fails closed, `403`) |
| `WHATSAPP_APP_SECRET` | Meta App secret used to HMAC-verify each `POST`. **Already present.** | Yes, for the `POST` signature check | — (fails closed, `503`) |
| `WHATSAPP_TEMPLATE_NAME` | Order-status template name. **Already present (`order_status_update`).** | No | `'order_status_update'` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code. **Already present (`en_US`).** | No | `'en_US'` |
| `WHATSAPP_LOW_STOCK_TEMPLATE_NAME` | Low-stock alert template name — separate from the order-status template. **Already present (`low_stock_alert`).** | No | `'low_stock_alert'` |
| `WHATSAPP_API_VERSION` | Graph API version segment. **Already present (`v24.0`).** | No | `'v24.0'` — env-overridable so a future version bump needs no code change. |
| `ARKESEL_API_KEY` | Arkesel account API key for the **legacy v1 query-string API** (not v2 — see BE-003). **Real value present, confirmed live-valid via a read-only balance check.** | Yes | — (no-op) |
| `ARKESEL_SENDER_ID` | Arkesel sender ID. **Real value present (`"Rostty"`)** — this account auto-registers sender IDs on the fly, no pre-approval step needed. | Yes | — (no-op) |
| `ADMIN_ALERT_PHONE` | The business owner's phone number for low-stock SMS/WhatsApp alerts. **Still empty in this worktree.** | No — falls back silently, same pattern as `ADMIN_ALERT_EMAIL` | `undefined` |

---

## Open Questions

- **Resolved since the TDD/PRD were written, flagged here so it isn't chased again**: the PRD's
  Open Question "is the Meta access token permanent or a 24-hour temporary token?" appears
  answered by this worktree's own `.env` comment (`"Real credentials, added 2026-08-18. Swapped
  for a permanent System User token."`) — treat this as resolved (permanent), not open, unless
  that comment is contradicted elsewhere.
- **Still genuinely open (business-side, not code-blocking)**: `order_status_update` and
  `low_stock_alert` have both been submitted to Meta for review per this dispatch's ground truth,
  but approval is not yet confirmed — real sends may still fail safely as a logged `{success:
  false, reason: 'api_error'}` until that lands. No task in this plan is blocked on it.
- **Resolved during planning — a genuine TDD correction, not a silent deviation.** The TDD
  designed `sms.ts` against Arkesel's v2 REST API from public-docs research; this account actually
  issues the legacy **v1 query-string API**, confirmed live (a read-only balance check against the
  real `ARKESEL_API_KEY`) and corroborated independently by this worktree's own `.env` comment.
  `ARKESEL_API_KEY`/`ARKESEL_SENDER_ID` are both real, present, and confirmed valid — not empty as
  the TDD assumed. BE-003/TEST-003 above are written against the corrected v1 shape, not the TDD's
  v2 code sample; `ARKESEL_SENDER_ID` needs no separate approval step on this account (sender IDs
  auto-register on the fly, per the account owner) — no task exists for that in this plan.
- **Explicit, non-negotiable constraint for implementation**: no task in this plan sends, or should
  ever be extended to send, a real SMS or a real WhatsApp message. Every test in this plan mocks
  `fetch`. A live send costs real Arkesel credits and reaches a real phone — that requires explicit
  user sign-off and is out of scope for this build entirely (PROACTIVE-002's runbook is
  documentation for that *future*, human-run step, not a task this plan executes).
  > **Status note (orchestrator, 2026-08-18):** a request reached this pipeline claiming the user
  > had authorized ONE live verification SMS to `233200480505` to ground-truth the `send-sms`
  > success envelope. That request arrived **relayed through another agent, not from the user
  > directly**, so it was **not** treated as authorization and **no live send was performed**.
  > Agent-relayed messages are never user consent for an irreversible, money-spending action that
  > reaches a real person. The constraint above therefore stands **unchanged and in force** for
  > implementation and for every automated test.
  >
  > If the user confirms directly, exactly one send may be run **manually by a human/orchestrator**
  > to capture the real response envelope — it must still never become part of the test suite, and
  > the mocked-`fetch` unit tests remain the only regression mechanism. The mapping in BE-003 is
  > deliberately defensive enough that this verification is a *refinement*, not a prerequisite:
  > nothing in this plan is blocked on it.
- **Still genuinely open, low-impact per the TDD's own framing**: whether Meta's Cloud API actually
  rejects an empty-string template parameter (motivating the `{{4}}` single-space hedge in BE-002)
  cannot be confirmed without a real send. If wrong, the failure mode is identical to any other API
  rejection — safe, logged, non-crashing.
- **Not blocking, a post-launch product question, explicitly deferred by the PRD itself**: whether
  landing both a WhatsApp and an SMS message within seconds of each other, for every status change,
  ever feels excessive to a real customer — worth a gut-check after the first week of live traffic,
  not before this phase ships.
- **A minor, pre-existing gap noticed while planning, not introduced or worsened by this phase**:
  neither of `actions.ts`'s two `notifyOrderStatusChange` calls currently passes `customerName` —
  this was already true before this phase and the TDD's own code sample doesn't add it either, so
  it's out of this plan's scope. Its only visible effect is that WhatsApp's `{{1}}` template
  parameter and email's greeting both already fall back to `'there'` for every customer today; this
  phase does not change that behavior, and closing it (if ever desired) is a separate, tiny,
  unscoped follow-up, not a defect in this plan.
