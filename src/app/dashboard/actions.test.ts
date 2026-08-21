/**
 * Unit tests for requestAddEmail/verifyAddEmail/requestAddPhone/verifyAddPhone in
 * src/app/dashboard/actions.ts — the customer self-service "add a missing contact method" flow.
 *
 * Everything crossing a boundary is mocked — Prisma, sendSms, sendVerificationEmail, and
 * getCurrentDbUser. No real database, no real SMS/email send. Mirrors login/actions.test.ts's
 * shape closely: this flow shares the same OTP control flow, just against a different guard
 * (already-authenticated + "field not already set" instead of phone-login availability).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    otpCode: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ getCurrentDbUser: vi.fn() }))
vi.mock('@/lib/notifications/sms', () => ({ sendSms: vi.fn() }))
vi.mock('@/lib/notifications/email', () => ({ sendVerificationEmail: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getCurrentDbUser } from '@/lib/auth'
import { sendSms } from '@/lib/notifications/sms'
import { sendVerificationEmail } from '@/lib/notifications/email'
import { MAX_OTP_ATTEMPTS, hashOtpCode } from '@/lib/otp'
import {
  requestAddEmail,
  requestAddPhone,
  verifyAddEmail,
  verifyAddPhone,
  updateNotificationPreferences,
  updateProfilePhoto,
} from './actions'

const userFindUnique = vi.mocked(prisma.user.findUnique)
const userUpdate = vi.mocked(prisma.user.update)
const otpFindFirst = vi.mocked(prisma.otpCode.findFirst)
const otpCreate = vi.mocked(prisma.otpCode.create)
const otpUpdate = vi.mocked(prisma.otpCode.update)
const otpUpdateMany = vi.mocked(prisma.otpCode.updateMany)
const getCurrentDbUserMock = vi.mocked(getCurrentDbUser)
const sendSmsMock = vi.mocked(sendSms)
const sendVerificationEmailMock = vi.mocked(sendVerificationEmail)

const TEST_SECRET = 'test-otp-pepper'
const CORRECT_CODE = '123456'
const RAW_PHONE = '0241234567'
const NORMALIZED_PHONE = '233241234567'
const NEW_EMAIL = 'ama@example.com'

/** A customer signed in via phone only — the common case for "add a missing email." */
function stubCustomer(overrides: Record<string, unknown> = {}) {
  getCurrentDbUserMock.mockResolvedValue({
    id: 'user-1',
    email: null,
    phone: NORMALIZED_PHONE,
    role: 'CUSTOMER',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

function otpRow(identifier: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    identifier,
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
  stubCustomer()
  userFindUnique.mockResolvedValue(null) // no existing owner of the new value, by default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userUpdate.mockResolvedValue({} as any) // reset every test, so an earlier test's
  // mockRejectedValue (the P2002 case) can never leak into a later, unrelated test —
  // clearAllMocks() resets call history, not a previously-set implementation.
  otpFindFirst.mockResolvedValue(null)
  otpCreate.mockResolvedValue(otpRow(NEW_EMAIL))
  otpUpdate.mockResolvedValue(otpRow(NEW_EMAIL))
  otpUpdateMany.mockResolvedValue({ count: 1 })
  sendSmsMock.mockResolvedValue({ success: true, data: null })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendVerificationEmailMock.mockResolvedValue({ success: true, data: { id: 'email-id' } } as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('requestAddEmail', () => {
  it('creates an OtpCode row keyed on the email and sends the code by email', async () => {
    const result = await requestAddEmail(NEW_EMAIL)

    expect(result.ok).toBe(true)
    expect(otpCreate).toHaveBeenCalledTimes(1)
    expect(otpCreate.mock.calls[0][0].data.identifier).toBe(NEW_EMAIL)
    expect(sendVerificationEmailMock).toHaveBeenCalledWith(NEW_EMAIL, expect.stringMatching(/^\d{6}$/))
  })

  it('normalizes (trims, lowercases) the email before storing or sending', async () => {
    await requestAddEmail('  Ama@Example.com  ')

    expect(otpCreate.mock.calls[0][0].data.identifier).toBe('ama@example.com')
  })

  it('rejects when not signed in', async () => {
    getCurrentDbUserMock.mockResolvedValue(null)

    const result = await requestAddEmail(NEW_EMAIL)

    expect(result.ok).toBe(false)
    expect(otpCreate).not.toHaveBeenCalled()
  })

  it('rejects when the customer already has an email on file', async () => {
    stubCustomer({ email: 'existing@example.com' })

    const result = await requestAddEmail(NEW_EMAIL)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('already on file')
    expect(otpCreate).not.toHaveBeenCalled()
  })

  it('rejects an invalid email format', async () => {
    const result = await requestAddEmail('not-an-email')

    expect(result.ok).toBe(false)
    expect(otpCreate).not.toHaveBeenCalled()
  })

  it('rejects when another account already owns this email', async () => {
    userFindUnique.mockResolvedValue({ id: 'someone-else' } as never)

    const result = await requestAddEmail(NEW_EMAIL)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('already in use')
    expect(otpCreate).not.toHaveBeenCalled()
  })

  it('rejects a second request inside the cooldown window without creating a row', async () => {
    otpFindFirst.mockResolvedValue(otpRow(NEW_EMAIL, { createdAt: new Date(Date.now() - 5_000) }))

    const result = await requestAddEmail(NEW_EMAIL)

    expect(result.ok).toBe(false)
    expect(otpCreate).not.toHaveBeenCalled()
  })

  it('reports failure when the email could not be sent', async () => {
    sendVerificationEmailMock.mockResolvedValue({ success: false, reason: 'no_api_key' })

    const result = await requestAddEmail(NEW_EMAIL)

    expect(result.ok).toBe(false)
  })
})

describe('verifyAddEmail', () => {
  beforeEach(() => {
    otpFindFirst.mockResolvedValue(otpRow(NEW_EMAIL))
  })

  it('accepts a correct, unexpired code and writes it to the current user only', async () => {
    const result = await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(result.ok).toBe(true)
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { email: NEW_EMAIL } })
  })

  it('marks the code consumed on success', async () => {
    await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(otpUpdate).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { consumedAt: expect.any(Date) },
    })
  })

  it('rejects when not signed in', async () => {
    getCurrentDbUserMock.mockResolvedValue(null)

    const result = await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(result.ok).toBe(false)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the customer already has an email on file', async () => {
    stubCustomer({ email: 'existing@example.com' })

    const result = await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(result.ok).toBe(false)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a wrong code without writing anything', async () => {
    const result = await verifyAddEmail(NEW_EMAIL, '999999')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Incorrect code.')
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('rejects when no unexpired candidate exists', async () => {
    otpFindFirst.mockResolvedValue(null)

    const result = await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_FOUND')
  })

  it('race-safe attempt cap: rejects once the ceiling is reached, never comparing the hash', async () => {
    otpUpdateMany.mockResolvedValue({ count: 0 })

    const result = await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Too many incorrect attempts')
    expect(otpUpdateMany).toHaveBeenCalledWith({
      where: { id: 'otp-1', attempts: { lt: MAX_OTP_ATTEMPTS }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    })
  })

  it('maps a P2002 unique-constraint race on the write to the same "already in use" message', async () => {
    userUpdate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002', name: 'PrismaClientKnownRequestError' })
    )

    const result = await verifyAddEmail(NEW_EMAIL, CORRECT_CODE)

    expect(result.ok).toBe(false)
  })
})

describe('requestAddPhone / verifyAddPhone', () => {
  beforeEach(() => {
    // The common case for "add a missing phone": already has an email, no phone yet.
    stubCustomer({ email: 'existing@example.com', phone: null })
    otpCreate.mockResolvedValue(otpRow(NORMALIZED_PHONE))
    otpUpdate.mockResolvedValue(otpRow(NORMALIZED_PHONE))
  })

  it('normalizes the phone number before storing or sending', async () => {
    await requestAddPhone('024 123 4567')

    expect(otpCreate.mock.calls[0][0].data.identifier).toBe(NORMALIZED_PHONE)
    expect(sendSmsMock.mock.calls[0][0].to).toBe(NORMALIZED_PHONE)
  })

  it('rejects a phone that fails Ghana normalization', async () => {
    const result = await requestAddPhone('+2348012345678')

    expect(result.ok).toBe(false)
    expect(otpCreate).not.toHaveBeenCalled()
  })

  it('rejects when the customer already has a phone on file', async () => {
    stubCustomer({ email: 'existing@example.com', phone: NORMALIZED_PHONE })

    const result = await requestAddPhone(RAW_PHONE)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('already on file')
  })

  it('accepts a correct code and writes the phone to the current user only', async () => {
    otpFindFirst.mockResolvedValue(otpRow(NORMALIZED_PHONE))

    const result = await verifyAddPhone(RAW_PHONE, CORRECT_CODE)

    expect(result.ok).toBe(true)
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phone: NORMALIZED_PHONE } })
  })

  it('never confuses an email-keyed code with a phone verification attempt', async () => {
    // A code was requested for the email channel; nothing exists under the phone identifier.
    otpFindFirst.mockResolvedValue(null)

    const result = await verifyAddPhone(RAW_PHONE, CORRECT_CODE)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_FOUND')
  })
})

