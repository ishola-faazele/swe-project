/**
 * Integration: auth matrix for src/app/admin/customers/actions.ts — TEST-009.
 *
 * Same three-case pattern as TEST-006, applied to createCustomer, updateCustomer,
 * deleteCustomer, and getCustomers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { AuthError } from '@/lib/auth'
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

describe('customers/actions.ts auth matrix (TEST-009)', () => {
  let reg: TestRegistry
  let admin: User
  let customer: User

  beforeEach(async () => {
    reg = newRegistry()
    admin = await createTestAdmin(reg)
    customer = await createTestCustomer(reg)
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
      const result = await updateCustomer(target.id, {
        name: 'Updated Name',
        email: target.email ?? undefined,
        phone: target.phone ?? undefined,
      })
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
