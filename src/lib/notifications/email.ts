/**
 * Transactional email sender (Resend).
 *
 * "Enabled" comes from the database (admin-managed at /admin/settings); "configured" (the API
 * key/from-address) comes from .env, same as it always has — see src/lib/settings.ts's header for
 * why credentials never moved into the database. These functions never throw.
 */
import { Resend } from 'resend'
import { getNotificationSettings } from '@/lib/settings'

const DEFAULT_FROM_EMAIL = 'Chop with Rostty <onboarding@resend.dev>'

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  return apiKey ? new Resend(apiKey) : null
}

export type OrderStatusEmailData = {
  customerEmail: string
  customerName?: string
  orderId: string
  orderDescription: string
  newStatus: string
  dueDate?: string | null
}

export async function sendOrderStatusEmail(data: OrderStatusEmailData) {
  const settings = await getNotificationSettings()
  if (!settings.emailEnabled) {
    console.log('[Email] Skipping email send — email channel is disabled in Settings')
    return { success: false, reason: 'email_disabled' }
  }
  const resend = getResendClient()
  if (!resend) {
    console.log('[Email] Skipping email send — RESEND_API_KEY not set in .env')
    return { success: false, reason: 'no_api_key' }
  }
  const fromEmail = process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL

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
    const result = await resend.emails.send({
      from: fromEmail,
      to: data.customerEmail,
      subject: `Order Update: ${data.newStatus} — ${data.orderDescription}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🍽️ Chop with Rostty</h1>
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
  const settings = await getNotificationSettings()
  if (!settings.emailEnabled) {
    console.log('[Email] Skipping low stock alert — email channel is disabled in Settings')
    return { success: false, reason: 'email_disabled' }
  }
  const resend = getResendClient()
  if (!resend) {
    console.log('[Email] Skipping low stock alert — RESEND_API_KEY not set in .env')
    return { success: false, reason: 'no_api_key' }
  }

  try {
    const result = await resend.emails.send({
      from: process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL,
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

/**
 * Welcomes a newly-created customer with a working, click-to-log-in link.
 *
 * `magicLink` is taken as a plain string and embedded as-is. This function deliberately knows
 * nothing about how that URL is built or what route it points at — constructing it is the
 * caller's job (createCustomer), which keeps the redemption mechanics in one place and means a
 * change there needs no edit here. There is no hard-coded fallback URL: an email whose only
 * call to action is a broken link is worse than the caller simply not sending one.
 *
 * Note that Supabase does NOT send this itself — admin.generateLink only mints a link, unlike
 * signInWithOtp/inviteUserByEmail which auto-send. This function is what actually delivers it.
 */
export async function sendAccountCreatedEmail(data: {
  to: string
  name?: string | null
  magicLink: string
}) {
  const settings = await getNotificationSettings()
  if (!settings.emailEnabled) {
    console.log('[Email] Skipping account-created email — email channel is disabled in Settings')
    return { success: false, reason: 'email_disabled' }
  }
  const resend = getResendClient()
  if (!resend) {
    console.log('[Email] Skipping account-created email — RESEND_API_KEY not set in .env')
    return { success: false, reason: 'no_api_key' }
  }

  try {
    const result = await resend.emails.send({
      from: process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL,
      to: data.to,
      subject: 'Your Chop with Rostty account is ready',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🍽️ Chop with Rostty</h1>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px; color: #374151;">Hi ${data.name || 'there'},</p>
            <p style="font-size: 16px; color: #374151;">
              Your account is ready. Tap the button below to sign in and track your orders — no
              password needed.
            </p>

            <div style="margin: 28px 0; text-align: center;">
              <a href="${data.magicLink}"
                 style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Sign in to my account
              </a>
            </div>

            <p style="font-size: 14px; color: #6b7280;">
              If the button doesn't work, copy and paste this link into your browser:<br />
              <span style="word-break: break-all; color: #4b5563;">${data.magicLink}</span>
            </p>

            <p style="font-size: 14px; color: #9ca3af; margin-top: 24px;">
              If you weren't expecting this email, you can safely ignore it.
            </p>
          </div>
        </div>
      `,
    })

    console.log('[Email] Account-created email sent successfully')
    return { success: true, data: result }
  } catch (error) {
    console.error('[Email] Failed to send account-created email:', error)
    return { success: false, error }
  }
}
