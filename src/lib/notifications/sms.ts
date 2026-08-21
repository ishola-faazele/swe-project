/**
 * SMS Notification Service — Arkesel (legacy v1 query-string API).
 *
 * ⚠ This account is on Arkesel's **v1** API, not v2. That means: every call is a GET, every
 * parameter travels in the query string, `api_key` is a query parameter (NOT an `api-key`
 * header), `to` takes a single number (NOT a `recipients` array), the sender goes in `from`, and
 * the message text goes in `sms`. Confirmed live against the real key with a read-only balance
 * check: GET /sms/api?action=check-balance&api_key=… → HTTP 200, application/json,
 * {"balance":523,"user":"…","country":"Ghana"}.
 *
 * send-sms's real response is ALSO now confirmed live (2026-08-19, one real SMS, explicit user
 * authorization) — with `&response=json` set: HTTP 200, application/json,
 * {"code":"ok","message":"Successfully Sent","balance":522,"main_balance":0.13,"user":"…"}.
 * Matches the success-mapping logic below exactly; no code change needed. Confirms the
 * `response=json` fix actually works (clean JSON, not the plain-text-default risk it hedged
 * against) and that the success shape uses `code:"ok"`, not v1's other documented candidate
 * shapes — the response/failure-code mapping stays defensive regardless, since a failed send was
 * never deliberately triggered to observe its shape.
 *
 * "Enabled" comes from the database (admin-managed at /admin/settings); "configured" (the actual
 * API key/sender ID) comes from .env, same as it always has — see src/lib/settings.ts's header
 * for why credentials never moved into the database. Like email.ts and whatsapp.ts, this module
 * never throws: gated no-op when disabled or unconfigured, try/catch around the network call.
 * Both call sites invoke it fire-and-forget, so a rejection here would surface as an unhandled
 * rejection rather than anything a caller could act on.
 *
 * ⚠ The no-op branches deliberately log only that a send was skipped — NEVER the message body.
 * sendSms is a generic entry point, and one of its callers is now the phone-login OTP flow, so
 * `data.message` can contain a live, unexpired login code. The unconfigured branch is a genuinely
 * expected deployed state (immediately after this ships, before the admin enters credentials at
 * /admin/settings), which would otherwise print usable login codes straight to the server log.
 * Order-status and low-stock copy isn't sensitive enough to be worth re-litigating this per
 * message type — just never log the body here.
 */
import { toGhanaE164 } from '@/lib/phone'
import { getNotificationSettings } from '@/lib/settings'

const ARKESEL_SMS_ENDPOINT = 'https://sms.arkesel.com/sms/api'

export type SmsData = {
  to: string           // any Ghanaian format — normalized to bare E.164 below
  message: string
}

export async function sendSms(data: SmsData) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`\n[SMS] DEV MODE: Sending SMS to ${data.to}`)
    console.log(`[SMS] DEV MODE: Body: "${data.message}"\n`)
    return { success: true, reason: 'dev_mode_console' }
  }

  // "enabled" (database) and "configured" (env) are two INDEPENDENT checks with distinct no-op
  // reasons: a channel can hold valid credentials but be deliberately switched off, or be
  // switched on before any credentials have been entered in .env.
  const settings = await getNotificationSettings()
  if (!settings.smsEnabled) {
    console.log('[SMS] Skipping send — SMS channel is disabled in Settings')
    return { success: false, reason: 'sms_disabled' }
  }

  const apiKey = process.env.ARKESEL_API_KEY
  const senderId = process.env.ARKESEL_SENDER_ID
  if (!apiKey || !senderId) {
    console.log('[SMS] Skipping send — ARKESEL_API_KEY/ARKESEL_SENDER_ID not set in .env')
    return { success: false, reason: 'sms_not_configured' }
  }

  const to = toGhanaE164(data.to)
  if (!to) {
    console.log('[SMS] Skipping send — could not normalize phone number:', data.to)
    return { success: false, reason: 'invalid_phone' }
  }

  try {
    const url = new URL(ARKESEL_SMS_ENDPOINT)
    url.searchParams.set('action', 'send-sms')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('to', to)
    url.searchParams.set('from', senderId)
    // searchParams handles the escaping — the message routinely contains spaces, quotes and '#',
    // all of which would corrupt the query string if concatenated raw.
    url.searchParams.set('sms', data.message)
    // Matches the verified check-balance call, which returned clean JSON only because it passed
    // this param. Without it, send-sms's default response format is unconfirmed — if it's
    // plain text, response.json() below would reject and a real logical failure returned as
    // HTTP 200 would silently fall through to the "unknown-but-successful" branch.
    url.searchParams.set('response', 'json')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    let response: Response
    try {
      response = await fetch(url, { method: 'GET', signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
    
    const body = await response.json().catch(() => null)

    // Success mapping checks BOTH signals and REQUIRES NEITHER field, deliberately:
    //   - The verified balance response above carries no `code` field at all, proving the v1
    //     envelope varies per action — so `code` can never be treated as guaranteed.
    //   - A query-string API like this can return HTTP 200 on a logical failure — so the HTTP
    //     status alone is not sufficient either.
    // Hence: fail on non-2xx; fail on a `code` that is present but not "ok"; accept a 200 with no
    // recognizable `code` rather than throwing.
    if (!response.ok) {
      console.error('[SMS] Arkesel send failed (HTTP):', response.status, body)
      return { success: false, reason: 'api_error', status: response.status, data: body }
    }

    // Confirmed live (see file header): success body is {code:"ok", message:"Successfully Sent",
    // balance, main_balance, user}. Failure codes are still unverified — numeric-STRING failure
    // codes (e.g. "102" = Authentication Failed) are documented but never observed live.
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
  // Every message leads with the order's human-facing shortId, never the internal UUID — per
  // AGENTS.md, and so this channel describes an order the same way WhatsApp now does.
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
    message: `⚠️ Low Stock: ${itemName} is at ${currentStock} ${unit}. Please restock soon.`
  })
}
