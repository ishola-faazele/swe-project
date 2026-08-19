/**
 * Integration: the OtpCode lifecycle and phone-login identity resolution against the real isolated
 * database.
 *
 * This is where the PRD's "zero duplicate User rows" success metric gets a real, DB-backed proof
 * rather than a mocked one — in particular the FIRST-login create path, not just the easier
 * returning-customer path.
 *
 * The Supabase Admin boundary (mintSessionForAuthEmail) is MOCKED: hitting a real Auth Admin API is
 * not something this harness depends on for any other test, and the generateLink/verifyOtp
 * handshake is covered by the route's own unit tests plus manual QA.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications/sms', () => ({ sendSms: vi.fn() }))
vi.mock('@/lib/settings', () => ({
  getLoginSettings: vi.fn(),
  getNotificationSettings: vi.fn(),
  isArkeselConfigured: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { resolveCustomerForPhoneLogin, syntheticEmailForPhone } from '@/lib/auth'
import { getLoginSettings, getNotificationSettings, isArkeselConfigured } from '@/lib/settings'
import { sendSms } from '@/lib/notifications/sms'
import {
  MAX_OTP_ATTEMPTS,
  OTP_EXPIRY_MS,
  generateOtpCode,
  hashOtpCode,
} from '@/lib/otp'
import { requestPhoneOtp, verifyPhoneOtp } from '@/app/login/actions'
import { cleanupRegistry, newRegistry, type TestRegistry } from './helpers'

const sendSmsMock = vi.mocked(sendSms)
const createClientMock = vi.mocked(createClient)
const createAdminClientMock = vi.mocked(createAdminClient)

/**
 * Both halves of the session-minting handshake, stubbed at the network boundary only —
 * mintSessionForAuthEmail itself runs for real, so the two-client split (generateLink on the
 * service-role client, verifyOtp on the cookie-writing one) is genuinely exercised.
 */
