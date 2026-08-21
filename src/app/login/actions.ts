"use server"

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { mintSessionForAuthEmail, resolveCustomerForPhoneLogin, isAdminIdentity } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { toGhanaE164 } from '@/lib/phone'
import { isPhoneLoginAvailable } from '@/lib/settings'
import { sendSms } from '@/lib/notifications/sms'
import {
  MAX_OTP_ATTEMPTS,
  OTP_COOLDOWN_MS,
  OTP_EXPIRY_MS,
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
} from '@/lib/otp'

/**
 * Deliberately generic, and deliberately identical across every reason phone login might be
 * unavailable (SMS disabled, no Arkesel key). A caller poking at this endpoint directly learns
 * nothing about which part of the configuration is missing.
 */
const PHONE_LOGIN_UNAVAILABLE = 'Phone login is not available right now.'

export async function login(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const email = formData.get('email') as string

  // GUARD: Only allow login if user exists in DB or is the Admin
  const isAuthorized = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { authEmail: email }
      ]
    }
  }) || isAdminIdentity({ email })

  if (!isAuthorized) {
    redirect(`/login?message=No account found. Please contact the business to place an order.`)
  }

  const response = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
    },
  })

  if (response.error) {
    console.error('Login error FULL OBJECT:', JSON.stringify(response.error, null, 2))
    console.error('Login error plain:', response.error)
    redirect(`/login?message=Could not authenticate user: ${response.error.message || JSON.stringify(response.error)}`)
  }

  redirect('/login?message=Check your email for the magic link')
}

/**
 * Issues a fresh OTP and delivers it by SMS.
 *
 * Intentionally NOT requireAdmin()-gated — this is the pre-authentication login flow, the same
 * trust boundary as the login() action above.
 */
export async function requestPhoneOtp(rawPhone: string): Promise<ActionResult<void>> {
  try {
    if (!(await isPhoneLoginAvailable())) {
      return { ok: false, error: PHONE_LOGIN_UNAVAILABLE, code: 'VALIDATION' }
    }

    const phone = toGhanaE164(rawPhone)
    if (!phone) {
      return { ok: false, error: 'Enter a valid Ghanaian phone number.', code: 'VALIDATION' }
    }

    // GUARD: Only allow login if user exists in DB or is the Admin
    const isAuthorized = await prisma.user.findFirst({
      where: { phone }
    }) || isAdminIdentity({ phone })

    if (!isAuthorized) {
      return { ok: false, error: 'No account found. Please contact the business to place an order.', code: 'VALIDATION' }
    }

    // Per-phone cooldown. Guards the business's real SMS credit balance against a repeated tap —
    // deliberately not IP-based, which is an explicit v1 non-goal.
    const recent = await prisma.otpCode.findFirst({
      where: { identifier: phone },
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
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n========================================`)
      console.log(`[DEV ONLY] OTP CODE FOR ${phone}: ${code}`)
      console.log(`========================================\n`)
    }

    await prisma.otpCode.create({
      data: {
        identifier: phone,
        codeHash: hashOtpCode(code), // only the digest is persisted, never the code itself
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    })

    const result = await sendSms({
      to: phone,
      message: `Your Chop with Rostty login code is ${code}. It expires in 10 minutes.`,
    })
    if (!result.success) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[DEV ONLY] SMS sending failed (${result.reason || 'network error'}), but bypassing error to allow local login.`)
      } else {
        // The row stays behind, unusable. Harmless: it simply expires, and verifyPhoneOtp's
        // consumedAt/expiresAt filter never considers it a candidate. No cleanup job needed for v1.
        return {
          ok: false,
          error: 'Could not send the login code. Please try again.',
          code: 'UNKNOWN',
        }
      }
    }

    return okResult(undefined)
  } catch (err) {
    return toErrorResult(err, 'Could not send the login code. Please try again.')
  }
}

/**
 * Validates a submitted code and, on success, mints a real Supabase session.
 *
 * Also NOT requireAdmin()-gated, and also re-checks availability independently — see
 * isPhoneLoginAvailable.
 */
export async function verifyPhoneOtp(
  rawPhone: string,
  code: string
): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    if (!(await isPhoneLoginAvailable())) {
      return { ok: false, error: PHONE_LOGIN_UNAVAILABLE, code: 'VALIDATION' }
    }

    const phone = toGhanaE164(rawPhone)
    if (!phone) {
      return { ok: false, error: 'Enter a valid Ghanaian phone number.', code: 'VALIDATION' }
    }

    const candidate = await prisma.otpCode.findFirst({
      where: { identifier: phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!candidate) {
      return { ok: false, error: 'Code expired or not found. Request a new one.', code: 'NOT_FOUND' }
    }

    // Race-safe attempt guard. The conditional WHERE does the check and the increment in ONE
    // statement, so two concurrent verify calls cannot both read "4 attempts" and both proceed —
    // the same TOCTOU-closing pattern this codebase already uses for guarded stock decrement.
    // A plain findFirst-then-update would leave exactly that gap.
    const guarded = await prisma.otpCode.updateMany({
      where: { id: candidate.id, attempts: { lt: MAX_OTP_ATTEMPTS }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    })
    if (guarded.count === 0) {
      // Matched nothing: already at the cap, or consumed in between. Reject BEFORE comparing the
      // hash, so a capped code cannot be tested even once more.
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

    const { user, authEmail } = await resolveCustomerForPhoneLogin(phone)
    await mintSessionForAuthEmail(authEmail)
    return okResult({ redirectTo: (user.role === 'ADMIN' || user.role === 'KITCHEN_STAFF') ? '/admin' : '/dashboard' })
  } catch (err) {
    // Covers a missing SUPABASE_SERVICE_ROLE_KEY, a generateLink/verifyOtp failure, and any Prisma
    // error — all surface as an ActionResult the form can render, never an unhandled rejection.
    return toErrorResult(err, 'Could not start a session. Please try again.')
  }
}
