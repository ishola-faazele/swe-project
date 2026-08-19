# TDD/RFC: Real Customer Notifications (WhatsApp Business Cloud API + Arkesel SMS)

## Status
Draft

## Context & Motivation
See `docs/prd-notifications.md` for the user-facing framing. Technically, this phase replaces two
no-op notification channels with real providers and adds a third, without touching the
transactional core (`createOrder`, `updateOrderStatus`, stock deduction/restoration) at all:

- `src/lib/notifications/email.ts` is the only channel that ever really sends, and only when
  `RESEND_API_KEY` is set.
- `src/lib/notifications/sms.ts` is a hardcoded stub — `sendSms()` only `console.log`s and always
  returns `{ success: false, reason: 'sms_not_configured' }`. Its two callers,
  `sendOrderStatusSms`/`sendLowStockSms`, already have the right call shape; only `sendSms`'s body
  needs a real implementation.
- There is no WhatsApp integration at all today.
- `src/lib/notifications/index.ts`'s `notifyOrderStatusChange`/`notifyLowStock` are the two fan-out
  points every notification already flows through, called from exactly two places in
  `src/app/admin/orders/actions.ts`: `createOrder` (line 116, order-confirmation) and
  `updateOrderStatus` (line 187, status-change). `createOrder`'s low-stock call (line 131-136)
  passes only `adminEmail`, never `adminPhone` — making `sendLowStockSms` (and the WhatsApp
  equivalent this phase adds) permanently dead code until that's wired up.

This phase's job is narrow and mechanical: make `sms.ts` real, add `whatsapp.ts`, fan both into
`index.ts` alongside email, wire `ADMIN_ALERT_PHONE` into the one call site that's missing it, and
add the webhook route Meta requires to operate the Cloud API at all. **Two product decisions are
locked and are treated as hard constraints throughout this document, not options to weigh:**

1. **Channel strategy: send both WhatsApp and SMS, every time.** No primary/fallback branching —
   each channel is attempted independently whenever the customer has a phone number, exactly
   mirroring how email is already attempted independently whenever the customer has an email.
2. **Trigger points: all 6 `OrderStatus` transitions notify**, unchanged from today's email
   behavior. No new filtering logic at either call site.

**Environment baseline for this work**, verified directly in this worktree: `npm test` = 111
passed / 11 files, `npm run test:integration` = 88 passed / 14 files, `npm run lint` = 0 errors +
10 pre-existing warnings, `npm run build` succeeds. Any deviation from these numbers after this
phase lands is caused by this feature, not pre-existing breakage.

**No API credentials exist anywhere in this worktree or the main repo** — `.env` in both has zero
`WHATSAPP_*`/`ARKESEL_*` variables. This is a hard constraint on the design, not an oversight to
work around: the unconfigured/no-op path — not a live API call — is this phase's primary,
best-tested path, exactly mirroring how `email.ts` already behaves without `RESEND_API_KEY`. The
real Arkesel response shape is explicitly unverified (see Risks) and the mapping logic must not
hard-depend on any specific field of it existing.

## Proposed Design

### Module-by-module scope
| File | Change | Why |
|---|---|---|
| `src/lib/phone.ts` | **New.** Ghana → E.164 phone normalizer. | Both providers need a clean `233XXXXXXXXX`-shaped destination; `User.phone` is an unconstrained nullable string today. |
| `src/lib/notifications/whatsapp.ts` | **New.** WhatsApp Cloud API template-message sender. | Mirrors `email.ts`'s lazy-env-read / env-gated-no-op / try-catch-never-throws shape exactly. |
| `src/lib/notifications/sms.ts` | **Modify.** Replace `sendSms`'s stub body with a real Arkesel call. | Signature and both existing callers (`sendOrderStatusSms`, `sendLowStockSms`) stay intact — this is the seam the stub was already built around. |
| `src/lib/notifications/index.ts` | **Modify.** Fan `notifyOrderStatusChange`/`notifyLowStock` out to WhatsApp alongside email/SMS. | Single point where "send both, always" is implemented. |
| `src/app/admin/orders/actions.ts` | **Modify.** Pass `orderShortId` into both `notifyOrderStatusChange` calls; pass `adminPhone: process.env.ADMIN_ALERT_PHONE` into the low-stock call. | See "The `orderShortId` gap" below — this is the load-bearing call-site change this phase depends on. |
| `src/app/api/webhooks/whatsapp/route.ts` | **New.** First file in a new `src/app/api/` directory. | GET verification handshake, POST signature-verified logging. Unauthenticated by design. |
| `.env.example` | **Modify.** New WhatsApp block; replace unused `TWILIO_*` with `ARKESEL_*`; add `ADMIN_ALERT_PHONE`. | Keeps the template a genuinely complete reference of every env var the app reads. |

