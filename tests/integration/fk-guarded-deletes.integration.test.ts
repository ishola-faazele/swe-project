/**
 * Integration: FK-referenced-delete paths — TEST-011, revised by TEST-007, revised again for the
 * Phase 1 customer active/inactive toggle.
 *
 * deleteCustomer now archives (isActive: false) instead of hard-failing when the target has
 * existing orders — unifying it with deleteInventoryItem/deleteDish's existing archive-instead-
 * of-erroring behavior, rather than the earlier deliberate "customer is a hard stop" split. All
 * three entities that can be FK-referenced now converge on the same contract: archive when
 * referenced, hard-delete when not, never throw a raw P2003. `toggleCustomerActive` remains the
 * explicit, separate action for manually archiving/restoring a customer with no orders at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { deleteCustomer } from '@/app/admin/customers/actions'
import { deleteInventoryItem } from '@/app/admin/inventory/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestInventoryItem,
  createTestOrder,
  mockAuthSession,
  newRegistry,
  type TestRegistry,
} from './helpers'
import { cleanupFixtures, createDishWithRecipe, uniqueName } from '../../test/helpers/fixtures'

const createClientMock = vi.mocked(createClient)

describe('FK-referenced-delete paths (TEST-011, revised by TEST-007)', () => {
  let reg: TestRegistry
  let dishIds: string[]

  beforeEach(() => {
    reg = newRegistry()
    dishIds = []
  })

  afterEach(async () => {
    vi.clearAllMocks()
    // Dish fixtures FIRST: a DishIngredient row pointing at one of this registry's
    // InventoryItems would otherwise block cleanupRegistry's inventoryItem delete. See the
    // ordering note in helpers.ts's cleanupRegistry docblock.
    await cleanupFixtures({ dishIds })
    await cleanupRegistry(reg)
  })

  test('deleteCustomer ARCHIVES a customer referenced by orders instead of erroring', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    await createTestOrder(reg, customer.id)
    await createTestOrder(reg, customer.id)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const result = await deleteCustomer(customer.id)

    expect(result).toMatchObject({ ok: true, data: { archived: true } })

    // The row still exists — but now because it was deliberately archived, not because the
    // delete was rejected. isActive is what actually proves the new behavior, same shape as the
    // deleteInventoryItem archive assertions below.
    const persisted = await prisma.user.findUnique({ where: { id: customer.id } })
    expect(persisted).not.toBeNull()
    expect(persisted?.isActive).toBe(false)
  })

  test('deleteCustomer still HARD-DELETES a customer nothing references', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const result = await deleteCustomer(customer.id)

    expect(result).toMatchObject({ ok: true, data: { archived: false } })
    expect(await prisma.user.findUnique({ where: { id: customer.id } })).toBeNull()
  })

  test('deleteInventoryItem ARCHIVES an item referenced by an order instead of erroring', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg)
    await createTestOrder(reg, customer.id, [{ inventoryItemId: item.id, quantityUsed: 1 }])
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const result = await deleteInventoryItem(item.id)

    expect(result).toMatchObject({ ok: true, data: { archived: true } })

    // The row still exists — but now because it was deliberately archived, NOT because the
    // delete was rejected. Same assertion as before BE-005, entirely different reason, so the
    // isActive flag is what actually proves the new behavior.
    const persisted = await prisma.inventoryItem.findUnique({ where: { id: item.id } })
    expect(persisted).not.toBeNull()
    expect(persisted?.isActive).toBe(false)
  })

  /**
   * The exact case the pre-BE-005 code got wrong. DishIngredient.inventoryItem is RESTRICT just
   * like OrderIngredientLog.inventoryItem, but the old pre-check counted only the latter — so an
   * ingredient a recipe calls for that had never actually been ordered slipped through and blew
   * up on a raw P2003 at the database.
   */
  test('deleteInventoryItem archives an item referenced ONLY by a recipe, never ordered', async () => {
    const admin = await createTestAdmin(reg)
    const item = await createTestInventoryItem(reg)
    const dish = await createDishWithRecipe(uniqueName('Recipe Only Dish'), 500, [
      { inventoryItemId: item.id, quantityPerDish: 0.5 },
    ])
    dishIds.push(dish.id)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    // Precondition: this item is genuinely unordered, so ONLY the DishIngredient count can
    // possibly catch it. Without the second count the action would reach prisma.delete().
    expect(await prisma.orderIngredientLog.count({ where: { inventoryItemId: item.id } })).toBe(0)

    const result = await deleteInventoryItem(item.id)

    expect(result).toMatchObject({ ok: true, data: { archived: true } })

    const persisted = await prisma.inventoryItem.findUnique({ where: { id: item.id } })
    expect(persisted?.isActive).toBe(false)
  })

  test('deleteInventoryItem still HARD-DELETES an item nothing references', async () => {
    const admin = await createTestAdmin(reg)
    const item = await createTestInventoryItem(reg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const result = await deleteInventoryItem(item.id)

    expect(result).toMatchObject({ ok: true, data: { archived: false } })
    expect(await prisma.inventoryItem.findUnique({ where: { id: item.id } })).toBeNull()
  })
})
