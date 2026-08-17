/**
 * Integration: auth matrix for src/app/admin/orders/actions.ts — TEST-006.
 *
 * For createOrder, updateOrderStatus, deleteOrder, and getOrders: an unauthenticated call
 * rejects, a call from an authenticated CUSTOMER-role session rejects, and a call from an
 * authenticated ADMIN session succeeds. Runs against the real isolated database; only the
 * Supabase auth session is mocked (see tests/integration/helpers.ts).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue({}),
  notifyLowStock: vi.fn().mockResolvedValue({}),
}))

import { createClient } from '@/utils/supabase/server'
import { AuthError } from '@/lib/auth'
import { createOrder, deleteOrder, getOrders, updateOrderStatus } from '@/app/admin/orders/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestOrder,
  mockAuthSession,
  mockNoSession,
  newRegistry,
  type TestRegistry,
} from './helpers'
import type { User } from '@prisma/client'

const createClientMock = vi.mocked(createClient)

describe('orders/actions.ts auth matrix (TEST-006)', () => {
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

  describe('createOrder', () => {
    test('rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(
        createOrder({ customerId: customer.id, description: 'x', totalPrice: 1, ingredients: [] })
      ).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(
        createOrder({ customerId: customer.id, description: 'x', totalPrice: 1, ingredients: [] })
      ).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await createOrder({
        customerId: customer.id,
        description: 'Integration test order',
        totalPrice: 42,
        ingredients: [],
      })
      expect(result.ok).toBe(true)
      if (result.ok) reg.orderIds.push(result.data.id)
    })
  })

  describe('updateOrderStatus', () => {
    test('rejects when unauthenticated', async () => {
      const order = await createTestOrder(reg, customer.id)
      mockNoSession(createClientMock)
      await expect(updateOrderStatus(order.id, 'PREPPING')).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const order = await createTestOrder(reg, customer.id)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(updateOrderStatus(order.id, 'PREPPING')).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      const order = await createTestOrder(reg, customer.id)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await updateOrderStatus(order.id, 'PREPPING')
      expect(result.ok).toBe(true)
    })
  })

  describe('deleteOrder', () => {
    test('rejects when unauthenticated', async () => {
      const order = await createTestOrder(reg, customer.id)
      mockNoSession(createClientMock)
      await expect(deleteOrder(order.id)).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const order = await createTestOrder(reg, customer.id)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(deleteOrder(order.id)).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session on a freshly-created fixture order', async () => {
      const order = await createTestOrder(reg, customer.id)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await deleteOrder(order.id)
      expect(result.ok).toBe(true)
    })
  })

  describe('getOrders', () => {
    test('rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(getOrders()).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(getOrders()).rejects.toThrow(AuthError)
    })

    test('resolves an array for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await getOrders()
      expect(Array.isArray(result)).toBe(true)
    })
  })
})
