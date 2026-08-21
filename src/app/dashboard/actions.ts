"use server"

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getCurrentDbUser } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { toGhanaE164 } from '@/lib/phone'
import {
  addEmailSchema,
  updateNotificationPreferencesSchema,
  updateProfilePhotoSchema,
} from '@/lib/validation'
import { sendSms } from '@/lib/notifications/sms'
import { sendVerificationEmail } from '@/lib/notifications/email'
import type { User } from '@prisma/client'
import { z } from 'zod'
import {
  MAX_OTP_ATTEMPTS,
  OTP_COOLDOWN_MS,
  OTP_EXPIRY_MS,
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
} from '@/lib/otp'

const NOT_SIGNED_IN = 'You must be signed in to do that.'

/**
 * Adds a missing email or phone to the CURRENTLY authenticated customer's own row — never anyone
 * else's, and never a value that's already set. Deliberately customer-self-service only: the
 * admin sets both contact fields at creation time if they're known then, but once set, neither
 * is editable by anyone afterward (see src/app/admin/customers/actions.ts's updateCustomer) —
 * only the customer who can actually prove ownership of a genuinely NEW value gets to fill an
 * empty slot. There is no "change an existing one" path anywhere in this app, on purpose.
 *
 * The four exported functions below (request/verify × email/phone) share one control flow —
 * cooldown check, generate+store, deliver-or-lookup, race-safe attempt cap, hash compare, write —
 * via the two internal helpers underneath. What genuinely differs per channel is small enough
 * (three fields' worth) that hand-duplicating this ~40-line flow twice would be the worse trade.
 */
type Channel = {
  alreadySet: (user: User) => boolean
  normalize: (raw: string) => string | null
  findExisting: (value: string) => Promise<{ id: string } | null>
  applyValue: (userId: string, value: string) => Promise<unknown>
  deliver: (to: string, code: string) => Promise<boolean>
  alreadySetMessage: string
  invalidMessage: string
  inUseMessage: string
}

const EMAIL_CHANNEL: Channel = {
  alreadySet: (user) => Boolean(user.email),
  normalize: (raw) => {
    const parsed = addEmailSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  },
  findExisting: (email) => prisma.user.findUnique({ where: { email }, select: { id: true } }),
  applyValue: (userId, email) => prisma.user.update({ where: { id: userId }, data: { email } }),
  deliver: async (to, code) => (await sendVerificationEmail(to, code)).success,
  alreadySetMessage: 'An email is already on file for your account.',
  invalidMessage: 'Enter a valid email address.',
  inUseMessage: 'That email is already in use.',
}

const PHONE_CHANNEL: Channel = {
  alreadySet: (user) => Boolean(user.phone),
  normalize: (raw) => toGhanaE164(raw),
  findExisting: (phone) => prisma.user.findUnique({ where: { phone }, select: { id: true } }),
  applyValue: (userId, phone) => prisma.user.update({ where: { id: userId }, data: { phone } }),
  deliver: async (to, code) =>
    (await sendSms({
      to,
      message: `Your Chop with Rostty verification code is ${code}. It expires in 10 minutes.`,
    })).success,
  alreadySetMessage: 'A phone number is already on file for your account.',
  invalidMessage: 'Enter a valid Ghanaian phone number.',
  inUseMessage: 'That phone number is already in use.',
}

