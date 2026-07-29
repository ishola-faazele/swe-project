/**
 * Unified Notification Service
 * 
 * Calls the appropriate notification channel(s) based on the customer's contact info.
 * Currently: Email is active, SMS is a stub.
 */

import { sendOrderStatusEmail, sendLowStockAlert, type OrderStatusEmailData } from './email'
import { sendOrderStatusSms, sendLowStockSms } from './sms'

export async function notifyOrderStatusChange(data: {
  customerEmail?: string | null
  customerPhone?: string | null
  customerName?: string
  orderId: string
  orderDescription: string
  newStatus: string
  dueDate?: string | null
}) {
  const results: { email?: Awaited<ReturnType<typeof sendOrderStatusEmail>>, sms?: Awaited<ReturnType<typeof sendOrderStatusSms>> } = {}

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

  // Send SMS if customer has a phone (currently a stub)
  if (data.customerPhone) {
    results.sms = await sendOrderStatusSms(data.customerPhone, data.orderDescription, data.newStatus)
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
  const results: { email?: Awaited<ReturnType<typeof sendLowStockAlert>>, sms?: Awaited<ReturnType<typeof sendLowStockSms>> } = {}

  if (data.adminEmail) {
    results.email = await sendLowStockAlert(data.itemName, data.currentStock, data.unit, data.adminEmail)
  }

  if (data.adminPhone) {
    results.sms = await sendLowStockSms(data.adminPhone, data.itemName, data.currentStock, data.unit)
  }

  return results
}
