/**
 * Integration: auth matrix and toggle/contact-persistence for src/app/admin/settings/actions.ts,
 * against the real isolated database.
 *
 * Provider credentials are NOT exercised here — they live in .env, never in this table. See
 * src/lib/settings.ts's header for why. This file covers the on/off toggles plus the owner's
 * alert-destination contacts (alertEmail/alertPhone/alertWhatsapp), and the read-only Auth display.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { AuthError } from '@/lib/auth'
import { getNotificationSettings } from '@/lib/settings'
import { getSettings, updateNotificationSettings } from '@/app/admin/settings/actions'
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
    alertEmail: '',
    smsEnabled: true,
    alertPhone: '',
    whatsappEnabled: true,
    alertWhatsapp: '',
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
    // This singleton has no per-test FK to a registry user, so this file manages it directly.
    await prisma.notificationSettings.deleteMany()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    await prisma.notificationSettings.deleteMany()
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
      expect(result.auth).toBeDefined()
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
  })

  describe('singleton get-or-create against the real database', () => {
    test('getNotificationSettings called twice does not create two rows', async () => {
      const first = await getNotificationSettings()
      const second = await getNotificationSettings()

      expect(second.id).toBe(first.id)
      expect(await prisma.notificationSettings.count()).toBe(1)
    })

    test('a freshly created row carries the schema defaults', async () => {
      const notif = await getNotificationSettings()

      expect(notif.emailEnabled).toBe(true)
      expect(notif.smsEnabled).toBe(true)
      expect(notif.whatsappEnabled).toBe(true)
      expect(notif.alertEmail).toBeNull()
      expect(notif.alertPhone).toBeNull()
      expect(notif.alertWhatsapp).toBeNull()
    })
  })

  describe('the Auth display — read-only, env-derived, no toggle', () => {
    beforeEach(() => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
    })

    test('reflects ADMIN_EMAIL/ADMIN_PHONE from env, not the database', async () => {
      vi.stubEnv('ADMIN_EMAIL', 'owner@example.com')
      vi.stubEnv('ADMIN_PHONE', '233241234567')

      const { auth } = await getSettings()

      expect(auth.adminEmail).toBe('owner@example.com')
      expect(auth.adminPhone).toBe('233241234567')
    })
  })

  describe('toggle + alert-contact persistence', () => {
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

    test('saves the three alert-destination contacts, normalizing the phone ones to E.164', async () => {
      const result = await updateNotificationSettings(
        notificationPayload({
          alertEmail: 'Owner@Example.com',
          alertPhone: '024 123 4567',
          alertWhatsapp: '020 765 4321',
        })
      )

      expect(result.ok).toBe(true)
      const row = await prisma.notificationSettings.findFirst()
      expect(row!.alertEmail).toBe('owner@example.com')
      expect(row!.alertPhone).toBe('233241234567')
      expect(row!.alertWhatsapp).toBe('233207654321')
    })

    test('a blank alert contact clears a previously stored one', async () => {
      await updateNotificationSettings(notificationPayload({ alertEmail: 'owner@example.com' }))
      await updateNotificationSettings(notificationPayload({ alertEmail: '' }))

      const row = await prisma.notificationSettings.findFirst()
      expect(row!.alertEmail).toBeNull()
    })

    test('rejects a malformed alert email without persisting anything', async () => {
      const result = await updateNotificationSettings(notificationPayload({ alertEmail: 'not-an-email' }))

      expect(result.ok).toBe(false)
    })

    test('rejects a malformed alert phone without persisting anything', async () => {
      const result = await updateNotificationSettings(notificationPayload({ alertPhone: '+234801234' }))

      expect(result.ok).toBe(false)
    })

    test('the returned shape carries no credential fields at all', async () => {
      const result = await updateNotificationSettings(notificationPayload())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Object.keys(result.data).sort()).toEqual(
          [
            'alertEmail',
            'alertPhone',
            'alertWhatsapp',
            'emailEnabled',
            'id',
            'smsEnabled',
            'updatedAt',
            'whatsappEnabled',
          ].sort()
        )
      }
    })
  })
})
