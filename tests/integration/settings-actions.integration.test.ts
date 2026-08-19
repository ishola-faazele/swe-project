/**
 * Integration: auth matrix and toggle-persistence for src/app/admin/settings/actions.ts, against
 * the real isolated database.
 *
 * Provider credentials are NOT exercised here — they live in .env, never in this table. See
 * src/lib/settings.ts's header for why. This file only covers the on/off toggles.
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

function notificationPayload(overrides: Record<string, unknown> = {}) {
  return {
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
      expect(login.emailLoginEnabled).toBe(true)
      // Opt-in on purpose: email-only login stays the default until SMS is verified post-deploy.
      expect(login.phoneLoginEnabled).toBe(false)
    })
  })

  describe('toggle persistence', () => {
    beforeEach(() => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
    })

    test('each channel toggle persists independently', async () => {
      await updateNotificationSettings(
        notificationPayload({ emailEnabled: true, smsEnabled: false, whatsappEnabled: false })
      )

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.emailEnabled).toBe(true)
      expect(row!.smsEnabled).toBe(false)
      expect(row!.whatsappEnabled).toBe(false)
    })

    test('a later save overwrites the previous toggle state, not merges with it', async () => {
      await updateNotificationSettings(notificationPayload({ smsEnabled: false }))
      await updateNotificationSettings(notificationPayload({ smsEnabled: true }))

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.smsEnabled).toBe(true)
    })

    test('the returned shape carries no credential fields at all', async () => {
      const result = await updateNotificationSettings(notificationPayload())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Object.keys(result.data).sort()).toEqual(
          ['emailEnabled', 'id', 'smsEnabled', 'updatedAt', 'whatsappEnabled'].sort()
        )
      }
    })
  })
})
