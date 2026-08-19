/**
 * Integration: auth matrix and blank-secret semantics for src/app/admin/settings/actions.ts,
 * against the real isolated database.
 *
 * The load-bearing case here is "a blank secret field must not clobber a stored value" — the
 * Settings UI cannot display a stored secret, so most saves arrive with those fields empty, and
 * getting this backwards would silently wipe a live credential on every unrelated edit.
 *
 * NOTE: unlike every other file in this suite, `@/lib/settings` is NOT mocked — these tests
 * exercise the real find-or-create singleton behavior against real rows.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { AuthError } from '@/lib/auth'
import { getLoginSettings, getNotificationSettings } from '@/lib/settings'
import {
  getSettings,
  updateLoginSettings,
  updateNotificationSettings,
} from '@/app/admin/settings/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  mockAuthSession,
  mockNoSession,
  newRegistry,
  type TestRegistry,
} from './helpers'
import type { User } from '@prisma/client'

const createClientMock = vi.mocked(createClient)

const REAL_SECRET = 'sk_live_a-real-looking-secret'

/** A complete, valid notification-settings payload — every field the schema requires. */
function notificationPayload(overrides: Record<string, unknown> = {}) {
  return {
    resendApiKey: '',
    fromEmail: 'orders@example.com',
    arkeselApiKey: '',
    arkeselSenderId: 'Rostty',
    whatsappAccessToken: '',
    whatsappPhoneNumberId: '123456789012345',
    whatsappAppSecret: '',
    whatsappWebhookVerifyToken: '',
    whatsappTemplateName: 'order_status_update',
    whatsappLowStockTemplateName: 'low_stock_alert',
    whatsappTemplateLanguage: 'en',
    emailEnabled: true,
    smsEnabled: true,
    whatsappEnabled: true,
    ...overrides,
  }
}

