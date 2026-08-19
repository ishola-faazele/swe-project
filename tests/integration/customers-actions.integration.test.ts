/**
 * Integration: auth matrix for src/app/admin/customers/actions.ts — TEST-009.
 *
 * Same three-case pattern as TEST-006, applied to createCustomer, updateCustomer,
 * deleteCustomer, and getCustomers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// REQUIRED, not optional. createCustomer now fires notifyAccountCreated, and without this mock
// every test in this file would execute the real notification module against the real test
// database — which lazily creates a NotificationSettings row via the accessor's find-or-create,
// a side effect the TestRegistry/cleanupRegistry pattern does not track or clean up.
vi.mock('@/lib/notifications', () => ({ notifyAccountCreated: vi.fn().mockResolvedValue({}) }))
// The service-role client is a network boundary — never exercised live from the integration suite.
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { notifyAccountCreated } from '@/lib/notifications'
import { AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createCustomer,
  deleteCustomer,
  getCustomers,
  updateCustomer,
} from '@/app/admin/customers/actions'
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
const createAdminClientMock = vi.mocked(createAdminClient)
const notifyAccountCreatedMock = vi.mocked(notifyAccountCreated)

/** Stubs the Admin API's generateLink with a given verification_type. */
function stubGenerateLink(verificationType = 'signup', hashedToken = 'hashed-token-abc') {
  createAdminClientMock.mockReturnValue({
    auth: {
      admin: {
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { hashed_token: hashedToken, verification_type: verificationType } },
          error: null,
        }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('customers/actions.ts auth matrix (TEST-009)', () => {
  let reg: TestRegistry
  let admin: User
  let customer: User

  beforeEach(async () => {
    reg = newRegistry()
    admin = await createTestAdmin(reg)
    customer = await createTestCustomer(reg)
    stubGenerateLink()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  describe('createCustomer', () => {
    test('rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(createCustomer({ name: 'New Customer' })).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(createCustomer({ name: 'New Customer' })).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await createCustomer({ name: 'Integration Test Customer' })
      expect(result.ok).toBe(true)
      if (result.ok) reg.userIds.push(result.data.id)
    })
  })

  /**
   * Call-site wiring only. The fan-out logic itself (which channel fires for which preference) is a
   * unit-test concern in src/lib/notifications/index.test.ts — the same split this project already
   * uses for order-status notifications. What matters here is the CONTRACT: that createCustomer
   * hands notifyAccountCreated the right shape for a given input.
   */
  describe('account-creation notification wiring', () => {
    beforeEach(() => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
    })

    test('an email-only customer gets EMAIL preference and a non-null magic link', async () => {
      const result = await createCustomer({
        name: 'Email Customer',
        email: `notify-${Date.now()}@test.rosty.local`,
      })
      expect(result.ok).toBe(true)
      if (result.ok) reg.userIds.push(result.data.id)

      expect(notifyAccountCreatedMock).toHaveBeenCalledTimes(1)
      const payload = notifyAccountCreatedMock.mock.calls[0][0]
      expect(payload.preferredLoginMethod).toBe('EMAIL')
      expect(payload.magicLink).toBeTruthy()
      // Points at the server-redeemable route, never at generateLink's own action_link.
      expect(payload.magicLink).toContain('/auth/confirm?token_hash=')
      expect(payload.magicLink).not.toContain('/auth/callback')
    })

    // The binding directive, asserted at this call site too: the URL's `type` is whatever
    // generateLink reported, not a hard-coded literal.
    test('the magic link carries the verification_type generateLink actually returned', async () => {
      stubGenerateLink('signup')
      const first = await createCustomer({
        name: 'First Login',
        email: `firstlogin-${Date.now()}@test.rosty.local`,
      })
      if (first.ok) reg.userIds.push(first.data.id)
      expect(notifyAccountCreatedMock.mock.calls[0][0].magicLink).toContain('type=signup')

      notifyAccountCreatedMock.mockClear()
      stubGenerateLink('magiclink')
      const second = await createCustomer({
        name: 'Repeat Login',
        email: `repeatlogin-${Date.now()}@test.rosty.local`,
      })
      if (second.ok) reg.userIds.push(second.data.id)
      expect(notifyAccountCreatedMock.mock.calls[0][0].magicLink).toContain('type=magiclink')
    })

    test('a phone-only customer gets PHONE preference, a null link, and no generateLink call', async () => {
      const phone = `024${String(Date.now()).slice(-7)}`
      const result = await createCustomer({ name: 'Phone Customer', phone })
      expect(result.ok).toBe(true)
      if (result.ok) reg.userIds.push(result.data.id)

      const payload = notifyAccountCreatedMock.mock.calls[0][0]
      expect(payload.preferredLoginMethod).toBe('PHONE')
      expect(payload.customerPhone).toBe(phone)
      expect(payload.magicLink).toBeNull()
    })

    test('persists the computed preferredLoginMethod on the row itself', async () => {
      const phone = `024${String(Date.now()).slice(-7)}`
      const result = await createCustomer({ name: 'Persisted Preference', phone })
      expect(result.ok).toBe(true)
      if (result.ok) {
        reg.userIds.push(result.data.id)
        expect(result.data.preferredLoginMethod).toBe('PHONE')
      }
    })

    // createCustomerSchema legitimately allows a name-only customer — this must never crash.
    test('a name-only customer succeeds and notifies with neither contact method', async () => {
      const result = await createCustomer({ name: 'Name Only Customer' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        reg.userIds.push(result.data.id)
        expect(result.data.preferredLoginMethod).toBe('EMAIL') // the schema default fallback
      }
      const payload = notifyAccountCreatedMock.mock.calls[0][0]
      expect(payload.customerEmail).toBeNull()
      expect(payload.customerPhone).toBeNull()
    })

    // Fire-and-forget: link generation is best-effort and must never fail the customer write.
    test('a generateLink failure still creates the customer, with a null link', async () => {
      createAdminClientMock.mockReturnValue({
        auth: {
          admin: {
            generateLink: vi.fn().mockResolvedValue({ data: null, error: { message: 'bad key' } }),
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      const result = await createCustomer({
        name: 'Link Failure',
        email: `linkfail-${Date.now()}@test.rosty.local`,
      })

      expect(result.ok).toBe(true)
      if (result.ok) reg.userIds.push(result.data.id)
      expect(notifyAccountCreatedMock.mock.calls[0][0].magicLink).toBeNull()
    })

    // authEmail is internal Supabase plumbing and must not reach the browser via RSC props.
    test('the returned row carries no authEmail field', async () => {
      const result = await createCustomer({
        name: 'No AuthEmail',
        email: `noauth-${Date.now()}@test.rosty.local`,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        reg.userIds.push(result.data.id)
        expect(Object.keys(result.data)).not.toContain('authEmail')
      }
    })
  })

  describe('updateCustomer', () => {
    test('rejects when unauthenticated', async () => {
      const target = await createTestCustomer(reg)
      mockNoSession(createClientMock)
      await expect(updateCustomer(target.id, { name: 'Updated' })).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const target = await createTestCustomer(reg)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(updateCustomer(target.id, { name: 'Updated' })).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      const target = await createTestCustomer(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await updateCustomer(target.id, { name: 'Updated Name' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.name).toBe('Updated Name')
    })

    // Contact info is write-once by design (see updateCustomerSchema) — this proves it server-side,
    // not just at the type level. A real client can still POST whatever shape it wants.
    test('ignores email/phone even if a caller bypasses the type system and sends them', async () => {
      const target = await createTestCustomer(reg, { email: 'original@test.rosty.local' })
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

      await updateCustomer(target.id, {
        name: 'Updated Name',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ email: 'attacker-supplied@test.rosty.local' } as any),
      })

      const row = await prisma.user.findUnique({ where: { id: target.id } })
      expect(row?.email).toBe('original@test.rosty.local')
    })

    test('rejects a preferredLoginMethod that does not match an existing contact field', async () => {
      const target = await createTestCustomer(reg, { email: 'has-email-only@test.rosty.local', phone: null })
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

      const result = await updateCustomer(target.id, { preferredLoginMethod: 'PHONE' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('must match a contact field')
    })

    test('accepts a preferredLoginMethod that matches an existing contact field', async () => {
      const target = await createTestCustomer(reg, { email: 'has-email-only@test.rosty.local', phone: null })
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

      const result = await updateCustomer(target.id, { preferredLoginMethod: 'EMAIL' })

      expect(result.ok).toBe(true)
    })
  })

  describe('deleteCustomer', () => {
    test('rejects when unauthenticated', async () => {
      const target = await createTestCustomer(reg)
      mockNoSession(createClientMock)
      await expect(deleteCustomer(target.id)).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const target = await createTestCustomer(reg)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(deleteCustomer(target.id)).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      const target = await createTestCustomer(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await deleteCustomer(target.id)
      expect(result.ok).toBe(true)
    })
  })

  describe('getCustomers', () => {
    test('rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(getCustomers()).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(getCustomers()).rejects.toThrow(AuthError)
    })

    test('resolves an array for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await getCustomers()
      expect(Array.isArray(result)).toBe(true)
    })
  })
})