async function requestAddContact(channel: Channel, rawValue: string): Promise<ActionResult<void>> {
  try {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: NOT_SIGNED_IN, code: 'VALIDATION' }
    if (channel.alreadySet(user)) {
      return { ok: false, error: channel.alreadySetMessage, code: 'VALIDATION' }
    }

    const value = channel.normalize(rawValue)
    if (!value) return { ok: false, error: channel.invalidMessage, code: 'VALIDATION' }

    // Someone else's account already owns this value — the unique constraint would catch it at
    // write time regardless, but checking now avoids sending a code for a verification that
    // could never succeed.
    if (await channel.findExisting(value)) {
      return { ok: false, error: channel.inUseMessage, code: 'VALIDATION' }
    }

    // Per-value cooldown — same reasoning as login/actions.ts's requestPhoneOtp: guards the
    // business's real SMS/email sending against a repeated tap, not IP-based (v1 non-goal).
    const recent = await prisma.otpCode.findFirst({
      where: { identifier: value },
      orderBy: { createdAt: 'desc' },
    })
    if (recent && Date.now() - recent.createdAt.getTime() < OTP_COOLDOWN_MS) {
      return {
        ok: false,
        error: 'Please wait a minute before requesting another code.',
        code: 'VALIDATION',
      }
    }

    const code = generateOtpCode()
    await prisma.otpCode.create({
      data: {
        identifier: value,
        codeHash: hashOtpCode(code), // only the digest is persisted, never the code itself
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    })

    const delivered = await channel.deliver(value, code)
    if (!delivered) {
      // The row stays behind, unusable — it simply expires. No cleanup job needed for v1, same
      // as the phone-login flow.
      return {
        ok: false,
        error: 'Could not send the verification code. Please try again.',
        code: 'UNKNOWN',
      }
    }

    return okResult(undefined)
  } catch (err) {
    return toErrorResult(err, 'Could not send the verification code. Please try again.')
  }
}

async function verifyAddContact(
  channel: Channel,
  rawValue: string,
  code: string
): Promise<ActionResult<void>> {
  try {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: NOT_SIGNED_IN, code: 'VALIDATION' }
    if (channel.alreadySet(user)) {
      return { ok: false, error: channel.alreadySetMessage, code: 'VALIDATION' }
    }

    const value = channel.normalize(rawValue)
    if (!value) return { ok: false, error: channel.invalidMessage, code: 'VALIDATION' }

    const candidate = await prisma.otpCode.findFirst({
      where: { identifier: value, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!candidate) {
      return { ok: false, error: 'Code expired or not found. Request a new one.', code: 'NOT_FOUND' }
    }

    // Race-safe attempt guard — the same conditional-WHERE-does-check-and-increment-in-one
    // pattern as login/actions.ts's verifyPhoneOtp, for the same TOCTOU reason.
    const guarded = await prisma.otpCode.updateMany({
      where: { id: candidate.id, attempts: { lt: MAX_OTP_ATTEMPTS }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    })
    if (guarded.count === 0) {
      return {
        ok: false,
        error: 'Too many incorrect attempts. Request a new code.',
        code: 'VALIDATION',
      }
    }

    if (!verifyOtpCodeHash(code, candidate.codeHash)) {
      // Never reports how many attempts remain — that would help an attacker calibrate.
      return { ok: false, error: 'Incorrect code.', code: 'VALIDATION' }
    }

    await prisma.otpCode.update({
      where: { id: candidate.id },
      data: { consumedAt: new Date() },
    })

    try {
      // Writes only the CURRENTLY authenticated user's own row — no session change, since the
      // customer's login identity isn't what's being modified here, only their contact info.
      await channel.applyValue(user.id, value)
    } catch (err) {
      // The narrow race: someone else claimed this exact value between the request and verify
      // steps. Both User.email and User.phone are @unique, so this surfaces as P2002.
      return toErrorResult(err, channel.inUseMessage)
    }

    revalidatePath('/dashboard')
    return okResult(undefined)
  } catch (err) {
    return toErrorResult(err, 'Could not verify that code. Please try again.')
  }
}

export async function requestAddEmail(rawEmail: string): Promise<ActionResult<void>> {
  return requestAddContact(EMAIL_CHANNEL, rawEmail)
}

export async function verifyAddEmail(rawEmail: string, code: string): Promise<ActionResult<void>> {
  return verifyAddContact(EMAIL_CHANNEL, rawEmail, code)
}

export async function requestAddPhone(rawPhone: string): Promise<ActionResult<void>> {
  return requestAddContact(PHONE_CHANNEL, rawPhone)
}

export async function verifyAddPhone(rawPhone: string, code: string): Promise<ActionResult<void>> {
  return verifyAddContact(PHONE_CHANNEL, rawPhone, code)
}

/**
 * The customer's own per-channel notification setup — mirrors the admin's Notifications tab at
 * /admin/settings exactly: a toggle PLUS an alert-destination contact per channel, scoped to the
 * CURRENTLY authenticated customer's own row rather than a global singleton. The alert contacts
 * are deliberately independent of this customer's login email/phone — a customer can route order
 * alerts to a different number or address than the one they sign in with (see User.alertEmail's
 * schema comment for the fallback-to-login-contact behavior when left blank).
 *
 * The toggle is checked ALONGSIDE, not instead of, the admin's global channel toggle: a channel
 * only actually sends when both this customer's flag and NotificationSettings' matching toggle
 * are true (see notifyOrderStatusChange in src/lib/notifications/index.ts).
 */
type NotificationPrefs = Pick<
  User,
  'notifyByEmail' | 'alertEmail' | 'notifyBySms' | 'alertPhone' | 'notifyByWhatsapp' | 'alertWhatsapp'
>

export async function updateNotificationPreferences(
  data: z.input<typeof updateNotificationPreferencesSchema>
): Promise<ActionResult<NotificationPrefs>> {
  try {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: NOT_SIGNED_IN, code: 'VALIDATION' }

    const input = updateNotificationPreferencesSchema.parse(data)
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        notifyByEmail: input.notifyByEmail,
        alertEmail: input.alertEmail ?? null,
        notifyBySms: input.notifyBySms,
        alertPhone: input.alertPhone ?? null,
        notifyByWhatsapp: input.notifyByWhatsapp,
        alertWhatsapp: input.alertWhatsapp ?? null,
      },
      select: {
        notifyByEmail: true,
        alertEmail: true,
        notifyBySms: true,
        alertPhone: true,
        notifyByWhatsapp: true,
        alertWhatsapp: true,
      },
    })

    revalidatePath('/dashboard')
    return okResult(updated)
  } catch (err) {
    return toErrorResult(err, 'Could not save your notification preferences. Please try again.')
  }
}