`email.ts` is **not modified** in this phase — it is out of scope per the dispatch, and nothing in
this design requires touching it (see the `orderShortId` decision below for why that's safe).

### The `orderShortId` gap — the biggest design decision in this phase
`notifyOrderStatusChange`'s current parameter shape (`index.ts:11-19`) is:
```ts
{ customerEmail, customerPhone, customerName, orderId, orderDescription, newStatus, dueDate }
```
`orderId` is the **UUID**. There is no `shortId` anywhere in this shape. But the WhatsApp template
this phase depends on is specified as `"Hi {{1}}, your order #{{2}} at Chop with Rostty is now:
{{3}}. {{4}}"`, where `{{2}}` is the order's **`shortId`**, and `AGENTS.md` is explicit: *"Always
use `shortId` in user-facing strings... Use `id` (UUID) for URL parameters, relations, and DB
lookups."* Putting a raw UUID into a customer-facing WhatsApp message would violate that rule
outright and look broken to a customer (`"your order #a3f9c1e2-..."`).

**Decision: extend `notifyOrderStatusChange`'s data shape with a new, required
`orderShortId: number` field.** Both call sites already have the full `Order` row in scope at the
point they call it — `src/app/admin/orders/actions.ts:116` (`createOrder`, has `order` from the
just-created row) and `:187` (`updateOrderStatus`, has `order` from the transaction's `include:
{ customer: true }` return) — so passing `order.shortId` through is a one-line addition at each
site, not a new query. It is typed as **required**, not optional: `Order.shortId` is a non-null,
`@default(autoincrement())` column (`prisma/schema.prisma:54`) — there is no real code path where
a persisted order lacks one, so there is nothing to defensively guard against at the type level.

**Does SMS copy change too, or stay as-is?** The existing SMS copy
(`sms.ts:35-47`, `sendOrderStatusSms(phone, orderDescription, newStatus)`) never mentions
`shortId` today. Two channels describing the same order inconsistently — WhatsApp saying "order
#42," SMS saying only the free-text description — is a worse customer experience than either
being consistent. **Decision: yes, SMS copy changes too, additively.** `sendOrderStatusSms` gains
an `orderShortId` parameter and its message templates are updated to lead with `#{shortId}` while
keeping the existing description text, e.g. `Your order #42 ("40 pies, 40 bowls of jollof") has
been received.` This is a contained, single-file change (the same file is already being rewritten
to wire up Arkesel) and directly fixes an existing `AGENTS.md` violation rather than leaving it in
place next to a now-correct WhatsApp implementation. `email.ts` is untouched and keeps its current
copy (order description only, no shortId) — out of scope for this phase, and not a shape
`notifyOrderStatusChange` needs to change to support (email's data shape is unaffected by this
decision).

### "Unconditional" does not mean "send to a null phone"
The locked "send both, every time" decision means **no primary/fallback branching between
WhatsApp and SMS** — it does not mean stripping the existing phone-presence guard.
`notifyOrderStatusChange` keeps exactly one guard per contact method, mirroring the existing
`if (data.customerEmail)` pattern:
```ts
if (data.customerPhone) {
  results.sms = await sendOrderStatusSms(data.customerPhone, data.orderShortId, data.orderDescription, data.newStatus)
  results.whatsapp = await sendOrderStatusWhatsApp(data.customerPhone, data.customerName, data.orderShortId, data.newStatus, data.dueDate)
}
```
Both channels fire together, gated by the same single guard — SMS is never sent while WhatsApp is
skipped, or vice versa, based on anything other than both being genuinely attempted whenever a
phone number is present. **A phone number that exists but fails E.164 normalization is a separate,
per-channel concern**, handled one level down inside `sendOrderStatusSms`/`sendOrderStatusWhatsApp`
themselves (via `toGhanaE164`), not at this guard — see "Error/no-op semantics" below.

### `src/lib/phone.ts` (new)
```ts
/**
 * Normalizes a Ghanaian phone number to the bare E.164 digit string both WhatsApp Cloud API's
 * `to` field and Arkesel v1's `to` query parameter expect (e.g. "233241234567" — no leading '+').
 * Returns null for anything that doesn't resolve to a plausible Ghanaian mobile number, so
 * callers can no-op cleanly per channel instead of sending a malformed destination to either API.
 * Outbound-formatting only — never mutates User.phone as stored in the database.
 */
export function toGhanaE164(raw: string | null | undefined): string | null {
  if (!raw) return null

  const digitsOnly = raw.trim().replace(/[^\d+]/g, '')

  let normalized: string
  if (digitsOnly.startsWith('+233')) {
    normalized = digitsOnly.slice(1)
  } else if (digitsOnly.startsWith('233')) {
    normalized = digitsOnly
  } else if (digitsOnly.startsWith('0')) {
    normalized = '233' + digitsOnly.slice(1)
  } else {
    return null // unrecognized prefix (e.g. a non-Ghana country code) — don't guess
  }

  // Ghanaian mobile numbers: '233' + 9 digits = 12 digits total.
  if (!/^233\d{9}$/.test(normalized)) return null

  return normalized
}
```
This deliberately **rejects** non-Ghana-prefixed numbers rather than attempting to guess a
different country's format — see Edge Cases for why this matters against this repo's own seed
data.

### `src/lib/notifications/whatsapp.ts` (new)
Mirrors `email.ts`'s shape exactly: lazy env read (no client SDK, just `fetch`), env-gated no-op,
try/catch around the network call, **never throws**.

```ts
import { toGhanaE164 } from '@/lib/phone'

// Defaults to v24.0, NOT the plan's originally-pinned v22.0 — see "Graph API version" below for
// why this was overridden during spec verification. Always env-overridable regardless of default.
const GRAPH_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v24.0'

function graphUrl(phoneNumberId: string) {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
}

// Short labels, not full sentences — these get embedded inline in the approved template's fixed
// body ("...is now: {{3}}."), so a full sentence here (email.ts's style) would read as an
// awkward, redundant double statement. Deliberately a separate map from email.ts/sms.ts's.
const statusLabels: Record<string, string> = {
  PENDING: 'Pending',
  PREPPING: 'Being Prepped',
  COOKING: 'Cooking',
  READY: 'Ready for pickup/delivery',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export async function sendOrderStatusWhatsApp(
  phone: string,
  customerName: string | undefined,
  orderShortId: number,
  newStatus: string,
  dueDate?: string | null
) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) {
    console.log('[WhatsApp] Skipping send — WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID not configured')
    return { success: false, reason: 'whatsapp_not_configured' }
  }

  const to = toGhanaE164(phone)
  if (!to) {
    console.log('[WhatsApp] Skipping send — could not normalize phone number:', phone)
    return { success: false, reason: 'invalid_phone' }
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'order_status_update'
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US'
  const statusLabel = statusLabels[newStatus] ?? newStatus
  // See "Template parameter empty-string risk" below — ' ' (single space), not '', is used as
  // the placeholder for an absent due-date, since Meta's API may reject an empty parameter value.
  const dueDateNote = dueDate ? `Due: ${dueDate}.` : ' '

  try {
    const response = await fetch(graphUrl(phoneNumberId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: customerName || 'there' },
              { type: 'text', text: String(orderShortId) },
              { type: 'text', text: statusLabel },
              { type: 'text', text: dueDateNote },
            ],
          }],
        },
      }),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('[WhatsApp] Send failed:', response.status, body)
      return { success: false, reason: 'api_error', status: response.status, data: body }
    }

    console.log('[WhatsApp] Sent successfully:', body)
    return { success: true, data: body }
  } catch (error) {
    console.error('[WhatsApp] Failed to send:', error)
    return { success: false, error }
  }
}

export async function sendLowStockWhatsApp(phone: string, itemName: string, currentStock: number, unit: string) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) {
    console.log('[WhatsApp] Skipping low stock alert — WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID not configured')
    return { success: false, reason: 'whatsapp_not_configured' }
  }

  const to = toGhanaE164(phone)
  if (!to) {
    console.log('[WhatsApp] Skipping low stock alert — could not normalize phone number:', phone)
    return { success: false, reason: 'invalid_phone' }
  }

  // Deliberately a SEPARATE, dedicated template from sendOrderStatusWhatsApp — see "The
  // low-stock template gap" below for why order_status_update cannot be reused here.
  const templateName = process.env.WHATSAPP_LOW_STOCK_TEMPLATE_NAME || 'low_stock_alert'
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US'

  try {
    const response = await fetch(graphUrl(phoneNumberId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: itemName },
              { type: 'text', text: String(currentStock) },
              { type: 'text', text: unit },
            ],
          }],
        },
      }),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('[WhatsApp] Low stock alert failed:', response.status, body)
      return { success: false, reason: 'api_error', status: response.status, data: body }
    }
    return { success: true, data: body }
  } catch (error) {
    console.error('[WhatsApp] Failed to send low stock alert:', error)
    return { success: false, error }
  }
}
```

**The low-stock template gap — a second design decision the original plan did not anticipate.**
The plan lists `sendLowStockWhatsApp(phone, itemName, currentStock, unit)` as an export, matching
`sendOrderStatusWhatsApp`'s architecture — but the Cloud API's business-initiated-message rule
applies identically to this message: it also needs a pre-approved Utility-category template. The
plan's prerequisites section names only `order_status_update`. Reusing that template's approved
body (`"...your order #{{2}} ... is now: {{3}}. {{4}}"`) to carry a low-stock alert would either
require sending nonsensical text through it, or simply fail because the parameter *count* still
matches but the *semantics* don't map — WhatsApp does not allow swapping a template's approved
body text per-call, only the four parameter values. **Decision: introduce a second, dedicated
template, `low_stock_alert`** (`Body: "⚠️ Low Stock Alert: {{1}} is at {{2}} {{3}}. Please restock
soon."`, mirroring the existing email/SMS low-stock copy for consistency), env-configurable via
`WHATSAPP_LOW_STOCK_TEMPLATE_NAME`. This is flagged as **PRD prerequisite #4** — a new external
dependency discovered during this design, not part of the original three. If the business owner
does not submit this second template, `sendLowStockWhatsApp` simply keeps failing safely with
`{success: false, reason: 'api_error'}` (Meta rejects the unknown template name) — no code change
is required either way; it degrades exactly like any other not-yet-approved-template case.

### WhatsApp template variable mapping (`order_status_update`)
| Placeholder | Source | Notes |
|---|---|---|
| `{{1}}` | `customerName ?? 'there'` | Matches `email.ts`'s existing fallback text. |
| `{{2}}` | `String(orderShortId)` | **Never** the UUID — this is the entire reason `orderShortId` was added to the data shape. |
| `{{3}}` | `statusLabels[newStatus] ?? newStatus` | Short label form (see `whatsapp.ts` above), distinct from `email.ts`/`sms.ts`'s full-sentence copy, chosen to read naturally inside the template's fixed `"...is now: {{3}}."` wording. |
| `{{4}}` | `dueDate ? \`Due: ${dueDate}.\` : ' '` | A single space, not an empty string, when absent — see the empty-string risk note below. |

### Graph API version — overriding the plan's pinned `v22.0`
The original plan pinned `v22.0`. That was re-checked against Meta's authoritative version table
(`developers.facebook.com/docs/graph-api/changelog/versions/`) during spec verification: `v22.0`
released 2025-01-21 and **sunsets 2027-05-20** — under a year of runway from this phase's build
date. `v24.0` (released 2025-10-08, sunsets 2028-02-18) is mature, not bleeding-edge, and gives
~18 months of runway instead. **Decision: default to `v24.0`, not `v22.0`.** The template-message
request/response shape verified in the original plan (and reproduced above) is unchanged across
every version in this range, so nothing about the payload design changes — only the URL's version
segment and the env var's default value do. The version stays fully env-overridable
(`WHATSAPP_API_VERSION`) regardless of which default is chosen, so this decision is cheap to
revisit later without a code change either way.

### `src/lib/notifications/sms.ts` (modify)
Replace the stub body of `sendSms`; keep the exported function signatures and both callers'
call-shape mostly intact (only `sendOrderStatusSms` gains one new leading parameter, per the
`orderShortId` decision above).

```ts
import { toGhanaE164 } from '@/lib/phone'

export type SmsData = {
  to: string
  message: string
}

export async function sendSms(data: SmsData) {
  const apiKey = process.env.ARKESEL_API_KEY
  const senderId = process.env.ARKESEL_SENDER_ID
  if (!apiKey || !senderId) {
    console.log('[SMS] Skipping send — ARKESEL_API_KEY/ARKESEL_SENDER_ID not configured')
    console.log('[SMS] Would have sent:', data)
    return { success: false, reason: 'sms_not_configured' }
  }

  const to = toGhanaE164(data.to)
  if (!to) {
    console.log('[SMS] Skipping send — could not normalize phone number:', data.to)
    return { success: false, reason: 'invalid_phone' }
  }

  try {
    // ┌── CORRECTED 2026-08-18 (orchestrator): this account uses the LEGACY V1 API ──┐
    // The original design here targeted `POST https://sms.arkesel.com/api/v2/sms/send` with an
    // `api-key` header and a JSON body `{sender, message, recipients:[...]}`, derived from public
    // docs research. That is NOT what the business owner's actual Arkesel account exposes. The
    // real account API reference (supplied by the user) is the v1 query-string API: all GET, all
    // parameters in the URL, `api_key` as a query param (NOT a header), a single `to` number (NOT
    // a `recipients` array), the sender in `from`, and the message text in `sms`.
    //
    // VERIFIED LIVE against the real key (read-only balance check, no SMS sent):
    //   GET https://sms.arkesel.com/sms/api?action=check-balance&api_key=…&response=json
    //   → HTTP 200, content-type: application/json
    //   → {"balance":523,"user":"Faazele Ishola","country":"Ghana"}
    // So the key is valid and the account is genuinely v1.
    const url = new URL('https://sms.arkesel.com/sms/api')
    url.searchParams.set('action', 'send-sms')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('to', to)
    url.searchParams.set('from', senderId)
    url.searchParams.set('sms', data.message) // URLSearchParams encodes this for us
    const response = await fetch(url, { method: 'GET' })

    // Success mapping must check BOTH the HTTP status and the body — and require neither field.
    // Rationale: the verified balance response above carries NO `code` field at all, proving the
    // v1 envelope varies by action, so `code` cannot be treated as guaranteed. Meanwhile a
    // query-string API like this commonly returns HTTP 200 even for logical failures, so the HTTP
    // status alone is not sufficient either (this is the key difference from the v2 design).
    // Therefore: fail on non-2xx, fail on a `code` that is present but not "ok", and treat a 200
    // with no recognizable `code` as success rather than throwing.
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      console.error('[SMS] Arkesel send failed (HTTP):', response.status, body)
      return { success: false, reason: 'api_error', status: response.status, data: body }
    }

    // For `send-sms`, the reported success body is
    // `{code:"ok", message:"Successfully Send", balance:<n>, user:"..."}`, with numeric-STRING
    // failure codes (e.g. "102" = Authentication Failed, "109" = Invalid Schedule Time).
    // Checked only when present, never required.
    if (body?.code !== undefined && body.code !== 'ok') {
      console.error('[SMS] Arkesel send failed (code):', body.code, body?.message)
      return { success: false, reason: 'api_error', code: body.code, data: body }
    }

    console.log('[SMS] Sent successfully:', body)
    return { success: true, data: body }
  } catch (error) {
    console.error('[SMS] Failed to send:', error)
    return { success: false, error }
  }
}

