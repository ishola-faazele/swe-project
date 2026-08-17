/**
 * Integration: insufficient-stock expected-error paths — TEST-010.
 *
 * createOrder and updateOrderItems both resolve (never reject) to
 * { ok: false, code: 'INSUFFICIENT_STOCK' } when requested quantity exceeds available stock,
 * with no partial write left behind. Asserted with .resolves.toMatchObject(...), never
 * .rejects — insufficient stock is an expected business failure, not an exception.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue({}),
  notifyLowStock: vi.fn().mockResolvedValue({}),
}))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { createOrder } from '@/app/admin/orders/actions'
import { updateOrderItems } from '@/app/admin/orders/[id]/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestInventoryItem,
  mockAuthSession,
  newRegistry,
  type TestRegistry,
} from './helpers'
import { createDishWithRecipe } from '../../test/helpers/fixtures'

const createClientMock = vi.mocked(createClient)

describe('insufficient-stock expected-error paths (TEST-010)', () => {
  let reg: TestRegistry
  let dishIds: string[]

  beforeEach(() => {
    reg = newRegistry()
    dishIds = []
  })

  afterEach(async () => {
    vi.clearAllMocks()
    // OrderDish rows on this registry's orders reference Dish rows (must clear before Dish can
    // be deleted); DishIngredient rows reference this registry's InventoryItem ids (must clear
    // before cleanupRegistry tries to delete those items). Order matters both ways.
    if (reg.orderIds.length) {
      await prisma.orderDish.deleteMany({ where: { orderId: { in: reg.orderIds } } })
    }
    if (dishIds.length) {
      await prisma.dishIngredient.deleteMany({ where: { dishId: { in: dishIds } } })
      await prisma.dish.deleteMany({ where: { id: { in: dishIds } } })
    }
    await cleanupRegistry(reg)
  })

  test('createOrder resolves { ok: false, code: INSUFFICIENT_STOCK } without writing an Order row or touching stock', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg, { currentStock: 10 })
    // 1 unit of `item` per dish; ordering 999 of the dish requests 999 units, well past stock.
    const dish = await createDishWithRecipe('Stock-exceeding dish', 10, [
      { inventoryItemId: item.id, quantityPerDish: 1 },
    ])
    dishIds.push(dish.id)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const stockBefore = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    const orderCountBefore = await prisma.order.count({ where: { customerId: customer.id } })

    await expect(
      createOrder({
        customerId: customer.id,
        description: 'Requests way more than available',
        totalPrice: 100,
        dishes: [{ dishId: dish.id, quantity: 999 }],
      })
    ).resolves.toMatchObject({ ok: false, code: 'INSUFFICIENT_STOCK' })

    const stockAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(stockAfter.currentStock).toBe(stockBefore.currentStock)

    const orderCountAfter = await prisma.order.count({ where: { customerId: customer.id } })
    expect(orderCountAfter).toBe(orderCountBefore)
  })

  test('updateOrderItems resolves { ok: false, code: INSUFFICIENT_STOCK } and leaves the original logs/stock untouched', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg, { currentStock: 10 })
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    // extraIngredients takes raw { inventoryItemId, quantityUsed } lines directly — no dish
    // recipe needed to reproduce "the admin manually adds 8, then tries to bump it to 999".
    const created = await createOrder({
      customerId: customer.id,
      description: 'Initial order using 8 of 10',
      totalPrice: 50,
      dishes: [],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const initial = await updateOrderItems(created.data.id, {
      dishes: [],
      extraIngredients: [{ inventoryItemId: item.id, quantityUsed: 8 }],
      totalPrice: 50,
    })
    if (!initial.ok) throw new Error('fixture setup failed: ' + initial.error)

    const stockAfterCreate = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(stockAfterCreate.currentStock).toBe(2) // 10 - 8

    const logsBefore = await prisma.orderIngredientLog.findMany({
      where: { orderId: created.data.id },
    })

    // After accounting for the order's own already-logged 8 units (which the revert-then-
    // reapply logic would credit back to 10 before re-deducting), 999 still exceeds available
    // stock — must fail without leaving any partial write.
    await expect(
      updateOrderItems(created.data.id, {
        dishes: [],
        extraIngredients: [{ inventoryItemId: item.id, quantityUsed: 999 }],
        totalPrice: 50,
      })
    ).resolves.toMatchObject({ ok: false, code: 'INSUFFICIENT_STOCK' })

    const stockAfterFailedUpdate = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    })
    expect(stockAfterFailedUpdate.currentStock).toBe(stockAfterCreate.currentStock)

    const logsAfter = await prisma.orderIngredientLog.findMany({
      where: { orderId: created.data.id },
    })
    expect(logsAfter).toEqual(logsBefore)
  })
})
