# PRD: Real Customer Notifications (WhatsApp Business Cloud API + Arkesel SMS)

## Status
Draft

## Problem Statement
"Chop with Rostty" is a phone/WhatsApp-first Ghanaian catering business, but its own software
cannot reach customers on either channel today. `src/lib/notifications/email.ts` only sends if
`RESEND_API_KEY` is set (and the local `.env` currently has a typo, `RESEND_API_KEY_WRONG`, so
it's silently no-op-ing there too — a one-line fix tracked separately, not part of this phase),
and `src/lib/notifications/sms.ts` is a hardcoded stub that only `console.log`s. Every one of the
six order-status transitions a customer cares about (their order received, being prepped, being
cooked, ready, completed, or cancelled) is effectively silent. The business owner is left
fielding "is my order ready?" phone calls that the software was supposed to eliminate, and has no
real-time way to know when her own ingredient stock runs low, since the admin low-stock alert
suffers the identical email-only, easy-to-miss problem.

## Goals
- We will know this is successful when all 6 `OrderStatus` transitions (`PENDING`, `PREPPING`,
  `COOKING`, `READY`, `COMPLETED`, `CANCELLED`) trigger an attempted WhatsApp send **and** an
  attempted SMS send to the customer, in addition to the existing email — verified by a unit test
  suite asserting 100% fan-out coverage across all three channels. Today this is 0% for WhatsApp
  and SMS (0 real sends ever occur on either channel).
- We will know this is successful when the business owner's low-stock alert reaches her own phone
  via SMS and WhatsApp, not only an email she may not see in time — verified by wiring a new
  `ADMIN_ALERT_PHONE` env var into the existing low-stock alert call site, which today receives no
  phone number at all and therefore never fires `sendLowStockSms`/its WhatsApp equivalent.
- We will know this is successful when zero notification failures — missing credentials, an
  unapproved WhatsApp template, an invalid phone number, an Arkesel or Meta API error — ever throw
  an unhandled exception or block/roll back an order-status change. Every existing sender in this
  codebase already guarantees this for email; this phase extends the same guarantee to WhatsApp
  and SMS, verified by a dedicated failure-mode test matrix (see the companion TDD).
- We will know this is successful when the Meta-mandated webhook endpoint correctly completes the
  verification handshake on setup and rejects every POST whose HMAC signature doesn't match —
  verified by dedicated route tests. Today no such endpoint exists in this codebase at all.
- We will know this is successful when, once the three external prerequisites below are satisfied
  by the business owner, at least one full real order lifecycle (`PENDING` → `COMPLETED`) produces
  an actual, received WhatsApp message and an actual, received SMS on a real test phone —
  confirmed by a manual smoke test before this phase is considered fully rolled out (not just
  code-complete).

## Non-Goals
- **No primary/fallback channel logic.** WhatsApp and SMS are both attempted, every time,
  independently — this was decided with the business owner ahead of this phase (she chose
  reliability over the cost savings of a fallback-only approach) and is a settled constraint, not
  open for reconsideration in this document.
- **No change to which order-status transitions trigger a notification.** All 6 statuses notify,
  exactly matching today's email behavior — also a settled decision, not new scope.
- **No inbound WhatsApp reply handling or two-way chat.** The webhook endpoint this phase adds
  exists only to satisfy Meta's outbound-delivery-event contract (verification handshake +
  signature-checked logging); it does not power any conversational feature.
- **No persistence of webhook delivery events to the database**, and **no admin-facing UI for
  delivery status** (read receipts, failed-delivery indicators, etc.). Delivery events are logged
  server-side only, matching this codebase's existing "log, don't build a UI for it yet" pattern.
- **No customer-facing or admin-facing channel-preference toggle.** A customer cannot opt out of
  WhatsApp-only or SMS-only in this phase.
- **No repeat-order button, stock-aware fulfillment check, weekly snapshot, or admin table
  search/filter.** These were the roadmap's original "Phase 3" grab-bag; they are explicitly
  renumbered to Phase 4 and are not part of this document.