export async function sendOrderStatusSms(
  phone: string,
  orderShortId: number,
  orderDescription: string,
  newStatus: string
) {
  const statusMessages: Record<string, string> = {
    PENDING: `Your order #${orderShortId} ("${orderDescription}") has been received.`,
    PREPPING: `Good news! We started prepping your order #${orderShortId} ("${orderDescription}").`,
    COOKING: `Your order #${orderShortId} ("${orderDescription}") is now being cooked!`,
    READY: `Your order #${orderShortId} ("${orderDescription}") is READY for pickup/delivery!`,
    COMPLETED: `Your order #${orderShortId} ("${orderDescription}") is completed. Thank you!`,
    CANCELLED: `Your order #${orderShortId} ("${orderDescription}") has been cancelled. Contact us for details.`,
  }
  const message = statusMessages[newStatus] || `Order #${orderShortId} status: ${newStatus}`
  return sendSms({ to: phone, message })
}

export async function sendLowStockSms(phone: string, itemName: string, currentStock: number, unit: string) {
  return sendSms({
    to: phone,
    message: `⚠️ Low Stock: ${itemName} is at ${currentStock} ${unit}. Please restock soon.`,
  })
}
```
The commented-out Twilio example (`sms.ts:23-30` today) is deleted — it is dead documentation
once a real provider is wired up.

### `src/lib/notifications/index.ts` (modify) — the fan-out control flow
```ts
import { sendOrderStatusEmail, sendLowStockAlert, type OrderStatusEmailData } from './email'
import { sendOrderStatusSms, sendLowStockSms } from './sms'
import { sendOrderStatusWhatsApp, sendLowStockWhatsApp } from './whatsapp'