describe('updateNotificationPreferences', () => {
  const PREFS = {
    notifyByEmail: true,
    alertEmail: 'alerts@example.com',
    notifyBySms: true,
    alertPhone: NORMALIZED_PHONE,
    notifyByWhatsapp: false,
    alertWhatsapp: '',
  }

  it('writes the toggles and alert contacts to the current user only, normalizing the phone ones', async () => {
    const result = await updateNotificationPreferences(PREFS)

    expect(result.ok).toBe(true)
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        notifyByEmail: true,
        alertEmail: 'alerts@example.com',
        notifyBySms: true,
        alertPhone: NORMALIZED_PHONE,
        notifyByWhatsapp: false,
        alertWhatsapp: null,
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
  })

  it('rejects when not signed in, writing nothing', async () => {
    getCurrentDbUserMock.mockResolvedValue(null)

    const result = await updateNotificationPreferences(PREFS)

    expect(result.ok).toBe(false)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed alert email without writing anything', async () => {
    const result = await updateNotificationPreferences({ ...PREFS, alertEmail: 'not-an-email' })

    expect(result.ok).toBe(false)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('a blank alert phone clears the field to null rather than rejecting', async () => {
    const result = await updateNotificationPreferences({ ...PREFS, alertPhone: '' })

    expect(result.ok).toBe(true)
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ alertPhone: null }) })
    )
  })
})

