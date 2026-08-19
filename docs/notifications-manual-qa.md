# Manual QA / Smoke-Test Runbook — WhatsApp + SMS Notifications

**Purpose**: the PRD's final success metric requires *one* real-device smoke test — a full
`PENDING → COMPLETED` order lifecycle producing an actually-received WhatsApp message and an
actually-received SMS — before this phase counts as fully rolled out (not merely code-complete).
Everything else in this phase is automated and green; this checklist is the part a human has to
run.

> ⚠ **Nothing in the automated test suite sends a real message.** Every test mocks `global.fetch`.
> A real send costs real Arkesel credits and reaches a real phone, so it is deliberately left to
> this human-run checklist and requires the business owner's explicit go-ahead.

---

## 0. Before you start — prerequisites

These are external to the codebase and cannot be built around.

- [ ] **`WHATSAPP_ACCESS_TOKEN`** is a *permanent* System User token, not the 24-hour temporary
      token from Meta's API Setup screen. (Confirmed permanent as of 2026-08-18: `/debug_token`
      reported `type: SYSTEM_USER`, `expires_at: 0`.) If real sends work today and start failing
      exactly 24 hours later, this is why.
- [ ] **`order_status_update`** template is **approved** by Meta (Utility category). Submitted;
      approval is asynchronous. Until it lands, sends fail safely as a logged
      `{success: false, reason: 'api_error'}` — never a crash.
- [ ] **`low_stock_alert`** template is **approved** by Meta (Utility category). This is a
      *separate* template from `order_status_update` — a WhatsApp template's approved body text
      cannot be swapped per-call, only its parameter values can.
- [ ] **`ARKESEL_API_KEY`** is valid and the account has a non-zero balance. Check *without*
      sending anything: `GET https://sms.arkesel.com/sms/api?action=check-balance&api_key=…&response=json`
      returns `{"balance":<n>,"user":"…","country":"Ghana"}`. This is read-only and costs nothing.
- [ ] **`ARKESEL_SENDER_ID`** is set (e.g. `Rostty`). Sender IDs auto-register on the fly on this
      account — no pre-approval step.
- [ ] **`ADMIN_ALERT_PHONE`** is set to the business owner's own number, if you intend to verify
      the low-stock alert (section 4). While unset, that path stays dormant by design.

### Env vars this feature reads

| Variable | Read by | Behavior when unset |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | `src/lib/notifications/whatsapp.ts` | no-op, logged |
| `WHATSAPP_PHONE_NUMBER_ID` | `src/lib/notifications/whatsapp.ts` | no-op, logged |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | *(not read by any sender — future use)* | — |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | `src/app/api/webhooks/whatsapp/route.ts` | **fails closed** — GET handshake 403 |
| `WHATSAPP_APP_SECRET` | `src/app/api/webhooks/whatsapp/route.ts` | **fails closed** — POST 503 |
| `WHATSAPP_TEMPLATE_NAME` | `src/lib/notifications/whatsapp.ts` | defaults to `order_status_update` |
| `WHATSAPP_LOW_STOCK_TEMPLATE_NAME` | `src/lib/notifications/whatsapp.ts` | defaults to `low_stock_alert` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `src/lib/notifications/whatsapp.ts` | defaults to `en_US` |
| `WHATSAPP_API_VERSION` | `src/lib/notifications/whatsapp.ts` | defaults to `v24.0` |
| `ARKESEL_API_KEY` | `src/lib/notifications/sms.ts` | no-op, logged |
| `ARKESEL_SENDER_ID` | `src/lib/notifications/sms.ts` | no-op, logged |
| `ADMIN_ALERT_PHONE` | `src/app/admin/orders/actions.ts` → `notifyLowStock` | silently skipped, like `ADMIN_ALERT_EMAIL` |

---

## 1. ⚠ Seed data will NOT work for this checklist — read this first

- [ ] Confirm you have created a **real test customer with a Ghanaian (`+233` / `0…`) phone
      number** on a handset you physically hold.

`prisma/seed.ts`'s fixture customers all carry **Nigerian (`+234`) phone numbers**. `toGhanaE164`
(`src/lib/phone.ts`) deliberately **rejects** any non-Ghana prefix rather than guessing at another
country's format — guessing would mean delivering a real customer's order updates to a stranger's
phone. So every seeded customer's SMS and WhatsApp send no-ops with
`{success: false, reason: 'invalid_phone'}`.

**That is correct, by-design behavior — not a bug.** If you run this checklist against seed data
you will see nothing arrive and wrongly conclude the feature is broken.

Accepted input formats (all normalize to `233XXXXXXXXX`): `0241234567`, `+233241234567`,
`233241234567`, `024 123 4567`, `024-123-4567`.