function stubSupabaseSessionMinting(verificationType = 'signup') {
  createAdminClientMock.mockReturnValue({
    auth: {
      admin: {
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { hashed_token: 'hashed-abc', verification_type: verificationType } },
          error: null,
        }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  createClientMock.mockResolvedValue({
    auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

/** Unique per test run, so parallel-ish reruns never collide on User.phone's unique constraint. */
function uniquePhone() {
  return `2332${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`
}

let reg: TestRegistry
const createdOtpPhones: string[] = []

beforeEach(() => {
  reg = newRegistry()
  vi.clearAllMocks()
  vi.stubEnv('OTP_HASH_SECRET', 'integration-test-pepper')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getLoginSettings).mockResolvedValue({ phoneLoginEnabled: true, emailLoginEnabled: true } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getNotificationSettings).mockResolvedValue({ smsEnabled: true } as any)
  vi.mocked(isArkeselConfigured).mockReturnValue(true)
  sendSmsMock.mockResolvedValue({ success: true, data: null })
  stubSupabaseSessionMinting()
})

afterEach(async () => {
  // OtpCode rows have no FK to a registry user, so this file cleans them up itself.
  if (createdOtpPhones.length) {
    await prisma.otpCode.deleteMany({ where: { phone: { in: createdOtpPhones } } })
    createdOtpPhones.length = 0
  }
  await cleanupRegistry(reg)
  vi.unstubAllEnvs()
})

describe('resolveCustomerForPhoneLogin against real User rows', () => {
  // THE first-login case, called out by name as the one that must not be skipped in favour of only
  // testing the simpler returning-customer path.
  test('a fresh phone number creates a new row with a synthetic authEmail and PHONE preference', async () => {
    const phone = uniquePhone()

    const { user, authEmail } = await resolveCustomerForPhoneLogin(phone)
    reg.userIds.push(user.id)

    const persisted = await prisma.user.findUnique({ where: { id: user.id } })
    expect(persisted).not.toBeNull()
    expect(persisted!.phone).toBe(phone)
    expect(persisted!.authEmail).toBe(syntheticEmailForPhone(phone))
    expect(persisted!.preferredLoginMethod).toBe('PHONE')
    expect(persisted!.role).toBe('CUSTOMER')
    expect(authEmail).toBe(syntheticEmailForPhone(phone))
  })

  // The direct, DB-backed proof of the "zero duplicate User rows" metric.
  test('a second login for the same phone returns the same row — no duplicate is created', async () => {
    const phone = uniquePhone()

    const first = await resolveCustomerForPhoneLogin(phone)
    reg.userIds.push(first.user.id)
    const second = await resolveCustomerForPhoneLogin(phone)

    expect(second.user.id).toBe(first.user.id)
    const count = await prisma.user.count({ where: { phone } })
    expect(count).toBe(1)
  })

  test('backfills authEmail onto an admin-created row instead of creating a second one', async () => {
    const phone = uniquePhone()
    // Exactly what createCustomer produces: real contact info, no authEmail yet.
    const preExisting = await prisma.user.create({
      data: { name: 'Admin Created', phone, preferredLoginMethod: 'PHONE', role: 'CUSTOMER' },
    })
    reg.userIds.push(preExisting.id)
    expect(preExisting.authEmail).toBeNull()

    const { user } = await resolveCustomerForPhoneLogin(phone)

    expect(user.id).toBe(preExisting.id)
    expect(user.authEmail).toBe(syntheticEmailForPhone(phone))
    expect(await prisma.user.count({ where: { phone } })).toBe(1)
  })

  test('leaves an already-synced row untouched', async () => {
    const phone = uniquePhone()
    const first = await resolveCustomerForPhoneLogin(phone)
    reg.userIds.push(first.user.id)

    const second = await resolveCustomerForPhoneLogin(phone)

    expect(second.user.authEmail).toBe(first.user.authEmail)
    expect(second.user.updatedAt.getTime()).toBe(first.user.updatedAt.getTime())
  })

  // PROACTIVE-002: two concurrent first-login requests for the same number. User.phone is @unique,
  // so one create loses with P2002 — which must resolve to the same row, not a user-facing error.
  test('two concurrent first-login resolutions converge on one row without surfacing an error', async () => {
    const phone = uniquePhone()

    const [a, b] = await Promise.all([
      resolveCustomerForPhoneLogin(phone),
      resolveCustomerForPhoneLogin(phone),
    ])
    reg.userIds.push(a.user.id, b.user.id)

    expect(a.user.id).toBe(b.user.id)
    expect(await prisma.user.count({ where: { phone } })).toBe(1)
  })
})

describe('OtpCode lifecycle against the real database', () => {
  test('requestPhoneOtp persists a row whose stored hash is not the code that was sent', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)

    const result = await requestPhoneOtp(phone)
    expect(result.ok).toBe(true)

    const row = await prisma.otpCode.findFirst({ where: { phone } })
    expect(row).not.toBeNull()

    const sentCode = sendSmsMock.mock.calls[0][0].message.match(/\b(\d{6})\b/)![1]
    // The PRD's metric, asserted by hash comparison rather than literal equality.
    expect(row!.codeHash).not.toBe(sentCode)
    expect(row!.codeHash).toBe(hashOtpCode(sentCode))
    expect(row!.consumedAt).toBeNull()
    expect(row!.attempts).toBe(0)
  })

  test('a second request inside the cooldown is rejected and writes no new row', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)

    await requestPhoneOtp(phone)
    const second = await requestPhoneOtp(phone)

    expect(second.ok).toBe(false)
    expect(await prisma.otpCode.count({ where: { phone } })).toBe(1)
  })

  test('an expired code is not a valid candidate', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)
    const code = generateOtpCode()
    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() - 1000), // already past
      },
    })

    const result = await verifyPhoneOtp(phone, code)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_FOUND')
  })

  test('a consumed code cannot be reused', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)
    const code = generateOtpCode()
    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
        consumedAt: new Date(),
      },
    })

    const result = await verifyPhoneOtp(phone, code)

    expect(result.ok).toBe(false)
  })

  test('the attempt cap rejects even the correct code once reached', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)
    const code = generateOtpCode()
    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
        attempts: MAX_OTP_ATTEMPTS,
      },
    })

    const result = await verifyPhoneOtp(phone, code)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Too many incorrect attempts')
  })

  test('each wrong guess increments attempts, and the cap stops the run', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)
    const code = generateOtpCode()
    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    })

    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
      const wrong = await verifyPhoneOtp(phone, '000000')
      expect(wrong.ok).toBe(false)
    }

    const row = await prisma.otpCode.findFirst({ where: { phone } })
    expect(row!.attempts).toBe(MAX_OTP_ATTEMPTS)

    // Even the right code is refused now — the cap, not the comparison, is what rejects.
    const capped = await verifyPhoneOtp(phone, code)
    expect(capped.ok).toBe(false)
    if (!capped.ok) expect(capped.error).toContain('Too many incorrect attempts')
  })

  test('a correct code is consumed and resolves the customer, creating exactly one row', async () => {
    const phone = uniquePhone()
    createdOtpPhones.push(phone)
    const code = generateOtpCode()
    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    })

    const result = await verifyPhoneOtp(phone, code)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.redirectTo).toBe('/dashboard')

    const created = await prisma.user.findUnique({ where: { phone } })
    expect(created).not.toBeNull()
    reg.userIds.push(created!.id)

    const row = await prisma.otpCode.findFirst({ where: { phone } })
    expect(row!.consumedAt).not.toBeNull()
  })
})
