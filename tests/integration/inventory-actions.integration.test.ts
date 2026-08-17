/**
 * Integration: auth matrix for src/app/admin/inventory/actions.ts — TEST-008.
 *
 * Same three-case pattern as TEST-006, applied to createInventoryItem, updateInventoryItem,
 * deleteInventoryItem, and getInventoryItems. updateInventoryItem has no frontend call site
 * (BE-014) but the auth requirement still applies regardless of UI reachability.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { AuthError } from '@/lib/auth'
import {
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItems,
  updateInventoryItem,
} from '@/app/admin/inventory/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestInventoryItem,
  mockAuthSession,
  mockNoSession,
  newRegistry,
  type TestRegistry,
} from './helpers'
import type { InventoryItem, User } from '@prisma/client'

const createClientMock = vi.mocked(createClient)

describe('inventory/actions.ts auth matrix (TEST-008)', () => {
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

  describe('createInventoryItem', () => {
    test('rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(
        createInventoryItem({ name: 'x', currentStock: 1, unit: 'kg', category: 'INGREDIENT' })
      ).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(
        createInventoryItem({ name: 'x', currentStock: 1, unit: 'kg', category: 'INGREDIENT' })
      ).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await createInventoryItem({
        name: 'Integration Test Item',
        currentStock: 10,
        unit: 'kg',
        category: 'INGREDIENT',
      })
      expect(result.ok).toBe(true)
      if (result.ok) reg.inventoryItemIds.push(result.data.id)
    })
  })

  describe('updateInventoryItem', () => {
    test('rejects when unauthenticated', async () => {
      const item = await createTestInventoryItem(reg)
      mockNoSession(createClientMock)
      await expect(updateInventoryItem(item.id, { currentStock: 5 })).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const item = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(updateInventoryItem(item.id, { currentStock: 5 })).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      const item = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await updateInventoryItem(item.id, { currentStock: 5 })
      expect(result.ok).toBe(true)
    })
  })

  describe('deleteInventoryItem', () => {
    test('rejects when unauthenticated', async () => {
      const item = await createTestInventoryItem(reg)
      mockNoSession(createClientMock)
      await expect(deleteInventoryItem(item.id)).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const item = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(deleteInventoryItem(item.id)).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      const item: InventoryItem = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await deleteInventoryItem(item.id)
      expect(result.ok).toBe(true)
    })
  })

  describe('getInventoryItems', () => {
    test('rejects when unauthenticated', async () => {
      mockNoSession(createClientMock)
      await expect(getInventoryItems()).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(getInventoryItems()).rejects.toThrow(AuthError)
    })

    test('resolves an array for an ADMIN session', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await getInventoryItems()
      expect(Array.isArray(result)).toBe(true)
    })
  })
})