export async function notifyOrderStatusChange(data: {
  customerEmail?: string | null
  customerPhone?: string | null
  customerName?: string
  orderId: string
  orderShortId: number           // NEW — required; see "The orderShortId gap" above
  orderDescription: string
  newStatus: string
  dueDate?: string | null
}) {
  const results: {
    email?: Awaited<ReturnType<typeof sendOrderStatusEmail>>
    sms?: Awaited<ReturnType<typeof sendOrderStatusSms>>
    whatsapp?: Awaited<ReturnType<typeof sendOrderStatusWhatsApp>>
  } = {}

  if (data.customerEmail) {
    results.email = await sendOrderStatusEmail({
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      orderId: data.orderId,
      orderDescription: data.orderDescription,
      newStatus: data.newStatus,
      dueDate: data.dueDate,
    })
  }

  // "Send both, every time": SMS and WhatsApp are independent, unconditional siblings — neither
  // is gated on the other's outcome, only on the shared phone-presence guard.
  if (data.customerPhone) {
    results.sms = await sendOrderStatusSms(data.customerPhone, data.orderShortId, data.orderDescription, data.newStatus)
    results.whatsapp = await sendOrderStatusWhatsApp(data.customerPhone, data.customerName, data.orderShortId, data.newStatus, data.dueDate)
  }

  return results
}

export async function notifyLowStock(data: {
  itemName: string
  currentStock: number
  unit: string
  adminEmail?: string
  adminPhone?: string
}) {
  const results: {
    email?: Awaited<ReturnType<typeof sendLowStockAlert>>
    sms?: Awaited<ReturnType<typeof sendLowStockSms>>
    whatsapp?: Awaited<ReturnType<typeof sendLowStockWhatsApp>>
  } = {}

  if (data.adminEmail) {
    results.email = await sendLowStockAlert(data.itemName, data.currentStock, data.unit, data.adminEmail)
  }

  if (data.adminPhone) {
    results.sms = await sendLowStockSms(data.adminPhone, data.itemName, data.currentStock, data.unit)
    results.whatsapp = await sendLowStockWhatsApp(data.adminPhone, data.itemName, data.currentStock, data.unit)
  }

  return results
}
```
SMS and WhatsApp are awaited sequentially, not via `Promise.all`, matching the file's existing
style (email is already sequential before them). This is a deliberate simplicity choice, not a
missed optimization — both calls are already invoked from a `.catch(console.error)`-wrapped,
never-awaited-by-the-caller fire-and-forget context at both call sites in `actions.ts`, so neither
channel's latency is on the critical path of the admin's UI response either way.

### `src/app/admin/orders/actions.ts` (modify)
Two changes, both additive to existing calls — no change to either function's own signature,
control flow, or transaction logic:
```ts
// createOrder — order-confirmation call site (today: line 116)
notifyOrderStatusChange({
  customerEmail: customer.email,
  customerPhone: customer.phone,
  orderId: order.id,
  orderShortId: order.shortId,   // NEW
  orderDescription: order.description,
  newStatus: 'PENDING',
}).catch(console.error)

// createOrder — low-stock call site (today: lines 131-136)
notifyLowStock({
  itemName: item.name,
  currentStock: item.currentStock,
  unit: item.unit,
  adminEmail: process.env.ADMIN_ALERT_EMAIL,
  adminPhone: process.env.ADMIN_ALERT_PHONE,   // NEW
}).catch(console.error)

// updateOrderStatus — status-change call site (today: line 187)
notifyOrderStatusChange({
  customerEmail: order.customer.email,
  customerPhone: order.customer.phone,
  orderId: order.id,
  orderShortId: order.shortId,   // NEW
  orderDescription: order.description,
  newStatus: order.status,
  dueDate: order.dueDate?.toLocaleDateString() ?? null,
}).catch(console.error)
```

### `src/app/api/webhooks/whatsapp/route.ts` (new)
First file in a new `src/app/api/` directory. Follows the one existing route-handler precedent in
this repo (`src/app/auth/callback/route.ts`): `import { NextResponse } from 'next/server'`,
`export async function GET/POST(request: Request)`, return `NextResponse`. **Unauthenticated by
design** — Meta calls this endpoint, not a logged-in admin. `requireAdmin()`/`getCurrentDbUser()`
from `src/lib/auth.ts` do not apply here and must not be added; the HMAC signature check is the
only gate. This is the first place Node's `crypto` module is used anywhere in this codebase.

**GET — verification handshake.**
```ts
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (!verifyToken) {
    // Fail closed: an unset verify token means we cannot distinguish a legitimate Meta handshake
    // from any other GET request. Reject rather than silently "auto-verifying."
    console.error('[WhatsApp Webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured — rejecting verification handshake')
    return new NextResponse('Webhook verify token not configured', { status: 403 })
  }

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    // Must be the RAW challenge value as plain text, not JSON — Meta's verification fails
    // otherwise.
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse('Verification failed', { status: 403 })
}
```

**POST — signature-verified event logging. Ordering matters; read this top to bottom.**
```ts
export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    // Fail closed: cannot verify anything without the secret. Reject rather than trust an
    // unverified payload.
    console.error('[WhatsApp Webhook] WHATSAPP_APP_SECRET not configured — rejecting POST')
    return new NextResponse('Not configured', { status: 503 })
  }

  const signatureHeader = request.headers.get('x-hub-signature-256')
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return new NextResponse('Missing signature', { status: 401 })
  }

  // MUST read as raw text FIRST. request.json() consumes the body stream; calling it before
  // computing the HMAC would make it impossible to verify the signature against the exact bytes
  // Meta signed. JSON.parse only happens after verification succeeds, below.
  const rawBody = await request.text()

  const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const providedSignature = signatureHeader.slice('sha256='.length)

  const expectedBuffer = Buffer.from(expectedSignature, 'hex')
  const providedBuffer = Buffer.from(providedSignature, 'hex')

  // crypto.timingSafeEqual THROWS if the two buffers differ in length — compare lengths first so
  // a tampered/truncated/malformed signature header rejects cleanly instead of crashing the route.
  const isValid = expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer)

  if (!isValid) {
    console.error('[WhatsApp Webhook] Signature verification failed')
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[WhatsApp Webhook] Verified request had unparseable JSON body')
    return new NextResponse('Invalid payload', { status: 400 })
  }

  // Exact delivery-event payload shape wasn't in the fetched docs — log the raw payload rather
  // than guess at parsing a specific structure, matching this codebase's existing "log, don't
  // build a UI for it yet" pattern. No persistence — see Non-Goals.
  console.log('[WhatsApp Webhook] Received event:', JSON.stringify(payload))

  return NextResponse.json({ received: true }, { status: 200 })
}
```
**Do not add `export const runtime = 'edge'`** to this file — `crypto.timingSafeEqual`/
`createHmac` require the Node.js runtime. This Next.js version already defaults Route Handlers to
the Node.js runtime, so no explicit `runtime` export is strictly required, but it is called out
here because setting `edge` (e.g. by copying a snippet from elsewhere) would silently break this
route in a way that's easy to miss until a real webhook call fails in production.

The unit test config's `node` project already auto-discovers `src/**/*.test.ts`
(`vitest.config.mts:30`), so `src/app/api/webhooks/whatsapp/route.test.ts` is picked up with
**zero config changes**.

### Template parameter empty-string risk
The plan's spec for `{{4}}` (the due-date note) is "empty string when absent." This is unverified
against a real constraint: some WhatsApp Cloud API template implementations reject an empty-string
parameter value outright (a `132000`-class error), since template placeholders generally expect
non-empty text. Because this can't be re-verified without live credentials, this design uses a
single space `' '` instead of `''` as the placeholder when `dueDate` is absent — a low-cost,
low-risk hedge. If Meta's API rejects even that in practice, the failure is not a crash: it
resolves to the same well-tested `{success: false, reason: 'api_error', status, data}` path every
other API rejection already takes. Confirm the real behavior once live credentials exist (see Open
Questions).

### API Changes
No REST/Route-Handler API surface existed for notifications before this phase, and this phase adds
exactly one: the webhook endpoint above. No existing Server Action's exported parameter shape
changes in a way that breaks a caller — `createOrder`/`updateOrderStatus`/`deleteOrder` keep their
existing signatures and `ActionResult<T>` return types untouched; only their *internal* calls to
`notifyOrderStatusChange`/`notifyLowStock` gain new fields.

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/webhooks/whatsapp` | `GET` | None (verify-token query param check) | Meta's one-time webhook URL verification handshake. |
| `/api/webhooks/whatsapp` | `POST` | None (HMAC-SHA256 signature header check) | Meta's ongoing delivery-event notifications. |

