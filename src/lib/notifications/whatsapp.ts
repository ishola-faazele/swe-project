/**
 * WhatsApp Business Cloud API sender.
 *
 * Mirrors email.ts's shape exactly: lazy per-call config read (no client SDK, just `fetch`),
 * settings-gated no-op when disabled or unconfigured, try/catch around the network call — these
 * functions NEVER throw, because both call sites in src/app/admin/orders/actions.ts invoke them
 * fire-and-forget and a rejection here must never surface as an unhandled rejection or block an
 * order-status change.
 *
 * "Enabled" comes from the database (admin-managed at /admin/settings); everything else —
 * credentials, phone number ID, template names/language, API version — comes from .env, same as
 * it always has. See src/lib/settings.ts's header for why credentials never moved into the
 * database.
 *
 * The Cloud API only allows business-initiated messages through a Meta-approved template, so
 * every send here is a template message: the body text is fixed at approval time and only the
 * numbered parameters vary per call.
 */
import { toGhanaE164 } from '@/lib/phone'
import { getNotificationSettings } from '@/lib/settings'

// Env-overridable so a future Graph API version bump needs no code change. v24.0 (released
// 2025-10-08, sunsets 2028-02-18) is mature rather than bleeding-edge and gives ~18 months of
// runway; the template-message request shape is identical across every version in this range.
const DEFAULT_GRAPH_API_VERSION = 'v24.0'

// Deliberately still an ENV VAR, unlike every other WhatsApp setting in this file. The Graph API
// version is an infrastructure/API-surface concern, not a provider credential the business owner
// would ever rotate from the Settings UI — so it stays where a developer changes it at deploy time.
// Read lazily, per call, so it remains genuinely overridable rather than frozen at import time.
function graphUrl(phoneNumberId: string) {
  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_GRAPH_API_VERSION
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`
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
  // "enabled" (database) and "configured" (env) are two INDEPENDENT checks with distinct no-op
  // reasons — see the same pattern in sms.ts.
  const settings = await getNotificationSettings()
  if (!settings.whatsappEnabled) {
    console.log('[WhatsApp] Skipping send — WhatsApp channel is disabled in Settings')
    return { success: false, reason: 'whatsapp_disabled' }
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) {
    console.log('[WhatsApp] Skipping send — WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID not set in .env')
    return { success: false, reason: 'whatsapp_not_configured' }
  }

  const to = toGhanaE164(phone)
  if (!to) {
    console.log('[WhatsApp] Skipping send — could not normalize phone number:', phone)
    return { success: false, reason: 'invalid_phone' }
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'order_status_update'
  // 'en', not 'en_US' — this business's real templates are registered under plain "English" in
  // WhatsApp Manager, confirmed live (2026-08-19) after a 132001 "does not exist in en_US" error.
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'
  const statusLabel = statusLabels[newStatus] ?? newStatus
  // A single space, not an empty string: some Cloud API template implementations reject an
  // empty-string parameter value outright (a 132000-class error). A defensive hedge — if it is
  // rejected anyway, the failure resolves to the same logged api_error path as any other
  // rejection, never a crash.
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
      // Graph API's error envelope is {error: {message, type, code, fbtrace_id}} — logged whole
      // rather than destructured, since the shape varies by failure class. It never carries the
      // access token, so this is safe to log.
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
  const settings = await getNotificationSettings()
  if (!settings.whatsappEnabled) {
    console.log('[WhatsApp] Skipping low stock alert — WhatsApp channel is disabled in Settings')
    return { success: false, reason: 'whatsapp_disabled' }
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) {
    console.log('[WhatsApp] Skipping low stock alert — WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID not set in .env')
    return { success: false, reason: 'whatsapp_not_configured' }
  }

  const to = toGhanaE164(phone)
  if (!to) {
    console.log('[WhatsApp] Skipping low stock alert — could not normalize phone number:', phone)
    return { success: false, reason: 'invalid_phone' }
  }

  // Deliberately a SEPARATE, dedicated template from sendOrderStatusWhatsApp, and therefore a
  // separate env var — never WHATSAPP_TEMPLATE_NAME. A WhatsApp template's approved body text
  // cannot be swapped per-call — only its parameter values can — so order_status_update's fixed
  // "your order #{{2}} ... is now: {{3}}" wording cannot be reused to carry a stock alert without
  // rendering nonsense to whoever receives it.
  const templateName = process.env.WHATSAPP_LOW_STOCK_TEMPLATE_NAME || 'low_stock_alert'
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'

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