- **No fix to the unrelated `RESEND_API_KEY_WRONG` typo** blocking email today — flagged for a
  separate one-line fix, not bundled into this phase's scope.

## User Stories
1. As a customer, I want to receive a WhatsApp message when my order's status changes, so I know
   when to expect my food without calling the caterer to ask.
2. As a customer who doesn't use WhatsApp but has a phone number on file, I want to receive an SMS
   with the same update, so I'm not left uninformed just because I don't use one particular app.
3. As the business owner (admin), I want a low-stock alert to reach my own phone by SMS and
   WhatsApp — not only an email I may not check between orders — so I notice I'm about to run out
   of an ingredient in time to restock before it affects a real order.
4. As the business owner, I want a customer's notifications to go out reliably even if one channel
   is temporarily broken (an unapproved template, an expired access token), so the other channel
   still reaches them — no single point of failure between the two.
5. As Meta's platform, I want to verify ownership of this webhook endpoint once, and have every
   delivery-event POST after that cryptographically authenticated, so no third party can inject
   fake delivery events into the system.
6. As a developer running this app locally with no real WhatsApp/Arkesel credentials configured, I
   want every notification send to no-op cleanly and log to the console — never crash, never block
   order creation — so local development and CI are completely unaffected by the absence of real
   credentials, exactly like `email.ts` already behaves without `RESEND_API_KEY`.

## Success Metrics
- **100%** of the 6 `OrderStatus` transitions produce an attempted WhatsApp send and an attempted
  SMS send whenever the customer has a phone number on file (test-verified) — up from **0%** today.
- **0** unhandled exceptions and **0** blocked/rolled-back order-status transitions caused by any
  notification failure, across the full failure-mode matrix defined in the TDD (missing
  credentials, invalid/unparseable phone number, non-2xx API response, thrown network error).
- **2 of 2** admin-facing alert channels (SMS and WhatsApp) become reachable once
  `ADMIN_ALERT_PHONE` is configured — up from **0** functioning phone-based channels today (the
  existing `sendLowStockSms` call site has never once received a phone number to send to).
- **100%** webhook signature-verification test coverage: a validly-signed POST is accepted, and
  every tampered, missing, or malformed signature is rejected with no server crash — **0%** today,
  since the endpoint does not exist.
- **1 of 1** manual, real-device smoke test (a full `PENDING → COMPLETED` order lifecycle producing
  a received WhatsApp message and a received SMS) passes before this phase is marked fully rolled
  out — contingent on the three external prerequisites below being satisfied first.

## UX/Flow Summary
Nothing changes in the admin UI's visible controls — an admin still changes an order's status
from the exact same `<select>` in `OrderClient.tsx`/`OrderDetailsClient.tsx` used today. What
changes is what happens after that click, entirely server-side and invisible to the person who
triggered it:

1. **Order created or status changed.** The existing `createOrder`/`updateOrderStatus` Server
   Actions run exactly as they do today (validation, stock deduction/restoration, `ActionResult`
   return) — this phase makes no change to that logic.