### Database Changes
**None.** No new tables, columns, or indexes. This phase intentionally does not touch
`prisma/schema.prisma` — `User.phone` remains an unconstrained nullable string, and normalization
happens entirely in application code at send time (`phone.ts`), never by mutating stored rows.

### Domain & Service Layer
Covered in full above (`src/lib/phone.ts`, `src/lib/notifications/{whatsapp,sms,index}.ts`). No
new Prisma models or query patterns are introduced.

### Frontend Changes
**None.** No new pages, components, or client-side data-fetching hooks. This is a pure
backend/integration phase — the admin's existing order-status `<select>` and order-creation form
already trigger the two Server Actions this phase modifies internally; nothing about their
client-side call sites changes.

## Env Var Table
| Variable | Required for real sends | Default if unset | Read by |
|---|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Yes | — (no-op) | `whatsapp.ts` |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | — (no-op) | `whatsapp.ts` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | No (not read by any sender; documented for completeness / future use) | — | — |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Yes, for the GET handshake | — (fails closed) | `route.ts` |
| `WHATSAPP_APP_SECRET` | Yes, for the POST signature check | — (fails closed) | `route.ts` |
| `WHATSAPP_TEMPLATE_NAME` | No | `'order_status_update'` | `whatsapp.ts` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | No | `'en_US'` | `whatsapp.ts` |
| `WHATSAPP_LOW_STOCK_TEMPLATE_NAME` | No | `'low_stock_alert'` | `whatsapp.ts` |
| `WHATSAPP_API_VERSION` | No | `'v24.0'` (see "Graph API version" below — NOT the plan's originally-pinned `v22.0`) | `whatsapp.ts` — env-overridable so a future Graph API version bump needs no code change. |
| `ARKESEL_API_KEY` | Yes | — (no-op) | `sms.ts` |
| `ARKESEL_SENDER_ID` | Yes | — (no-op) | `sms.ts` |
| `ADMIN_ALERT_PHONE` | No (falls back silently, same pattern as `ADMIN_ALERT_EMAIL`) | `undefined` | `actions.ts` → `notifyLowStock` |

## Alternatives Considered

**1. A single generic template reused for both order-status and low-stock alerts.** Rejected — see
"The low-stock template gap" above. WhatsApp templates carry fixed, Meta-approved body text; the
parameter *count* matching is not sufficient, the *semantics* have to match too, or the approved
copy reads as nonsense to whoever receives it.

**2. Parallelizing SMS and WhatsApp sends with `Promise.all` for lower latency.** Considered and
rejected as unnecessary complexity for this phase: both calls already run inside a
`.catch(console.error)`-wrapped fire-and-forget block that is never awaited by the code that
triggered it (`actions.ts`'s two call sites), so neither channel's latency is ever on the critical
path of the admin-facing response. Sequential awaits keep the code simpler to read and test and
match the file's existing style (email is already sequential ahead of them).

**3. Guessing Arkesel's response shape from typical SMS-gateway conventions (e.g. asserting
`body.code === 'ok'`) instead of gating purely on HTTP status.** Rejected — with zero live
credentials to confirm the real shape, hard-coding a guessed field name risks silently treating a
genuine failure as a success (or vice versa) the moment real credentials are added, in a way that
would only surface once real customers are affected. Gating on `response.ok` (the HTTP status
code) is the one signal guaranteed to exist and mean what it says, regardless of the JSON body's
actual shape.

**4. Skipping the second `low_stock_alert` template and simply not building
`sendLowStockWhatsApp` in this phase.** A real option, and arguably the more conservative one,
since it removes prerequisite #4 entirely. Not chosen as the default recommendation because the
original plan explicitly listed this export and the PRD's goal is admin-facing low-stock parity
across channels — but this is flagged as a genuinely open, low-cost-to-reverse decision (see PRD
Open Questions): if the business owner doesn't want to submit a second template, the function can
simply be left unconfigured with zero code change, since it already no-ops safely either way.

## Edge Cases & Failure Modes
- **No credentials configured (the default, local-dev state).** Every sender returns
  `{success: false, reason: '..._not_configured'}` and logs to console; no network call is ever
  attempted. This is the primary, best-tested path in this phase, not a fallback.
- **Phone number present but fails Ghana E.164 normalization.** `toGhanaE164` returns `null`; both
  `sendOrderStatusSms`/`sendOrderStatusWhatsApp` (and their low-stock equivalents) no-op with
  `{success: false, reason: 'invalid_phone'}` per channel, independently — one channel failing
  normalization does not affect the other, since each calls `toGhanaE164` itself.
- **Seeded/local fixture data uses Nigerian-format (`+234`) phone numbers.** `prisma/seed.ts`'s
  fixture customers use `+234` numbers; `toGhanaE164` deliberately rejects non-`233`/`0`-prefixed
  numbers rather than guessing. **Every seeded customer's SMS/WhatsApp send will no-op with
  `reason: 'invalid_phone'`** when testing locally against seed data — this is expected,
  by-design behavior, not a bug, and worth knowing before manually verifying this feature locally.
- **Not-yet-approved WhatsApp template.** Meta returns a non-2xx response; caught by the existing
  `if (!response.ok)` branch, resolves to `{success: false, reason: 'api_error', status, data}`,
  never a thrown exception.
- **Expired/temporary Meta access token.** Same handling as an unapproved template — a non-2xx
  Graph API response, resolved as `api_error`, not a crash. There is no proactive expiry warning
  in this phase (out of scope) — a token silently expiring could go unnoticed for a while since
  failures are logged, not surfaced anywhere an admin would see them.
- **Arkesel API down, rate-limited, or returning an unexpected shape.** The `try/catch` around
  `fetch` catches thrown network errors; the `response.ok` check catches non-2xx responses; the
  `.catch(() => null)` on `.json()` catches an unparseable body. All three converge on the same
  `{success: false, ...}` return shape — never a thrown exception reaching `index.ts`.
- **Tampered `X-Hub-Signature-256` header on the webhook POST.** Rejected with `401` before the
  body is ever parsed as JSON — see the POST algorithm's ordering above.
- **Truncated or non-hex signature header.** `Buffer.from(providedSignature, 'hex')` may silently
  stop at the first invalid character, producing a short/empty buffer; the explicit length check
  before `crypto.timingSafeEqual` catches this and rejects with `401` instead of throwing an
  uncaught `RangeError` that would otherwise crash the route with a raw 500.
- **`WHATSAPP_APP_SECRET`/`WHATSAPP_WEBHOOK_VERIFY_TOKEN` unset in production (a real
  misconfiguration risk, not just a local-dev default).** Both fail closed — the GET handshake and
  every POST are rejected outright rather than silently accepting unverified requests. This means
  a misconfigured deploy is loud (Meta's dashboard shows a failed verification / all webhook
  deliveries 401ing) rather than silently insecure.
- **A future reviewer "fixing" the webhook route by adding `requireAdmin()`.** Explicitly called
  out in the code and here: this route is unauthenticated by design (Meta calls it, not a
  logged-in admin); the signature check is the intended and only gate.
- **Replay of a previously-valid, captured signature+body pair.** Not defended against in this
  phase — Meta's basic webhook contract as fetched does not specify a timestamp/nonce scheme to
  check against, and this phase does not invent one. Accepted as a residual risk consistent with
  "no persistence, no admin UI for this data" — see Security Considerations and Risks.
- **`ADMIN_ALERT_PHONE` unset (today's default).** `notifyLowStock`'s `if (data.adminPhone)` guard
  simply skips SMS/WhatsApp for the low-stock alert, identical to how `adminEmail` already behaves
  when `ADMIN_ALERT_EMAIL` is unset — no crash, no dead branch reached.

## Security Considerations
- **The webhook route is intentionally unauthenticated** — `requireAdmin()`/`getCurrentDbUser()`
  from `src/lib/auth.ts` must not be applied here, since Meta (not a logged-in admin) is the
  caller. The HMAC-SHA256 signature check against `WHATSAPP_APP_SECRET` is the entire security
  boundary for the POST path; the GET path's boundary is the `hub.verify_token` match.
- **Fail-closed on missing secrets, on both GET and POST.** An unset `WHATSAPP_APP_SECRET` or
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` rejects every request rather than silently skipping
  verification — a deliberate choice to make a misconfigured deployment loudly broken (easy to
  notice and fix) rather than quietly insecure (easy to miss).
- **Timing-safe comparison.** `crypto.timingSafeEqual` (not `===` or a naive string comparison) is
  used for the signature check specifically to avoid a timing side-channel that could otherwise
  leak information about the correct signature byte-by-byte.
- **No secrets logged.** `WHATSAPP_ACCESS_TOKEN`, `ARKESEL_API_KEY`, and `WHATSAPP_APP_SECRET` are
  read directly from `process.env` at call time and never included in any `console.log`/
  `console.error` call in this design — only request/response *bodies* (which do not contain these
  secrets) and status codes are logged.
- **No new PII exposure.** `User.phone` was already stored and already unconstrained; this phase
  reads it (to send a message) but does not add any new read/write path to it, and does not
  persist any new data derived from it (normalized phone numbers are computed at send time, never
  written back to the database).
- **No rate limiting on the webhook endpoint.** Out of scope for this phase. A flood of POSTs to
  this route would each independently pay the cost of one HMAC computation before being rejected
  or accepted — cheap per-request, but there is no request-volume ceiling. Not a realistic near-term
  concern for a single-business app with a low real message volume, but worth naming rather than
  silently assuming away.
- **No replay protection on the webhook POST**, as noted in Edge Cases — accepted as a residual
  risk consistent with this phase's "log only, no persistence, no admin UI" scope. A captured
  valid signature+body pair could in principle be replayed; since nothing is persisted or acted on
  beyond a log line, the practical impact of a replay today is limited to noisy server logs, not a
  data-integrity or authorization bypass.

## Testing Strategy
**Reflects the (D) split from the dispatch brief — this is a specification correction from the
original plan's testing section, called out here so it isn't mistaken for scope creep.** The
plan's testing item #3 ("extend the existing order-action integration tests to assert WhatsApp is
part of the notification fan-out") is not achievable as written: all 6 integration test files that
exercise `createOrder`/`updateOrderStatus`
(`orders-actions.integration.test.ts`, `order-lifecycle.integration.test.ts`,
`menu-order-actions.integration.test.ts`, `concurrency.integration.test.ts`,
`validation-errors.integration.test.ts`, `insufficient-stock.integration.test.ts`) mock the
**entire** `@/lib/notifications` module (`vi.mock('@/lib/notifications', () => ({
notifyOrderStatusChange: vi.fn()..., notifyLowStock: vi.fn()... }))`), so none of them can ever
observe what happens *inside* `index.ts` — there is nothing to assert a WhatsApp call against.

**Unit tests (pure logic, no real database, no real network — new files):**
- **`src/lib/phone.test.ts`**: local `0XXXXXXXXX` → `233XXXXXXXXX`; already-international
  `+233XXXXXXXXX` → `233XXXXXXXXX` (leading `+` stripped); bare `233XXXXXXXXX` → unchanged;
  numbers with spaces/dashes (`024 123 4567`, `024-123-4567`) → correctly stripped and
  normalized; too-short/garbage input → `null`; **a non-Ghana country code (e.g. `+234...`,
  matching this repo's own seed data) → `null`**, not a mis-normalized Ghana number; `null`/
  `undefined`/empty-string input → `null`.
- **`src/lib/notifications/whatsapp.test.ts`** (mocking `global.fetch`): unconfigured env → no-op,
  `fetch` never called; configured + invalid phone → no-op, `fetch` never called; configured +
  valid phone + mocked 200 response → `{success: true, data}`, and assert the exact request body
  shape (recipient `to`, template `name`/`language`, and all 4 `parameters` in the `{{1}}`–`{{4}}`
  order specified above); mocked non-2xx response → `{success: false, reason: 'api_error', status,
  data}`; `fetch` throwing (simulated network failure) → caught, `{success: false, error}`, no
  exception escapes. Repeat the configured/unconfigured/invalid-phone/success/failure matrix for
  `sendLowStockWhatsApp`, additionally asserting it targets the `WHATSAPP_LOW_STOCK_TEMPLATE_NAME`
  template, distinct from `sendOrderStatusWhatsApp`'s.
- **`src/lib/notifications/sms.test.ts`** (mocking `global.fetch`): the same
  configured/unconfigured/invalid-phone/success/failure matrix as above for `sendSms`; assert
  `sendOrderStatusSms`'s message body includes `#${orderShortId}`; confirm both existing callers'
  behavior (`sendOrderStatusSms`, `sendLowStockSms`) is otherwise unchanged in shape.
- **`src/lib/notifications/index.test.ts`** (new — mocking `./email`, `./sms`, `./whatsapp` as
  three independent modules, **not** mocking the whole `notifications` barrel from outside): this
  is the file that actually proves the fan-out control flow, and is the correct home for the
  assertion the plan's testing item #3 was really after.
  - `notifyOrderStatusChange` with both `customerEmail` and `customerPhone` present → all three of
    `sendOrderStatusEmail`/`sendOrderStatusSms`/`sendOrderStatusWhatsApp` are called exactly once,
    with `orderShortId` correctly forwarded to both SMS and WhatsApp.
  - `customerPhone` absent → `sendOrderStatusSms`/`sendOrderStatusWhatsApp` are **not** called;
    email is still attempted if `customerEmail` is present.
  - `customerEmail` absent → `sendOrderStatusEmail` is **not** called; SMS/WhatsApp still attempted
    if `customerPhone` is present.
  - Same three-case matrix repeated for `notifyLowStock` against `adminEmail`/`adminPhone`.
- **Route tests, `src/app/api/webhooks/whatsapp/route.test.ts`** (new — no existing route-handler
  test precedent in this repo; this establishes the pattern via direct `Request` construction
  against the exported `GET`/`POST` functions, picked up automatically by the `node` project's
  `src/**/*.test.ts` include glob with zero config changes):
  - `GET` with correct `hub.mode=subscribe` + matching `hub.verify_token` + a `hub.challenge` →
    `200`, body is the raw challenge string (assert `Content-Type` is plain text / assert exact
    body equality, not JSON-parsed).
  - `GET` with a wrong `hub.verify_token` → `403`.
  - `GET` with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` unset → `403` (fail-closed case).
  - `POST` with a validly-computed `X-Hub-Signature-256` over the exact request body → `200`,
    `{received: true}`.
  - `POST` with a tampered signature (valid hex, wrong value) → `401`.
  - `POST` with a missing signature header entirely → `401`.
  - `POST` with a malformed/non-hex/wrong-length signature header → `401`, and explicitly assert
    the call does **not** throw — this is the regression test for the `timingSafeEqual`
    length-mismatch crash risk.
  - `POST` with `WHATSAPP_APP_SECRET` unset → `503` (fail-closed case), and assert the body was
    never parsed/logged.

**Integration tests (existing files, targeted additions — not a rewrite):** integration tests
**can only assert the call-site contract**, i.e. what `actions.ts` now passes into the still-fully-
mocked `notifications` module — this is genuinely observable through the existing
`vi.mock('@/lib/notifications', ...)` setup and is the actual behavior change this phase makes in
`actions.ts`:
- In **`menu-order-actions.integration.test.ts`** (already exercises `createOrder`): extend the
  existing assertion on the mocked `notifyOrderStatusChange` call to include
  `orderShortId: expect.any(Number)` matching the created order's `shortId`. Add a new assertion
  (set `process.env.ADMIN_ALERT_PHONE` before the test, restore it after) that `notifyLowStock` is
  called with `adminPhone` equal to that value when a low-stock threshold is crossed.
- In **`order-lifecycle.integration.test.ts`** (already exercises `updateOrderStatus`): extend the
  existing assertion on the mocked `notifyOrderStatusChange` call to include `orderShortId:
  expect.any(Number)` matching the updated order's `shortId`.
- The remaining four integration files that mock the notifications module
  (`orders-actions.integration.test.ts`, `concurrency.integration.test.ts`,
  `validation-errors.integration.test.ts`, `insufficient-stock.integration.test.ts`) need **no
  changes** — none of them currently assert on `notifyOrderStatusChange`'s call arguments in a way
  this phase invalidates, and duplicating the same `orderShortId` assertion across all six files
  would be redundant coverage, not additional confidence.

**Manual QA (documented, not automated, once external prerequisites are satisfied):**
- Confirm the `GET` verification handshake succeeds from Meta's own webhook-configuration UI
  against a real deployed URL (cannot be simulated locally against Meta's actual verification
  flow).
- Confirm one full real order lifecycle (`PENDING` → `COMPLETED`) against a real test phone number
  produces a received WhatsApp message and a received SMS, per the PRD's success metric.
- Confirm the real Arkesel response shape once credentials exist, and adjust the (currently
  status-code-only) success/failure mapping in `sms.ts` if a more specific mapping becomes
  possible — without changing `sendSms`'s external `{success, ...}` contract.

## Rollout Plan
- **No feature flag.** Every send is already independently env-gated to a safe no-op — there is no
  meaningful "off" state to additionally flag beyond simply not setting the credentials, which is
  also today's default state in every environment.
- **No data migration.** No schema changes (see Database Changes).
- **Staged external rollout, decoupled from the code deploy:** the code can ship and no-op safely
  with zero external prerequisites satisfied. Real sends activate incrementally and independently
  as each of the four external prerequisites (permanent token, `order_status_update` template
  approval, Arkesel sender ID, optionally `low_stock_alert` template approval) is completed by the
  business owner — there is no single "flip the switch" moment, and no code change is needed
  between "no credentials" and "fully configured."
- **Pre-deploy check:** run the full unit + integration suite (`npm test && npm run
  test:integration`) plus `npm run lint && npm run build` against the baseline numbers recorded in
  Context & Motivation; any new failures are attributable to this phase.
- **Rollback plan:** plain code revert. No schema or data changes mean no compensating cleanup is
  needed. Because every sender is independently env-gated, an emergency rollback of the *external*
  integration (e.g. Meta suspends the WhatsApp Business Account) can also be done by simply
  unsetting `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` in the deployed environment, without
  a code deploy at all — the app immediately falls back to logging no-ops on that channel while
  SMS and email continue unaffected.
- **Post-deploy verification:** the manual QA checklist above, run once each external prerequisite
  is satisfied — this phase's rollout is only "complete" per the PRD's success metrics once the
  real-device smoke test passes, not merely once the code merges.

## Risks
- **RESOLVED / SUPERSEDED (2026-08-18): the account is on the LEGACY V1 API, not v2.** This risk
  originally read that the Arkesel response shape "cannot be pinned down authoritatively," because
  two incompatible candidate shapes circulate publicly and no credentials existed. That is now
  settled. The business owner supplied their actual account's API reference and it is the **v1
  query-string API** — so the `{"code": "ok", ...}` shape found during research is not a
  "wrong-generation" hazard at all; it is precisely what this account uses. The v2 design
  (`POST /api/v2/sms/send`, `api-key` header, `recipients` array) has been removed from this
  document; see the corrected `sms.ts` design above.
  **Verified live** with the real key via a read-only balance check (no SMS sent):
  `GET /sms/api?action=check-balance&api_key=…&response=json` → HTTP 200, `application/json`,
  `{"balance":523,"user":"Faazele Ishola","country":"Ghana"}`.
  The residual risk is now narrower but real: **that verified balance response contains no `code`
  field**, proving the v1 envelope varies per action, so `code` must never be treated as
  guaranteed. And unlike v2, a v1 query-string API can return HTTP 200 on a logical failure, so
  the HTTP status alone is not a sufficient gate either. The mapping therefore fails on non-2xx,
  fails on a `code` that is present but not `"ok"`, and accepts a 200 with no recognizable `code`
  rather than throwing. The `send-sms` success body specifically is still only *reported*
  (`{code:"ok", message:"Successfully Send", balance, user}`) rather than observed — confirming it
  needs a real send, which is deliberately not automated (it costs credits and reaches a real
  phone). The enrichment logic can be sharpened later without any caller of
  `sendSms`/`sendOrderStatusSms`/`sendLowStockSms` changing, since none depend on anything beyond
  the top-level `{success, ...}` shape.
- **RESOLVED: sender ID registration is not a blocker.** `ARKESEL_SENDER_ID="Rostty"` is set, and
  the business owner confirms sender IDs auto-register on the fly on this account — no
  pre-approval step, so a `403`-style unregistered-sender failure is not an expected mode here.
- **Template-approval is an asynchronous, external dependency that cannot be built around.** Real
  WhatsApp sends will uniformly fail (safely, as a logged `{success: false, reason: 'api_error'}`,
  never a crash) until Meta approves `order_status_update` — and, if the business owner wants
  low-stock alerts on WhatsApp too, a second `low_stock_alert` template. This phase's code is fully
  testable and correct independent of that approval status, but the PRD's real-device smoke-test
  success metric cannot be satisfied until it lands.
- **A temporary (24-hour) Meta access token would cause a silent regression after the code ships
  correctly.** If the token currently held is temporary rather than a permanent System User token,
  real WhatsApp sends will work at first and then start failing exactly 24 hours later, with no
  proactive warning surfaced anywhere (out of scope for this phase). This is a genuine, real risk
  to flag prominently rather than assume resolved.
- **The webhook route has no replay protection and no rate limiting**, both accepted as residual
  risks scoped-out for this phase (see Security Considerations) — reasonable for a single-business
  app's current real-world traffic volume, but a real gap if this endpoint's exposure or traffic
  ever changes materially.
- **The `{{4}}` empty-parameter mitigation (a space instead of an empty string) is itself an
  unverified guess**, made because the underlying Cloud API behavior for empty template parameters
  couldn't be re-confirmed for this design. If wrong, the failure mode is identical to any other
  API rejection — safe, logged, non-crashing — so the risk is limited to "this specific due-date-
  absent case doesn't send," not a broader failure.

## Open Questions

> **Updated 2026-08-18 by the pipeline orchestrator.** Real credentials arrived mid-run, so most of
> the questions below were closed by direct read-only verification against the live APIs rather
> than being left to the reader. Resolutions are recorded inline.

- ~~**Confirm the Meta access token's type**~~ — **RESOLVED: it is a permanent System User token.**
  `GET /debug_token` returns `"type": "SYSTEM_USER"`, `"expires_at": 0` (never expires),
  `"is_valid": true`, for app "Chop with Rostty", with scopes including both
  `whatsapp_business_messaging` and `whatsapp_business_management`. There is no 24-hour expiry
  cliff. Also confirmed live: the sending number is `+233 20 048 0505` ("Chop With Rostty",
  `platform_type: CLOUD_API`).
- ~~**Confirm which Arkesel sender ID is available/approved**~~ — **RESOLVED:**
  `ARKESEL_SENDER_ID="Rostty"`, and the business owner confirms sender IDs auto-register on the fly
  on this account. No pre-approval step, no blocker.
- ~~**Does the business owner want low-stock alerts on WhatsApp?**~~ — **RESOLVED: yes.** Both
  `order_status_update` and `low_stock_alert` have been submitted to Meta for review, and
  `WHATSAPP_LOW_STOCK_TEMPLATE_NAME` is set in `.env`. `sendLowStockWhatsApp` ships as designed.
- **PARTIALLY RESOLVED — the Arkesel API generation is now settled, the send-response body is not.**
  The account is confirmed to be on the **legacy v1 query-string API** (not v2), verified live by a
  read-only balance check returning `{"balance":523,"user":"Faazele Ishola","country":"Ghana"}`.
  What remains genuinely open is only the exact **`send-sms` response body**, which is reported as
  `{code:"ok", …}` but has not been *observed* — confirming it requires an actual send, which costs
  credits and reaches a real phone, so it is deliberately not automated. The mapping is defensive
  enough that this is not blocking (see Risks).
- **STILL OPEN — `order_status_update` / `low_stock_alert` approval status with Meta.** Submitted,
  but approval is asynchronous and could not be checked programmatically from here:
  `WHATSAPP_BUSINESS_ACCOUNT_ID` is empty in `.env`, and the WABA id cannot be discovered with this
  token (`/me/businesses` → `(#100) Missing Permission`, since the token carries
  `whatsapp_business_management` but not `business_management`). Template status lives on the WABA
  node, so it is unreachable until that id is filled in. **Note this blocks status *checking*, not
  sending** — sends need only `WHATSAPP_PHONE_NUMBER_ID`. Until approval lands, real sends fail
  safely as `{success:false}`.
- **STILL OPEN — `ADMIN_ALERT_PHONE` is empty.** The low-stock SMS/WhatsApp path is implemented and
  tested, but stays dormant until the business owner sets a destination number.
- **Whether Meta's Cloud API actually rejects empty-string template parameters** — genuinely open
  (see Risks); this design ships a defensive mitigation (`' '` instead of `''`) rather than leaving
  the question unresolved in code, but the underlying behavior should be confirmed once real sends
  are possible.
- **Not open / resolved during this design, stated here for the record:** whether `orderShortId`
  should be required or optional on `notifyOrderStatusChange` (resolved: required — both call
  sites always have it), and whether SMS copy should change to include `shortId` (resolved: yes,
  additively, keeping the existing description text) — see "The `orderShortId` gap" above for the
  full reasoning on both.