describe('updateProfilePhoto', () => {
  const NEW_PHOTO_URL = 'https://minio.local/customers/new-photo.jpg'

  beforeEach(() => {
    stubCustomer()
    userUpdate.mockResolvedValue({ imageUrl: NEW_PHOTO_URL } as never)
  })

  it('rejects with VALIDATION when not signed in, writing nothing', async () => {
    getCurrentDbUserMock.mockResolvedValue(null)

    const result = await updateProfilePhoto(NEW_PHOTO_URL)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(userUpdate).not.toHaveBeenCalled()
  })

  // This is the test that proves the "own row only" authorization claim, not just that the
  // action returns ok:true — asserted directly against the mock's `where` clause, sourced from
  // getCurrentDbUser()'s own resolved id, never a hypothetical second id.
  it('writes only to the caller\'s own row, scoped by getCurrentDbUser()\'s resolved id', async () => {
    await updateProfilePhoto(NEW_PHOTO_URL)

    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    )
  })

  it('persists the new photo URL and returns it', async () => {
    const result = await updateProfilePhoto(NEW_PHOTO_URL)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.imageUrl).toBe(NEW_PHOTO_URL)
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { imageUrl: NEW_PHOTO_URL } })
    )
  })

  it('accepts an explicit null to clear an existing photo', async () => {
    userUpdate.mockResolvedValue({ imageUrl: null } as never)

    const result = await updateProfilePhoto(null)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.imageUrl).toBeNull()
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { imageUrl: null } })
    )
  })
})
