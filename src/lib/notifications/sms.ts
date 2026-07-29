/**
 * SMS Notification Service (STUB)
 * 
 * This module provides the interface for sending SMS notifications.
 * Currently, it logs to the console and does NOT actually send SMS.
 * 
 * When you're ready to activate SMS, just:
 * 1. Install your SMS provider SDK (e.g., `npm i twilio`)
 * 2. Add your provider credentials to .env
 * 3. Replace the stub implementations below with real API calls
 */

export type SmsData = {
  to: string           // phone number in E.164 format, e.g., +2348012345678
  message: string
}

export async function sendSms(data: SmsData) {
  // STUB: Replace this with your actual SMS provider (Twilio, MessageBird, Africa's Talking, etc.)
  console.log('[SMS STUB] Would send SMS to:', data.to)
  console.log('[SMS STUB] Message:', data.message)

  // Example Twilio implementation (uncomment when ready):
  // const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  // const result = await twilio.messages.create({
  //   body: data.message,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: data.to,
  // })
  // return { success: true, sid: result.sid }

  return { success: false, reason: 'sms_not_configured' }
}

export async function sendOrderStatusSms(phone: string, orderDescription: string, newStatus: string) {
  const statusMessages: Record<string, string> = {
    PENDING: `Your order "${orderDescription}" has been received.`,
    PREPPING: `Good news! We started prepping your order "${orderDescription}".`,
    COOKING: `Your order "${orderDescription}" is now being cooked!`,
    READY: `Your order "${orderDescription}" is READY for pickup/delivery!`,
    COMPLETED: `Your order "${orderDescription}" is completed. Thank you!`,
    CANCELLED: `Your order "${orderDescription}" has been cancelled. Contact us for details.`,
  }

  const message = statusMessages[newStatus] || `Order "${orderDescription}" status: ${newStatus}`
  return sendSms({ to: phone, message })
}

export async function sendLowStockSms(phone: string, itemName: string, currentStock: number, unit: string) {
  return sendSms({
    to: phone,
    message: `⚠️ Low Stock: ${itemName} is at ${currentStock} ${unit}. Please restock soon.`
  })
}