---

## 2. Webhook verification handshake (once, per deployed environment)

This **cannot be simulated locally** against Meta's real verification flow — Meta must reach a
publicly-routable URL.

- [ ] Deploy, and confirm `https://<your-domain>/api/webhooks/whatsapp` is publicly reachable.
- [ ] In Meta's dashboard → WhatsApp → Configuration → Webhook, enter that URL and the exact
      `WHATSAPP_WEBHOOK_VERIFY_TOKEN` value from the deployed environment.
- [ ] Click **Verify and save** → Meta reports success.
- [ ] Subscribe to the `messages` webhook field.
- [ ] Confirm in the server logs that later delivery events arrive as
      `[WhatsApp Webhook] Received event: …`.

**If verification fails**: a `403` means the token didn't match, or `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
is unset in the deployed environment (it fails closed rather than auto-verifying). Both are
configuration problems, not code problems.

---

## 3. The real order lifecycle (the PRD's success metric)

Run as an admin, against the real test customer from section 1, with the test handset in hand.

- [ ] Create an order for the test customer → a **WhatsApp** message arrives.
- [ ] The same order → an **SMS** arrives.
- [ ] Both messages show the order's **`#shortId`** (e.g. `#42`) — never a UUID.
- [ ] Move the order `PENDING → PREPPING` → both channels arrive again.
- [ ] `PREPPING → COOKING` → both arrive.
- [ ] `COOKING → READY` → both arrive.
- [ ] `READY → COMPLETED` → both arrive.
- [ ] On an order **with** a due date, the WhatsApp message's 4th placeholder reads
      `Due: <date>.` rather than being blank or erroring.
- [ ] Cancel a *different* test order → both channels report the cancellation.
- [ ] Throughout, the admin UI stayed responsive and no status change was blocked or rolled back —
      notifications are fire-and-forget and must never sit on the critical path.

### Confirm the real Arkesel `send-sms` response body

- [ ] Capture the logged `[SMS] Sent successfully: <body>` line from the first real send.

This is the one thing that genuinely could not be verified without sending: the documented success
body is `{"code":"ok","message":"Successfully Send","balance":<n>,"user":"…"}`, but only the
*balance* endpoint's shape has been observed live. The mapping in `sms.ts` is deliberately
defensive (fails on non-2xx, fails on a `code` present but not `"ok"`, accepts a 200 with no
`code` at all), so no code change is required either way — but if the real body turns out to carry
a *different* success signal, that mapping can now be sharpened with a real sample in hand.

---

## 4. Low-stock admin alert (optional — needs `ADMIN_ALERT_PHONE`)

- [ ] Set `ADMIN_ALERT_PHONE` to a Ghanaian number you hold, and restart the app.
- [ ] Create an order whose ingredient deduction pushes an `InventoryItem` **at or below** its
      `minimumThreshold` (the item's `minimumThreshold` must be `> 0` for the alert to fire).
- [ ] A **WhatsApp** low-stock alert arrives, naming the item, its remaining stock, and its unit.
- [ ] An **SMS** low-stock alert arrives with the same details.
- [ ] The alert used the `low_stock_alert` template, *not* `order_status_update`.

---

## 5. Failure modes worth confirming once (all should degrade quietly)

- [ ] Temporarily unset `WHATSAPP_ACCESS_TOKEN` → order status changes still succeed; the log
      shows a skip line; SMS still arrives. (This is also the emergency kill switch for the
      WhatsApp channel — no code deploy needed.)
- [ ] Temporarily unset `ARKESEL_API_KEY` → order status changes still succeed; WhatsApp still
      arrives.
- [ ] Set a customer's phone to a `+234` number → both phone channels no-op with `invalid_phone`;
      email still sends; nothing crashes.
- [ ] Confirm no log line anywhere contains the literal value of `WHATSAPP_ACCESS_TOKEN`,
      `ARKESEL_API_KEY`, or `WHATSAPP_APP_SECRET`. (Automated regression tests assert this, but
      it is worth one real-log eyeball since the Arkesel key travels in a URL.)

---

## Known gaps — accepted, not defects

- **No replay protection** on the webhook POST. A captured valid signature+body pair could be
  replayed; since nothing is persisted or acted on beyond a log line, the impact is noisy logs.
- **No rate limiting** on the webhook endpoint.
- **No retry/backoff** on a failed send — matching `email.ts`, which has never retried.
- **No admin-facing delivery-status UI** and **no persistence** of webhook events (explicit PRD
  non-goals).
- **A silently-expired token surfaces only in logs** — nothing proactively warns an admin.
