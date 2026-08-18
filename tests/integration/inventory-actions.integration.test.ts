/**
 * Integration: auth matrix for src/app/admin/inventory/actions.ts — TEST-008.
 *
 * Same three-case pattern as TEST-006, applied to createInventoryItem, updateInventoryItem,
 * deleteInventoryItem, getInventoryItems, and — added by TEST-008 — toggleInventoryItemActive.
 * updateInventoryItem has no frontend call site (BE-014) but the auth requirement still applies
 * regardless of UI reachability.
 *
 * The pre-existing deleteInventoryItem/getInventoryItems cases were reviewed against BE-005's
 * behavior change and needed no inverted assertions: the delete case here uses an unreferenced
 * fixture, which still hard-deletes. Archive-on-conflict is covered in
 * fk-guarded-deletes.integration.test.ts; the new active-only filtering cases are below.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItems,
  toggleInventoryItemActive,
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
      // Unaffected by BE-005's archive branch: this fixture is referenced by neither
      // OrderIngredientLog nor DishIngredient, so it still takes the hard-delete path. The
      // archive-instead-of-delete cases live in fk-guarded-deletes.integration.test.ts.
      if (result.ok) expect(result.data.archived).toBe(false)
    })
  })

  describe('toggleInventoryItemActive', () => {
    test('rejects when unauthenticated', async () => {
      const item = await createTestInventoryItem(reg)
      mockNoSession(createClientMock)
      await expect(toggleInventoryItemActive(item.id, false)).rejects.toThrow(AuthError)
    })

    test('rejects for a CUSTOMER session', async () => {
      const item = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
      await expect(toggleInventoryItemActive(item.id, false)).rejects.toThrow(AuthError)
    })

    test('succeeds for an ADMIN session', async () => {
      const item = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

      const result = await toggleInventoryItemActive(item.id, false)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.isActive).toBe(false)
    })

    test('restores an archived item unconditionally — restoring references nothing', async () => {
      const item = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      await toggleInventoryItemActive(item.id, false)

      const result = await toggleInventoryItemActive(item.id, true)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.isActive).toBe(true)
      const persisted = await prisma.inventoryItem.findUnique({ where: { id: item.id } })
      expect(persisted?.isActive).toBe(true)
    })

    test('rejects a malformed id through idSchema rather than reaching the database', async () => {
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      const result = await toggleInventoryItemActive('not-a-uuid', false)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
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

    // BE-005 made active-only the DEFAULT, which is what keeps archived items out of every
    // picker (recipe builder, extra-ingredients editor) with no change at those call sites.
    test('excludes archived items by default', async () => {
      const active = await createTestInventoryItem(reg)
      const archived = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      await toggleInventoryItemActive(archived.id, false)

      const ids = (await getInventoryItems()).map(i => i.id)

      expect(ids).toContain(active.id)
      expect(ids).not.toContain(archived.id)
    })

    test('includes archived items when explicitly asked — the inventory screen’s reveal toggle', async () => {
      const active = await createTestInventoryItem(reg)
      const archived = await createTestInventoryItem(reg)
      mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
      await toggleInventoryItemActive(archived.id, false)

      const ids = (await getInventoryItems({ includeArchived: true })).map(i => i.id)

      expect(ids).toContain(active.id)
      expect(ids).toContain(archived.id)
    })
  })
})
