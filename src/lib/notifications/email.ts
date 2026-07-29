import { Resend } from 'resend'

let _resend: Resend | null = null
function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY!)
  }
  return _resend
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'Chop with Rosty <onboarding@resend.dev>'

export type OrderStatusEmailData = {
  customerEmail: string
  customerName?: string
  orderId: string
  orderDescription: string
  newStatus: string
  dueDate?: string | null
}

export async function sendOrderStatusEmail(data: OrderStatusEmailData) {
  // If no API key is configured, log and skip
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] Skipping email send — RESEND_API_KEY not configured')
    console.log('[Email] Would have sent:', data)
    return { success: false, reason: 'no_api_key' }
  }

  const statusMessages: Record<string, string> = {
    PENDING: 'Your order has been received and is pending.',
    PREPPING: 'Great news! We\'ve started prepping your order.',
    COOKING: 'Your order is now being cooked! 🍳',
    READY: 'Your order is READY for pickup/delivery! 🎉',
    COMPLETED: 'Your order has been completed. Thank you for your business!',
    CANCELLED: 'Unfortunately, your order has been cancelled. Please contact us for details.',
  }

  const statusMessage = statusMessages[data.newStatus] || `Your order status has been updated to: ${data.newStatus}`

  try {
    const result = await getResend().emails.send({
      from: FROM_EMAIL,
      to: data.customerEmail,
      subject: `Order Update: ${data.newStatus} — ${data.orderDescription}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🍽️ Chop with Rosty</h1>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px; color: #374151;">Hi ${data.customerName || 'there'},</p>
            <p style="font-size: 16px; color: #374151;">${statusMessage}</p>
            
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; font-weight: 600; color: #111827;">Order Details:</p>
              <p style="margin: 0 0 4px 0; color: #6b7280;">Order: <strong style="color: #111827;">${data.orderDescription}</strong></p>
              <p style="margin: 0 0 4px 0; color: #6b7280;">Status: <strong style="color: #111827;">${data.newStatus}</strong></p>
              ${data.dueDate ? `<p style="margin: 0; color: #6b7280;">Due Date: <strong style="color: #111827;">${data.dueDate}</strong></p>` : ''}
            </div>

            <p style="font-size: 14px; color: #9ca3af; margin-top: 24px;">
              Thank you for choosing us! If you have any questions, please reply to this email.
            </p>
          </div>
        </div>
      `,
    })

    console.log('[Email] Sent successfully:', result)
    return { success: true, data: result }
  } catch (error) {
    console.error('[Email] Failed to send:', error)
    return { success: false, error }
  }
}

export async function sendLowStockAlert(itemName: string, currentStock: number, unit: string, adminEmail: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] Skipping low stock alert — RESEND_API_KEY not configured')
    return { success: false, reason: 'no_api_key' }
  }

  try {
    const result = await getResend().emails.send({
      from: FROM_EMAIL,
      to: adminEmail,
      subject: `⚠️ Low Stock Alert: ${itemName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #ef4444; padding: 20px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0;">⚠️ Low Stock Alert</h1>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px; color: #374151;"><strong>${itemName}</strong> is running low!</p>
            <p style="font-size: 16px; color: #374151;">Current stock: <strong>${currentStock} ${unit}</strong></p>
            <p style="font-size: 14px; color: #9ca3af;">Please restock as soon as possible to avoid disrupting orders.</p>
          </div>
        </div>
      `,
    })

    return { success: true, data: result }
  } catch (error) {
    console.error('[Email] Failed to send low stock alert:', error)
    return { success: false, error }
  }
}
