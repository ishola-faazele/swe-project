/**
 * Unit tests for requestPhoneOtp / verifyPhoneOtp in src/app/login/actions.ts.
 *
 * Everything crossing a boundary is mocked — Prisma, sendSms, the settings accessors, and both
 * auth helpers. No real database, no real SMS, no real Supabase call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    otpCode: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('@/lib/settings', () => ({
  getLoginSettings: vi.fn(),
  getNotificationSettings: vi.fn(),
  isArkeselConfigured: vi.fn(),
}))
vi.mock('@/lib/notifications/sms', () => ({ sendSms: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  resolveCustomerForPhoneLogin: vi.fn(),
  mintSessionForAuthEmail: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getLoginSettings, getNotificationSettings, isArkeselConfigured } from '@/lib/settings'
import { sendSms } from '@/lib/notifications/sms'
import { mintSessionForAuthEmail, resolveCustomerForPhoneLogin } from '@/lib/auth'
import { MAX_OTP_ATTEMPTS, hashOtpCode } from '@/lib/otp'
import { requestPhoneOtp, verifyPhoneOtp } from './actions'

const otpFindFirst = vi.mocked(prisma.otpCode.findFirst)
const otpCreate = vi.mocked(prisma.otpCode.create)
const otpUpdate = vi.mocked(prisma.otpCode.update)
const otpUpdateMany = vi.mocked(prisma.otpCode.updateMany)
const loginSettingsMock = vi.mocked(getLoginSettings)
const notifSettingsMock = vi.mocked(getNotificationSettings)
const arkeselConfiguredMock = vi.mocked(isArkeselConfigured)
const sendSmsMock = vi.mocked(sendSms)
const resolveCustomerMock = vi.mocked(resolveCustomerForPhoneLogin)
const mintSessionMock = vi.mocked(mintSessionForAuthEmail)

const RAW_PHONE = '0241234567'
const NORMALIZED_PHONE = '233241234567'
const TEST_SECRET = 'test-otp-pepper'
const CORRECT_CODE = '123456'

/** Phone login fully available: toggle on, SMS on, Arkesel configured in env. */
function stubAvailable(
  login: Record<string, unknown> = {},
  notif: Record<string, unknown> = {},
  arkeselConfigured = true
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loginSettingsMock.mockResolvedValue({ phoneLoginEnabled: true, emailLoginEnabled: true, ...login } as any)
  notifSettingsMock.mockResolvedValue({
    smsEnabled: true,
    ...notif,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  arkeselConfiguredMock.mockReturnValue(arkeselConfigured)
}

function otpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    phone: NORMALIZED_PHONE,
    codeHash: hashOtpCode(CORRECT_CODE),
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    consumedAt: null,
    createdAt: new Date(Date.now() - 120_000), // outside the cooldown window
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OTP_HASH_SECRET', TEST_SECRET)
  stubAvailable()
  otpFindFirst.mockResolvedValue(null)
  otpCreate.mockResolvedValue(otpRow())
  otpUpdate.mockResolvedValue(otpRow())
  otpUpdateMany.mockResolvedValue({ count: 1 })
  sendSmsMock.mockResolvedValue({ success: true, data: null })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveCustomerMock.mockResolvedValue({ user: { role: 'CUSTOMER' }, authEmail: 'x@y.z' } as any)
  mintSessionMock.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('requestPhoneOtp', () => {
  it('creates an OtpCode row and sends the code by SMS', async () => {
    const result = await requestPhoneOtp(RAW_PHONE)

    expect(result.ok).toBe(true)
    expect(otpCreate).toHaveBeenCalledTimes(1)
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes the phone number before storing or sending', async () => {
    await requestPhoneOtp('024 123 4567')

    expect(otpCreate.mock.calls[0][0].data.phone).toBe(NORMALIZED_PHONE)
    expect(sendSmsMock.mock.calls[0][0].to).toBe(NORMALIZED_PHONE)
  })

  // The stored value must never be the code itself — that is the PRD's own success metric.
  it('stores only a hash, never the plaintext code', async () => {
    await requestPhoneOtp(RAW_PHONE)

    const { codeHash } = otpCreate.mock.calls[0][0].data
    const sentMessage = sendSmsMock.mock.calls[0][0].message
    const sentCode = sentMessage.match(/\b(\d{6})\b/)![1]

    expect(codeHash).not.toContain(sentCode)
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/)
    // The digest genuinely corresponds to the code that was sent.
    expect(codeHash).toBe(hashOtpCode(sentCode))
  })

  it('rejects an invalid phone number before creating any row', async () => {
    const result = await requestPhoneOtp('+2348012345678') // Nigerian — toGhanaE164 rejects it

    expect(result).toEqual({
      ok: false,
      error: 'Enter a valid Ghanaian phone number.',
      code: 'VALIDATION',
    })
    expect(otpCreate).not.toHaveBeenCalled()
  })

  describe('availability re-checks — every call, not just at page render', () => {
    it('rejects when phone login is toggled off', async () => {
      stubAvailable({ phoneLoginEnabled: false })

      const result = await requestPhoneOtp(RAW_PHONE)

      expect(result.ok).toBe(false)
      expect(otpCreate).not.toHaveBeenCalled()
    })

    it('rejects when the SMS channel is disabled', async () => {
      stubAvailable({}, { smsEnabled: false })

      const result = await requestPhoneOtp(RAW_PHONE)

      expect(result.ok).toBe(false)
      expect(otpCreate).not.toHaveBeenCalled()
    })

    it('rejects when Arkesel is not configured in env', async () => {
      stubAvailable({}, {}, false)

      const result = await requestPhoneOtp(RAW_PHONE)

      expect(result.ok).toBe(false)
      expect(otpCreate).not.toHaveBeenCalled()
    })

    // A caller poking at this endpoint directly must not learn which part is misconfigured.
    it('gives the same generic message regardless of which check failed', async () => {
      stubAvailable({ phoneLoginEnabled: false })
      const a = await requestPhoneOtp(RAW_PHONE)
      stubAvailable({}, { smsEnabled: false })
      const b = await requestPhoneOtp(RAW_PHONE)
      stubAvailable({}, {}, false)
      const c = await requestPhoneOtp(RAW_PHONE)

      expect(a.ok).toBe(false)
      expect(b.ok).toBe(false)
      expect(c.ok).toBe(false)
      if (!a.ok && !b.ok && !c.ok) {
        expect(a.error).toBe(b.error)
        expect(b.error).toBe(c.error)
      }
    })
  })

  describe('per-phone cooldown', () => {
    it('rejects a second request inside the cooldown window without creating a row', async () => {
      otpFindFirst.mockResolvedValue(otpRow({ createdAt: new Date(Date.now() - 5_000) }))

      const result = await requestPhoneOtp(RAW_PHONE)

      expect(result).toEqual({
        ok: false,
        error: 'Please wait a minute before requesting another code.',
        code: 'VALIDATION',
      })
      expect(otpCreate).not.toHaveBeenCalled()
      expect(sendSmsMock).not.toHaveBeenCalled()
    })

    it('allows a request once the cooldown has elapsed', async () => {
      otpFindFirst.mockResolvedValue(otpRow({ createdAt: new Date(Date.now() - 120_000) }))

      const result = await requestPhoneOtp(RAW_PHONE)

      expect(result.ok).toBe(true)
      expect(otpCreate).toHaveBeenCalledTimes(1)
    })
  })

  it('reports failure when the SMS could not be sent', async () => {
    sendSmsMock.mockResolvedValue({ success: false, reason: 'sms_not_configured' })

    const result = await requestPhoneOtp(RAW_PHONE)

    expect(result.ok).toBe(false)
  })

  it('returns an ActionResult rather than throwing when Prisma fails', async () => {
    otpCreate.mockRejectedValue(new Error('db down'))

    const result = await requestPhoneOtp(RAW_PHONE)

    expect(result.ok).toBe(false)
  })
})

describe('verifyPhoneOtp', () => {
  it('accepts a correct, unexpired code and returns the role-based redirect', async () => {
    otpFindFirst.mockResolvedValue(otpRow())

    const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

    expect(result).toEqual({ ok: true, data: { redirectTo: '/dashboard' } })
    expect(mintSessionMock).toHaveBeenCalledTimes(1)
  })

  it('sends an ADMIN to /admin instead', async () => {
    otpFindFirst.mockResolvedValue(otpRow())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveCustomerMock.mockResolvedValue({ user: { role: 'ADMIN' }, authEmail: 'x@y.z' } as any)

    const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

    expect(result).toEqual({ ok: true, data: { redirectTo: '/admin' } })
  })

  it('marks the code consumed on success', async () => {
    otpFindFirst.mockResolvedValue(otpRow())

    await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

    expect(otpUpdate).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { consumedAt: expect.any(Date) },
    })
  })

  it('rejects when no unexpired, unconsumed code exists', async () => {
    otpFindFirst.mockResolvedValue(null)

    const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

    expect(result).toEqual({
      ok: false,
      error: 'Code expired or not found. Request a new one.',
      code: 'NOT_FOUND',
    })
    expect(mintSessionMock).not.toHaveBeenCalled()
  })

  it('only considers unconsumed, unexpired candidates', async () => {
    otpFindFirst.mockResolvedValue(otpRow())

    await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

    expect(otpFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ consumedAt: null, expiresAt: { gt: expect.any(Date) } }),
      })
    )
  })

  it('rejects a wrong code without minting a session', async () => {
    otpFindFirst.mockResolvedValue(otpRow())

    const result = await verifyPhoneOtp(RAW_PHONE, '999999')

    expect(result).toEqual({ ok: false, error: 'Incorrect code.', code: 'VALIDATION' })
    expect(mintSessionMock).not.toHaveBeenCalled()
  })

  describe('race-safe attempt cap', () => {
    // The regression test for the TOCTOU-safe design itself, not just the numeric threshold: the
    // check and the increment happen in ONE conditional updateMany, so a count of 0 means "already
    // capped or consumed" and must reject BEFORE the hash is ever compared.
    it('rejects without comparing the hash when the guarded updateMany matches nothing', async () => {
      otpFindFirst.mockResolvedValue(otpRow({ attempts: MAX_OTP_ATTEMPTS }))
      otpUpdateMany.mockResolvedValue({ count: 0 })

      const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

      expect(result).toEqual({
        ok: false,
        error: 'Too many incorrect attempts. Request a new code.',
        code: 'VALIDATION',
      })
      // Even the CORRECT code is refused once capped — proof the guard runs first.
      expect(mintSessionMock).not.toHaveBeenCalled()
      expect(otpUpdate).not.toHaveBeenCalled()
    })

    it('guards on both the attempt ceiling and consumedAt in a single conditional write', async () => {
      otpFindFirst.mockResolvedValue(otpRow())

      await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

      expect(otpUpdateMany).toHaveBeenCalledWith({
        where: { id: 'otp-1', attempts: { lt: MAX_OTP_ATTEMPTS }, consumedAt: null },
        data: { attempts: { increment: 1 } },
      })
    })
  })

  // Never reveal how many tries remain — that would help an attacker calibrate.
  it('never reports a remaining-attempts count in any rejection message', async () => {
    otpFindFirst.mockResolvedValue(otpRow({ attempts: 3 }))

    const wrong = await verifyPhoneOtp(RAW_PHONE, '999999')
    otpUpdateMany.mockResolvedValue({ count: 0 })
    const capped = await verifyPhoneOtp(RAW_PHONE, '999999')

    for (const result of [wrong, capped]) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).not.toMatch(/\d+\s*(attempt|tries|remaining|left)/i)
        expect(result.error).not.toMatch(/\b[0-5]\b/)
      }
    }
  })

  describe('availability re-checks', () => {
    it('rejects when phone login is toggled off, before touching any OtpCode row', async () => {
      stubAvailable({ phoneLoginEnabled: false })

      const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

      expect(result.ok).toBe(false)
      expect(otpFindFirst).not.toHaveBeenCalled()
      expect(mintSessionMock).not.toHaveBeenCalled()
    })

    it('rejects when the SMS channel is disabled', async () => {
      stubAvailable({}, { smsEnabled: false })

      const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

      expect(result.ok).toBe(false)
      expect(mintSessionMock).not.toHaveBeenCalled()
    })
  })

  it('rejects an invalid phone number before any lookup', async () => {
    const result = await verifyPhoneOtp('+2348012345678', CORRECT_CODE)

    expect(result.ok).toBe(false)
    expect(otpFindFirst).not.toHaveBeenCalled()
  })

  describe('session-minting failures degrade to an ActionResult, never an unhandled rejection', () => {
    it('catches a thrown mintSessionForAuthEmail (e.g. a missing service-role key)', async () => {
      otpFindFirst.mockResolvedValue(otpRow())
      mintSessionMock.mockRejectedValue(new Error('Could not start a session. Please try again.'))

      const result = await verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)

      expect(result.ok).toBe(false)
    })

    it('catches a thrown resolveCustomerForPhoneLogin', async () => {
      otpFindFirst.mockResolvedValue(otpRow())
      resolveCustomerMock.mockRejectedValue(new Error('db down'))

      await expect(verifyPhoneOtp(RAW_PHONE, CORRECT_CODE)).resolves.toMatchObject({ ok: false })
    })
  })
})
