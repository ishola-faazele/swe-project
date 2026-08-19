/**
 * Unit tests for src/lib/settings.ts — the DB-backed on/off toggles and the isArkeselConfigured
 * env check. Provider credentials themselves are NOT here — see the module's header for why.
 *
 * Prisma is mocked directly, matching auth.test.ts's convention for Prisma-touching unit tests.
 * No real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationSettings: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getNotificationSettings, isArkeselConfigured, isPhoneLoginAvailable } from './settings'

const notifFindFirst = vi.mocked(prisma.notificationSettings.findFirst)
const notifCreate = vi.mocked(prisma.notificationSettings.create)

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings-1',
    emailEnabled: true,
    alertEmail: null,
    smsEnabled: true,
    alertPhone: null,
    whatsappEnabled: true,
    alertWhatsapp: null,
    updatedAt: new Date(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getNotificationSettings', () => {
  it('returns the existing row without creating a second one', async () => {
    const row = notificationRow()
    notifFindFirst.mockResolvedValueOnce(row)

    const result = await getNotificationSettings()

    expect(result).toEqual(row)
    expect(notifCreate).not.toHaveBeenCalled()
  })

  // The empty create is deliberate: every column default lives in the schema, so there is exactly
  // one definition of what an unconfigured install looks like.
  it('creates a row from schema defaults when none exists yet', async () => {
    notifFindFirst.mockResolvedValueOnce(null)
    const created = notificationRow()
    notifCreate.mockResolvedValueOnce(created)

    const result = await getNotificationSettings()

    expect(notifCreate).toHaveBeenCalledWith({ data: {} })
    expect(result).toEqual(created)
  })

  it('is id-stable on a warm read — a second call creates nothing', async () => {
    const row = notificationRow()
    notifFindFirst.mockResolvedValue(row)

    const first = await getNotificationSettings()
    const second = await getNotificationSettings()

    expect(first.id).toBe(second.id)
    expect(notifCreate).not.toHaveBeenCalled()
  })
})

describe('isArkeselConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true only when both ARKESEL_API_KEY and ARKESEL_SENDER_ID are set', () => {
    vi.stubEnv('ARKESEL_API_KEY', 'key')
    vi.stubEnv('ARKESEL_SENDER_ID', 'Rostty')
    expect(isArkeselConfigured()).toBe(true)
  })

  it('is false when the API key is missing', () => {
    vi.stubEnv('ARKESEL_API_KEY', '')
    vi.stubEnv('ARKESEL_SENDER_ID', 'Rostty')
    expect(isArkeselConfigured()).toBe(false)
  })

  it('is false when the sender ID is missing', () => {
    vi.stubEnv('ARKESEL_API_KEY', 'key')
    vi.stubEnv('ARKESEL_SENDER_ID', '')
    expect(isArkeselConfigured()).toBe(false)
  })

  it('is false when neither is set', () => {
    vi.stubEnv('ARKESEL_API_KEY', '')
    vi.stubEnv('ARKESEL_SENDER_ID', '')
    expect(isArkeselConfigured()).toBe(false)
  })
})

describe('isPhoneLoginAvailable', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true when SMS is enabled and Arkesel is configured', async () => {
    vi.stubEnv('ARKESEL_API_KEY', 'key')
    vi.stubEnv('ARKESEL_SENDER_ID', 'Rostty')
    notifFindFirst.mockResolvedValueOnce(notificationRow({ smsEnabled: true }))

    expect(await isPhoneLoginAvailable()).toBe(true)
  })

  it('is false when SMS is toggled off, even with Arkesel configured', async () => {
    vi.stubEnv('ARKESEL_API_KEY', 'key')
    vi.stubEnv('ARKESEL_SENDER_ID', 'Rostty')
    notifFindFirst.mockResolvedValueOnce(notificationRow({ smsEnabled: false }))

    expect(await isPhoneLoginAvailable()).toBe(false)
  })

  it('is false when SMS is enabled but Arkesel is not configured', async () => {
    vi.stubEnv('ARKESEL_API_KEY', '')
    vi.stubEnv('ARKESEL_SENDER_ID', '')
    notifFindFirst.mockResolvedValueOnce(notificationRow({ smsEnabled: true }))

    expect(await isPhoneLoginAvailable()).toBe(false)
  })
})