describe('settings/actions.ts', () => {
  let reg: TestRegistry
  let admin: User
  let customer: User

  beforeEach(async () => {
    reg = newRegistry()
    admin = await createTestAdmin(reg)
    customer = await createTestCustomer(reg)
    // These singletons have no per-test FK to a registry user, so this file manages them directly.
    await prisma.notificationSettings.deleteMany()
    await prisma.loginSettings.deleteMany()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await prisma.notificationSettings.deleteMany()
    await prisma.loginSettings.deleteMany()
    await cleanupRegistry(reg)
  })

  describe('auth matrix', () => {
    test('getSettings rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(getSettings()).rejects.toThrow(AuthError)
    })

    test('getSettings rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(getSettings()).rejects.toThrow(AuthError)
    })

    test('getSettings resolves both shapes for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await getSettings()

      expect(result.notifications).toBeDefined()
      expect(result.login).toBeDefined()
    })

    test('updateNotificationSettings rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(updateNotificationSettings(notificationPayload())).rejects.toThrow(AuthError)
    })

    test('updateNotificationSettings rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(updateNotificationSettings(notificationPayload())).rejects.toThrow(AuthError)
    })

    test('updateNotificationSettings succeeds for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await updateNotificationSettings(notificationPayload())

      expect(result.ok).toBe(true)
    })

    test('updateLoginSettings rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(
        updateLoginSettings({ emailLoginEnabled: true, phoneLoginEnabled: true })
      ).rejects.toThrow(AuthError)
    })

    test('updateLoginSettings rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(
        updateLoginSettings({ emailLoginEnabled: true, phoneLoginEnabled: true })
      ).rejects.toThrow(AuthError)
    })

    test('updateLoginSettings succeeds for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await updateLoginSettings({
        emailLoginEnabled: true,
        phoneLoginEnabled: true,
      })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.phoneLoginEnabled).toBe(true)
    })
  })

  describe('singleton get-or-create against the real database', () => {
    test('getNotificationSettings called twice does not create two rows', async () => {
      const first = await getNotificationSettings()
      const second = await getNotificationSettings()

      expect(second.id).toBe(first.id)
      expect(await prisma.notificationSettings.count()).toBe(1)
    })

    test('getLoginSettings called twice does not create two rows', async () => {
      const first = await getLoginSettings()
      const second = await getLoginSettings()

      expect(second.id).toBe(first.id)
      expect(await prisma.loginSettings.count()).toBe(1)
    })

    test('a freshly created row carries the schema defaults', async () => {
      const notif = await getNotificationSettings()
      const login = await getLoginSettings()

      expect(notif.emailEnabled).toBe(true)
      expect(notif.smsEnabled).toBe(true)
      expect(notif.whatsappEnabled).toBe(true)
      expect(notif.arkeselApiKey).toBeNull()
      expect(login.emailLoginEnabled).toBe(true)
      // Opt-in on purpose: email-only login stays the default until SMS is verified post-deploy.
      expect(login.phoneLoginEnabled).toBe(false)
    })
  })

  describe('blank secret fields keep the stored value', () => {
    beforeEach(() => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
    })

    test('saving a real secret, then saving again with that field blank, leaves it intact', async () => {
      await updateNotificationSettings(notificationPayload({ arkeselApiKey: REAL_SECRET }))
      const afterFirst = await prisma.notificationSettings.findFirst()
      expect(afterFirst!.arkeselApiKey).toBe(REAL_SECRET)

      // The realistic case: the admin edits the sender ID and never touches the key field.
      await updateNotificationSettings(
        notificationPayload({ arkeselApiKey: '', arkeselSenderId: 'ChangedSender' })
      )

      const afterSecond = await prisma.notificationSettings.findFirst()
      expect(afterSecond!.arkeselApiKey).toBe(REAL_SECRET) // preserved
      expect(afterSecond!.arkeselSenderId).toBe('ChangedSender') // non-secret did overwrite
    })

    test('a whitespace-only secret field also counts as blank', async () => {
      await updateNotificationSettings(notificationPayload({ arkeselApiKey: REAL_SECRET }))

      await updateNotificationSettings(notificationPayload({ arkeselApiKey: '   ' }))

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.arkeselApiKey).toBe(REAL_SECRET)
    })

    test('a non-blank secret field overwrites the stored value', async () => {
      await updateNotificationSettings(notificationPayload({ arkeselApiKey: REAL_SECRET }))

      await updateNotificationSettings(notificationPayload({ arkeselApiKey: 'sk_live_rotated' }))

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.arkeselApiKey).toBe('sk_live_rotated')
    })

    test('all five secret fields independently follow blank-means-keep', async () => {
      await updateNotificationSettings(
        notificationPayload({
          resendApiKey: 'resend-secret',
          arkeselApiKey: 'arkesel-secret',
          whatsappAccessToken: 'whatsapp-token',
          whatsappAppSecret: 'app-secret',
          whatsappWebhookVerifyToken: 'verify-token',
        })
      )

      // Rotate exactly one, leave the rest blank.
      await updateNotificationSettings(
        notificationPayload({ whatsappAppSecret: 'app-secret-rotated' })
      )

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.resendApiKey).toBe('resend-secret')
      expect(row!.arkeselApiKey).toBe('arkesel-secret')
      expect(row!.whatsappAccessToken).toBe('whatsapp-token')
      expect(row!.whatsappAppSecret).toBe('app-secret-rotated')
      expect(row!.whatsappWebhookVerifyToken).toBe('verify-token')
    })

    // Non-secrets DO round-trip through the UI, so blanking one is a legitimate edit.
    test('a blank non-secret field genuinely clears it', async () => {
      await updateNotificationSettings(notificationPayload({ fromEmail: 'orders@example.com' }))

      await updateNotificationSettings(notificationPayload({ fromEmail: '' }))

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.fromEmail).toBeNull()
    })

    test('the returned shape is masked — no stored secret comes back to the caller', async () => {
      const result = await updateNotificationSettings(
        notificationPayload({ arkeselApiKey: REAL_SECRET })
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(JSON.stringify(result.data)).not.toContain(REAL_SECRET)
        expect(result.data.arkeselApiKeySet).toBe(true)
      }
    })

    test('channel toggles persist independently of credentials', async () => {
      await updateNotificationSettings(
        notificationPayload({
          arkeselApiKey: REAL_SECRET,
          smsEnabled: false,
          emailEnabled: true,
          whatsappEnabled: false,
        })
      )

      const row = await prisma.notificationSettings.findFirst()
      // Credentials present but the channel is off — the two are genuinely independent.
      expect(row!.arkeselApiKey).toBe(REAL_SECRET)
      expect(row!.smsEnabled).toBe(false)
      expect(row!.emailEnabled).toBe(true)
      expect(row!.whatsappEnabled).toBe(false)
    })
  })
})
