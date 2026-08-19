/**
 * Unit tests for src/lib/settings.ts — the DB-backed settings accessors.
 *
 * Prisma is mocked directly, matching auth.test.ts's convention for Prisma-touching unit tests.
 * No real database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationSettings: { findFirst: vi.fn(), create: vi.fn() },
    loginSettings: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  getLoginSettings,
  getMaskedNotificationSettings,
  getNotificationSettings,
} from './settings'

const notifFindFirst = vi.mocked(prisma.notificationSettings.findFirst)
const notifCreate = vi.mocked(prisma.notificationSettings.create)
const loginFindFirst = vi.mocked(prisma.loginSettings.findFirst)
const loginCreate = vi.mocked(prisma.loginSettings.create)

const REAL_SECRET = 'super-secret-key'

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings-1',
    resendApiKey: null,
    fromEmail: null,
    arkeselApiKey: null,
    arkeselSenderId: null,
    whatsappAccessToken: null,
    whatsappPhoneNumberId: null,
    whatsappAppSecret: null,
    whatsappWebhookVerifyToken: null,
    whatsappTemplateName: null,
    whatsappLowStockTemplateName: null,
    whatsappTemplateLanguage: null,
    emailEnabled: true,
    smsEnabled: true,
    whatsappEnabled: true,
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

describe('getLoginSettings', () => {
  it('returns the existing row without creating a second one', async () => {
    const row = { id: 'login-1', emailLoginEnabled: true, phoneLoginEnabled: false, updatedAt: new Date() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loginFindFirst.mockResolvedValueOnce(row as any)

    const result = await getLoginSettings()

    expect(result).toEqual(row)
    expect(loginCreate).not.toHaveBeenCalled()
  })

  it('creates a row from schema defaults when none exists yet', async () => {
    loginFindFirst.mockResolvedValueOnce(null)
    const created = { id: 'login-1', emailLoginEnabled: true, phoneLoginEnabled: false, updatedAt: new Date() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loginCreate.mockResolvedValueOnce(created as any)

    const result = await getLoginSettings()

    expect(loginCreate).toHaveBeenCalledWith({ data: {} })
    expect(result).toEqual(created)
  })
})

describe('getMaskedNotificationSettings', () => {
  // The load-bearing test for this whole module: anything returned here is serialized into the
  // page's RSC payload and readable from the browser, so a raw secret must never appear in it.
  it('never contains a stored secret value anywhere in its output', async () => {
    notifFindFirst.mockResolvedValueOnce(
      notificationRow({
        resendApiKey: REAL_SECRET,
        arkeselApiKey: REAL_SECRET,
        whatsappAccessToken: REAL_SECRET,
        whatsappAppSecret: REAL_SECRET,
        whatsappWebhookVerifyToken: REAL_SECRET,
      })
    )

    const masked = await getMaskedNotificationSettings()

    expect(JSON.stringify(masked)).not.toContain(REAL_SECRET)
  })

  it('reports each of the five secret fields as set, independently', async () => {
    notifFindFirst.mockResolvedValueOnce(
      notificationRow({
        resendApiKey: REAL_SECRET,
        arkeselApiKey: null,
        whatsappAccessToken: REAL_SECRET,
        whatsappAppSecret: null,
        whatsappWebhookVerifyToken: REAL_SECRET,
      })
    )

    const masked = await getMaskedNotificationSettings()

    expect(masked.resendApiKeySet).toBe(true)
    expect(masked.arkeselApiKeySet).toBe(false)
    expect(masked.whatsappAccessTokenSet).toBe(true)
    expect(masked.whatsappAppSecretSet).toBe(false)
    expect(masked.whatsappWebhookVerifyTokenSet).toBe(true)
  })

  it('reports every secret as unset on a fresh, unconfigured row', async () => {
    notifFindFirst.mockResolvedValueOnce(notificationRow())

    const masked = await getMaskedNotificationSettings()

    expect(masked.resendApiKeySet).toBe(false)
    expect(masked.arkeselApiKeySet).toBe(false)
    expect(masked.whatsappAccessTokenSet).toBe(false)
    expect(masked.whatsappAppSecretSet).toBe(false)
    expect(masked.whatsappWebhookVerifyTokenSet).toBe(false)
  })

  // Non-secret configuration DOES round-trip — the admin has to see and edit the current values.
  it('round-trips non-secret configuration in full', async () => {
    notifFindFirst.mockResolvedValueOnce(
      notificationRow({
        fromEmail: 'orders@example.com',
        arkeselSenderId: 'Rostty',
        whatsappPhoneNumberId: '123456789012345',
        whatsappTemplateName: 'order_status_update',
        whatsappLowStockTemplateName: 'low_stock_alert',
        whatsappTemplateLanguage: 'en',
        emailEnabled: false,
        smsEnabled: true,
        whatsappEnabled: false,
      })
    )

    const masked = await getMaskedNotificationSettings()

    expect(masked.fromEmail).toBe('orders@example.com')
    expect(masked.arkeselSenderId).toBe('Rostty')
    expect(masked.whatsappPhoneNumberId).toBe('123456789012345')
    expect(masked.whatsappTemplateName).toBe('order_status_update')
    expect(masked.whatsappLowStockTemplateName).toBe('low_stock_alert')
    expect(masked.whatsappTemplateLanguage).toBe('en')
    expect(masked.emailEnabled).toBe(false)
    expect(masked.smsEnabled).toBe(true)
    expect(masked.whatsappEnabled).toBe(false)
  })

  it('exposes no raw-secret-named keys at all', async () => {
    notifFindFirst.mockResolvedValueOnce(notificationRow({ resendApiKey: REAL_SECRET }))

    const masked = await getMaskedNotificationSettings()

    expect(Object.keys(masked)).not.toContain('resendApiKey')
    expect(Object.keys(masked)).not.toContain('arkeselApiKey')
    expect(Object.keys(masked)).not.toContain('whatsappAccessToken')
    expect(Object.keys(masked)).not.toContain('whatsappAppSecret')
    expect(Object.keys(masked)).not.toContain('whatsappWebhookVerifyToken')
  })
})
