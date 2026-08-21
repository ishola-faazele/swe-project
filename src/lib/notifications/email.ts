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

function getEmailTemplate(content: string) {
  const logoUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/rosty-logo.jpeg`
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
      <div style="background-color: #0a0a0a; padding: 32px 20px; text-align: center; border-radius: 12px 12px 0 0; border-bottom: 3px solid #f59e0b;">
        <img src="${logoUrl}" alt="Chop with Rostty" width="80" height="80" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin-bottom: 16px; border: 2px solid #27272a;" />
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Chop with Rostty</h1>
      </div>
      <div style="background-color: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        ${content}
      </div>
      <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px;">
        <p style="margin: 0;">© ${new Date().getFullYear()} Chop with Rostty. All rights reserved.</p>
      </div>
    </div>
  `
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
      html: getEmailTemplate(`
        <p style="font-size: 16px; color: #374151; margin-top: 0;">Hi ${data.customerName || 'there'},</p>
        <p style="font-size: 16px; color: #374151;">${statusMessage}</p>
        
        <div style="background: #fdf6e3; border: 1px solid #fde68a; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 12px 0; font-weight: 600; color: #92400e; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Order Details</p>
          <p style="margin: 0 0 8px 0; color: #451a03; font-size: 16px;"><strong>${data.orderDescription}</strong></p>
          <p style="margin: 0 0 4px 0; color: #78350f;">Status: <strong>${data.newStatus}</strong></p>
          ${data.dueDate ? `<p style="margin: 0; color: #78350f;">Due Date: <strong>${data.dueDate}</strong></p>` : ''}
        </div>

        <p style="font-size: 14px; color: #6b7280; margin-top: 32px; margin-bottom: 0;">
          Thank you for choosing us! If you have any questions, please reply to this email.
        </p>
      `),
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
      html: getEmailTemplate(`
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
          <h2 style="color: #991b1b; margin: 0 0 12px 0; font-size: 18px;">⚠️ Low Stock Alert</h2>
          <p style="font-size: 16px; color: #7f1d1d; margin: 0 0 8px 0;"><strong>${itemName}</strong> is running low!</p>
          <p style="font-size: 16px; color: #7f1d1d; margin: 0;">Current stock: <strong>${currentStock} ${unit}</strong></p>
        </div>
        <p style="font-size: 14px; color: #4b5563; margin: 0;">Please restock as soon as possible to avoid disrupting orders.</p>
      `),
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
      html: getEmailTemplate(`
        <p style="font-size: 16px; color: #374151; margin-top: 0;">Hi ${data.name || 'there'},</p>
        <p style="font-size: 16px; color: #374151; line-height: 1.5;">
          Your account is ready. Tap the button below to sign in and track your orders — no password needed.
        </p>

        <div style="margin: 32px 0; text-align: center;">
          <a href="${data.magicLink}"
             style="display: inline-block; background-color: #f59e0b; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
            Sign in to my account
          </a>
        </div>

        <p style="font-size: 14px; color: #6b7280; line-height: 1.5;">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <span style="word-break: break-all; color: #4b5563; display: inline-block; margin-top: 8px;">${data.magicLink}</span>
        </p>

        <p style="font-size: 14px; color: #9ca3af; margin-top: 32px; margin-bottom: 0;">
          If you weren't expecting this email, you can safely ignore it.
        </p>
      `),
    })

    console.log('[Email] Account-created email sent successfully')
    return { success: true, data: result }
  } catch (error) {
    console.error('[Email] Failed to send account-created email:', error)
    return { success: false, error }
  }
}

/**
 * Delivers an OTP code by email — the email counterpart to sms.ts's sendSms, used when a
 * logged-in customer adds a missing email to their profile (src/app/dashboard/actions.ts).
 *
 * Never logs `code` on any path, including success: this is a live, unexpired credential for as
 * long as it's unconsumed, the same reasoning sms.ts's no-op branches already apply to an OTP
 * message body.
 */
export async function sendVerificationEmail(to: string, code: string) {
  const settings = await getNotificationSettings()
  if (!settings.emailEnabled) {
    console.log('[Email] Skipping verification email — email channel is disabled in Settings')
    return { success: false, reason: 'email_disabled' }
  }
  const resend = getResendClient()
  if (!resend) {
    console.log('[Email] Skipping verification email — RESEND_API_KEY not set in .env')
    return { success: false, reason: 'no_api_key' }
  }

  try {
    const result = await resend.emails.send({
      from: process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL,
      to,
      subject: 'Your Chop with Rostty verification code',
      html: getEmailTemplate(`
        <p style="font-size: 16px; color: #374151; margin-top: 0; text-align: center;">Your verification code is:</p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
          <p style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #111827; margin: 0;">${code}</p>
        </div>
        <p style="font-size: 14px; color: #6b7280; text-align: center; margin-bottom: 0;">
          It expires in 10 minutes.<br />
          If you didn't request this, you can safely ignore it.
        </p>
      `),
    })

    console.log('[Email] Verification email sent successfully')
    return { success: true, data: result }
  } catch (error) {
    console.error('[Email] Failed to send verification email:', error)
    return { success: false, error }
  }
}