2. **Notification fan-out (fire-and-forget, unblocking).** After the database transaction commits,
   the existing `notifyOrderStatusChange` call fires — as it always has — but now reaches out on
   three independent channels instead of one: email (unchanged), SMS (now real, via Arkesel), and
   WhatsApp (new, via Meta's Cloud API). All three are attempted whenever the customer has the
   corresponding contact info; none is gated on another succeeding or failing. None of this blocks
   the admin's UI — the status change is already saved and shown before any of these sends resolve.
3. **Customer receives near-simultaneous WhatsApp and SMS.** Both messages carry the same
   information: the order's human-facing `#shortId` (never the internal UUID), a short status
   label, and — for statuses with a due date — a due-date note.
4. **Low-stock alert (admin-facing).** When an order's ingredient deduction pushes any
   `InventoryItem` at or below its `minimumThreshold`, the existing low-stock alert fires — now
   also reaching the business owner's own phone via SMS and WhatsApp, not only her email.
5. **Webhook verification (invisible to any human user).** Once configured in Meta's dashboard,
   Meta calls this app's new webhook URL to confirm ownership (a one-time handshake) and
   periodically thereafter to report delivery events for messages this app sent. Both requests are
   handled entirely server-to-server; no admin or customer ever sees or interacts with this
   endpoint directly.
6. **Local development is unaffected.** Without real WhatsApp/Arkesel credentials in `.env`
   (the default for any fresh clone or CI run), every send silently no-ops and logs to the
   console — exactly the behavior Resend email already has today, extended to the two new
   channels.

## External Prerequisites (manual, outside this codebase — not something engineering can build
around)
1. **A permanent Meta access token.** The Business Platform setup done so far (phone number +
   messaging use case) typically only yields a 24-hour temporary token from the API Setup screen.
   Production sending needs a permanent token generated from a Meta **System User** (Business
   Settings → System Users → token with `whatsapp_business_messaging` +
   `whatsapp_business_management` permissions). **Not yet confirmed** whether the token currently
   in hand is permanent or temporary — if temporary, real sends will start silently failing 24
   hours after it was issued.
2. **An approved WhatsApp message template** (`order_status_update`, Utility category) covering
   all 6 order statuses. WhatsApp Cloud API only allows business-initiated messages — which every
   order-status ping is — through a template Meta has reviewed and approved; free-form text only
   works inside a 24-hour window opened by an inbound customer message, which does not apply here.
   Meta's review is asynchronous (typically minutes to ~24 hours) and **cannot be built around** —
   only documented and designed for gracefully (a not-yet-approved template resolves to a normal,
   logged `{success: false}` result, never a crash — see the TDD).
3. **An Arkesel sender ID.** Alphanumeric sender IDs (e.g. "Rostty") typically require registration
   and approval with Arkesel; a generic shared sender ID may work immediately for testing. Needs
   confirmation of which the business owner's account currently has before assuming a custom
   sender ID is ready to use.
4. **A second, newly-identified WhatsApp template** (`low_stock_alert`, Utility category) —
   **discovered during technical design, not in the original three prerequisites.** The Cloud
   API's business-initiated-message rule applies equally to the admin-facing low-stock alert;
   reusing `order_status_update`'s approved body text for a low-stock message would render
   nonsensical copy once Meta approves it (its fixed wording is specifically about an order's
   status, not a stock level). If the business owner wants low-stock alerts on WhatsApp — not just
   SMS and email — this second template needs to be submitted for review as well. If she does not,
   `sendLowStockWhatsApp` can be left permanently unconfigured (it already no-ops safely, same as
   any other missing-template case) with no code change required either way.

## Open Questions
- **Confirm token type.** Is the Meta access token currently held a permanent System User token,
  or the 24-hour temporary token from API Setup? This determines whether real sends will keep
  working past the first day.
- **Confirm template submission status.** Has `order_status_update` been submitted to Meta for
  review yet? Real sends will fail (safely, as a logged `{success: false}`) until it's approved.
- **Confirm Arkesel sender ID.** Which sender ID is approved/available on the business owner's
  Arkesel account today?
- **Does the business owner want low-stock alerts on WhatsApp, not just SMS and email?** If yes,
  the new `low_stock_alert` template (prerequisite 4 above) needs to be submitted to Meta
  separately — this is new, previously unscoped work discovered while designing this phase, not a
  decision that was made when the original plan was written.
- **Will double-notification (WhatsApp + SMS landing within seconds of each other, for every
  status) ever feel excessive to a real customer once this ships?** Not a blocker — the
  send-both-always strategy was an explicit, informed choice — but worth a real-world gut check
  after the first week of live traffic, since it's cheap to revisit later if it turns out to be
  more noise than reassurance.
