/**
 * Unified Notification Service
 *
 * Calls the appropriate notification channel(s) based on the customer's contact info.
 * All three channels — email, SMS (Arkesel), WhatsApp (Meta Cloud API) — are live, and each is
 * independently env-gated to a safe no-op when its own credentials are absent.
 *
 * "Send both, every time" is a locked product decision: there is NO primary/fallback branching
 * between SMS and WhatsApp. Each is attempted independently whenever the contact method exists,
 * exactly mirroring how email is attempted independently whenever an email address exists.
 */

import { sendOrderStatusEmail, sendLowStockAlert, sendAccountCreatedEmail, type OrderStatusEmailData } from './email'
import { sendOrderStatusSms, sendLowStockSms, sendSms } from './sms'
import { sendOrderStatusWhatsApp, sendLowStockWhatsApp } from './whatsapp'

export async function notifyOrderStatusChange(data: {
  customerEmail?: string | null
  customerPhone?: string | null
  customerName?: string
  orderId: string
  // Required, not optional: Order.shortId is a non-null autoincrement column, so no persisted
  // order can lack one. It exists because customer-facing copy must never show the UUID.
  orderShortId: number
  orderDescription: string
  newStatus: string
  dueDate?: string | null
}) {
  const results: {
    email?: Awaited<ReturnType<typeof sendOrderStatusEmail>>
    sms?: Awaited<ReturnType<typeof sendOrderStatusSms>>
    whatsapp?: Awaited<ReturnType<typeof sendOrderStatusWhatsApp>>
  } = {}

  // Send email if customer has an email
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

  // Send SMS and WhatsApp if customer has a phone. Independent, unconditional siblings: neither
  // is gated on the other's outcome, only on this shared phone-presence guard. A phone that
  // exists but fails E.164 normalization is a separate, per-channel concern — each sender calls
  // toGhanaE164 itself and no-ops individually.
  // Promise.allSettled, not sequential awaits: both senders are contractually no-throw today, but
  // that was only a convention, not something the type system enforces. Settling both regardless
  // of either outcome makes the independence structural — a future edit that makes one sender
  // throw can no longer silently suppress the other.
  if (data.customerPhone) {
    const [smsResult, whatsappResult] = await Promise.allSettled([
      sendOrderStatusSms(data.customerPhone, data.orderShortId, data.orderDescription, data.newStatus),
      sendOrderStatusWhatsApp(data.customerPhone, data.customerName, data.orderShortId, data.newStatus, data.dueDate),
    ])
    results.sms = smsResult.status === 'fulfilled' ? smsResult.value : { success: false, error: smsResult.reason }
    results.whatsapp = whatsappResult.status === 'fulfilled' ? whatsappResult.value : { success: false, error: whatsappResult.reason }
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

  // Same "send both, always" shape as the customer path above, gated on the admin's own phone,
  // and the same Promise.allSettled independence — see notifyOrderStatusChange for why.
  if (data.adminPhone) {
    const [smsResult, whatsappResult] = await Promise.allSettled([
      sendLowStockSms(data.adminPhone, data.itemName, data.currentStock, data.unit),
      sendLowStockWhatsApp(data.adminPhone, data.itemName, data.currentStock, data.unit),
    ])
    results.sms = smsResult.status === 'fulfilled' ? smsResult.value : { success: false, error: smsResult.reason }
    results.whatsapp = whatsappResult.status === 'fulfilled' ? whatsappResult.value : { success: false, error: whatsappResult.reason }
  }

  return results
}

/**
 * The copy a phone-preferred new customer receives. Kept in one named place so the wording can be
 * revised without touching fan-out logic.
 *
 * Deliberately points at the real site URL rather than a vague "visit our login page" — the
 * recipient is a non-technical customer who has never used this app and has no other way to find
 * it. Deliberately does NOT carry a code: a code issued at creation time would very likely expire
 * before the customer got round to using it, and would then read as broken.
 */
function accountCreatedSmsMessage(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  return `Welcome to Chop with Rostty! Your account is ready. Visit ${siteUrl}/login and enter this phone number to get a login code.`
}

/**
 * Tells a brand-new customer how to get into their account.
 *
 * EMAIL + SMS ONLY — never WhatsApp, and this module deliberately imports nothing from './whatsapp'
 * for this path. WhatsApp requires a pre-approved Meta template for every business-initiated
 * message, and this notification is not going to wait behind a third template review. (The two
 * EXISTING WhatsApp templates, order_status_update and low_stock_alert, are unaffected and still
 * fire from notifyOrderStatusChange/notifyLowStock exactly as before.)
 *
 * The two branches are mutually exclusive and neither is a fallback for the other: each is gated
 * purely on preferredLoginMethod plus its own contact field being present. A PHONE-preferred
 * customer whose SMS fails does not then get an email, and vice versa.
 *
 * Consequence worth stating plainly: for a phone-preferred customer with no email, SMS is the ONLY
 * channel. If SMS is disabled or unconfigured they receive nothing at all — a clean, logged no-op
 * from sendSms, never an error, and never something that fails createCustomer.
 */
export async function notifyAccountCreated(data: {
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  preferredLoginMethod: 'EMAIL' | 'PHONE'
  magicLink?: string | null // only meaningful when preferredLoginMethod === 'EMAIL'
}) {
  const results: {
    email?: Awaited<ReturnType<typeof sendAccountCreatedEmail>>
    sms?: Awaited<ReturnType<typeof sendSms>>
  } = {}

  if (data.preferredLoginMethod === 'EMAIL' && data.customerEmail && data.magicLink) {
    results.email = await sendAccountCreatedEmail({
      to: data.customerEmail,
      name: data.customerName,
      magicLink: data.magicLink,
    })
  }

  if (data.preferredLoginMethod === 'PHONE' && data.customerPhone) {
    results.sms = await sendSms({
      to: data.customerPhone,
      message: accountCreatedSmsMessage(),
    })
  }

  // Neither branch fires for a name-only customer — a shape createCustomerSchema legitimately
  // allows. That resolves to {} cleanly rather than throwing.
  return results
}