export async function updateCustomerNotes(
  notes: string
): Promise<ActionResult<{ notes: string | null }>> {
  try {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: NOT_SIGNED_IN, code: 'VALIDATION' }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { notes: notes.trim() || null },
      select: { notes: true },
    })

    revalidatePath('/dashboard')
    return okResult(updated)
  } catch (err) {
    return toErrorResult(err, 'Could not save your notes. Please try again.')
  }
}

/**
 * Sets, replaces, or clears the CURRENTLY authenticated customer's own profile photo. This is the
 * ONLY write path to User.imageUrl anywhere in the app — the admin's createCustomer/updateCustomer
 * deliberately cannot touch it (see the PRD's Non-Goals); they keep read access only.
 *
 * Deliberately no OTP/verification step, unlike requestAddEmail/requestAddPhone above: a photo
 * neither establishes identity nor becomes a delivery destination, so there is nothing to prove
 * ownership of before writing it, and no uniqueness constraint to collide with.
 *
 * An explicit `null` clears an existing photo — the `.nullish()` on updateProfilePhotoSchema's
 * imageUrl is what makes "clear it" expressible at all, distinct from "leave it alone".
 */
export async function updateProfilePhoto(
  imageUrl: string | null
): Promise<ActionResult<{ imageUrl: string | null }>> {
  try {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: NOT_SIGNED_IN, code: 'VALIDATION' }

    const input = updateProfilePhotoSchema.parse({ imageUrl })
    const updated = await prisma.user.update({
      // NEVER a client-supplied id — this clause is the entire authorization model for this
      // action, mirroring verifyAddContact's own applyValue(user.id, value) above.
      where: { id: user.id },
      data: { imageUrl: input.imageUrl },
      select: { imageUrl: true },
    })

    revalidatePath('/dashboard')
    return okResult(updated)
  } catch (err) {
    return toErrorResult(err, 'Could not save your photo. Please try again.')
  }
}
