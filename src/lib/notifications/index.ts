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

import { sendOrderStatusEmail, sendLowStockAlert, type OrderStatusEmailData } from './email'
import { sendOrderStatusSms, sendLowStockSms } from './sms'
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
  // Awaited sequentially rather than via Promise.all, matching this file's existing style: both
  // call sites in actions.ts are fire-and-forget, so neither channel's latency is ever on the
  // admin UI's critical path.
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

  // Same "send both, always" shape as the customer path above, gated on the admin's own phone.
  if (data.adminPhone) {
    results.sms = await sendLowStockSms(data.adminPhone, data.itemName, data.currentStock, data.unit)
    results.whatsapp = await sendLowStockWhatsApp(data.adminPhone, data.itemName, data.currentStock, data.unit)
  }

  return results
}
