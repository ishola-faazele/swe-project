/**
 * Narrow/wide integration tests for `updateOrderItems`, run against the REAL local Supabase
 * Postgres instance via the same `prisma` singleton the app uses. The TDD calls the
 * revert-then-reapply transaction here "the highest-risk test in this feature" — getting the
 * ordering right (revert increments -> delete old logs + OrderDish -> re-read fresh dishes ->
 * recreate -> reapply) is the crux of this file.
 *
 * Stubs: `@/utils/supabase/server` (updateOrderItems now requires an ADMIN session via
 * requireAdmin(), added during the Phase 0 + Phase 2 merge — auth-matrix coverage itself lives
 * in order-ingredients-actions.integration.test.ts) and `next/cache` (revalidatePath needs a
 * Next request context). This action doesn't touch notifications, so nothing else is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { cleanupFixtures, createCustomer, createDishWithRecipe, createInventoryItem, uniqueName } from '../../test/helpers/fixtures'
import { updateOrderItems } from '@/app/admin/orders/[id]/actions'
import { createTestAdmin, mockAuthSession, newRegistry, cleanupRegistry, type TestRegistry } from './helpers'
import { randomUUID } from 'node:crypto'

const createClientMock = vi.mocked(createClient)

describe('updateOrderItems (integration)', () => {
  let inventoryItemIds: string[]
  let dishIds: string[]
  let orderIds: string[]
  let userIds: string[]
  let adminReg: TestRegistry

  beforeEach(async () => {
    inventoryItemIds = []
    dishIds = []
    orderIds = []
    userIds = []
    adminReg = newRegistry()
    const admin = await createTestAdmin(adminReg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupFixtures({ orderIds, dishIds, inventoryItemIds, userIds })
    await cleanupRegistry(adminReg)
  })

  /** Seeds an order the long way (bypassing createOrder) so each test controls its starting
   * OrderIngredientLog/OrderDish rows and the InventoryItem's currentStock precisely. */
  async function seedOrderWithLog(inventoryItemId: string, quantityUsed: number, orderPrice = 0) {
    const customer = await createCustomer()
    userIds.push(customer.id)
    const order = await prisma.order.create({
      data: { customerId: customer.id, description: 'seed order', totalPrice: orderPrice },
    })
    orderIds.push(order.id)
    await prisma.orderIngredientLog.create({
      data: { orderId: order.id, inventoryItemId, quantityUsed },
    })
    await prisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { currentStock: { decrement: quantityUsed } },
    })
    return order
  }

  it('reverts old inventory deductions and deletes old logs/OrderDish before writing new ones', async () => {
    const rice = await createInventoryItem({ currentStock: 80 })
    inventoryItemIds.push(rice.id)
    const dishA = await createDishWithRecipe(uniqueName('Dish A'), 100, [{ inventoryItemId: rice.id, quantityPerDish: 0.5 }])
    const dishB = await createDishWithRecipe(uniqueName('Dish B'), 200, [{ inventoryItemId: rice.id, quantityPerDish: 1 }])
    dishIds.push(dishA.id, dishB.id)
    // Order starts with 2 units of "raw" rice logged directly (as if placed pre-Menu).
    const order = await seedOrderWithLog(rice.id, 2)
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })).currentStock).toBe(78)

    const result = await updateOrderItems(order.id, {
      dishes: [{ dishId: dishA.id, quantity: 2 }], // 1.0 rice
      extraIngredients: [],
      totalPrice: 200,
    })
    expect(result.ok).toBe(true)

    // Reverted the old 2, then deducted the new 1.0 -> net 80 - 1 = 79.
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })
    expect(item.currentStock).toBeCloseTo(79)

    const logs = await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].quantityUsed).toBeCloseTo(1)

    const orderDishes = await prisma.orderDish.findMany({ where: { orderId: order.id } })
    expect(orderDishes).toHaveLength(1)
    expect(orderDishes[0]).toMatchObject({ dishId: dishA.id, dishName: dishA.name, unitPrice: dishA.price, quantity: 2 })
  })

  it('calling updateOrderItems twice in a row nets currentStock correctly — not double-deducted, not under-reverted', async () => {
    const rice = await createInventoryItem({ currentStock: 80 })
    inventoryItemIds.push(rice.id)
    const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }])
    dishIds.push(dish.id)
    const order = await seedOrderWithLog(rice.id, 0) // start with an order, zero deductions yet

    const payload = { dishes: [{ dishId: dish.id, quantity: 4 }], extraIngredients: [], totalPrice: 4800 } // 1.0 rice

    const first = await updateOrderItems(order.id, payload)
    expect(first.ok).toBe(true)
    const afterFirst = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })
    expect(afterFirst.currentStock).toBeCloseTo(79) // 80 - 1.0

    const second = await updateOrderItems(order.id, payload)
    expect(second.ok).toBe(true)
    const afterSecond = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })
    // Saving the identical selection again must revert the 1.0 it just applied, then reapply the
    // same 1.0 — net unchanged, not an additional -1.0 (double-deducted) or +1.0 (under-reverted).
    expect(afterSecond.currentStock).toBeCloseTo(79)

    const logs = await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].quantityUsed).toBeCloseTo(1)
  })

  it('an item that drops out of the selection entirely reverts FULLY to baseline', async () => {
    const rice = await createInventoryItem({ currentStock: 80 })
    const chicken = await createInventoryItem({ currentStock: 40 })
    inventoryItemIds.push(rice.id, chicken.id)
    const friedRice = await createDishWithRecipe(uniqueName('Fried Rice'), 1300, [
      { inventoryItemId: rice.id, quantityPerDish: 0.25 },
      { inventoryItemId: chicken.id, quantityPerDish: 0.1 },
    ])
    dishIds.push(friedRice.id)
    const order = await seedOrderWithLog(rice.id, 0)

    // First save: 2x Fried Rice deducts 0.5 rice + 0.2 chicken.
    const firstSave = await updateOrderItems(order.id, { dishes: [{ dishId: friedRice.id, quantity: 2 }], extraIngredients: [], totalPrice: 2600 })
    expect(firstSave.ok).toBe(true)
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: chicken.id } })).currentStock).toBeCloseTo(39.8)

    // Second save: drop the dish entirely (empty selection).
    const secondSave = await updateOrderItems(order.id, { dishes: [], extraIngredients: [], totalPrice: 0 })
    expect(secondSave.ok).toBe(true)

    const riceFinal = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })
    const chickenFinal = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: chicken.id } })
    expect(riceFinal.currentStock).toBeCloseTo(80)
    expect(chickenFinal.currentStock).toBeCloseTo(40)
    expect(await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })).toHaveLength(0)
    expect(await prisma.orderDish.findMany({ where: { orderId: order.id } })).toHaveLength(0)
  })

  it('a dish-derived line and a manual extraIngredients line for the same InventoryItem merge into ONE log row', async () => {
    const rice = await createInventoryItem({ currentStock: 80 })
    inventoryItemIds.push(rice.id)
    const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }])
    dishIds.push(dish.id)
    const order = await seedOrderWithLog(rice.id, 0)

    const result = await updateOrderItems(order.id, {
      dishes: [{ dishId: dish.id, quantity: 2 }], // 0.5 rice
      extraIngredients: [{ inventoryItemId: rice.id, quantityUsed: 3 }], // +3 rice manually
      totalPrice: 2400,
    })
    expect(result.ok).toBe(true)

    const logs = await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0].quantityUsed).toBeCloseTo(3.5)
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })
    expect(item.currentStock).toBeCloseTo(80 - 3.5)
  })

  it('re-snapshots dishName/unitPrice at edit time rather than carrying over the original order values', async () => {
    const rice = await createInventoryItem()
    inventoryItemIds.push(rice.id)
    const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }])
    dishIds.push(dish.id)
    const order = await seedOrderWithLog(rice.id, 0)

    // Reprice the dish AFTER the order's baseline state but BEFORE the edit is saved.
    await prisma.dish.update({ where: { id: dish.id }, data: { price: 1500 } })

    const result = await updateOrderItems(order.id, { dishes: [{ dishId: dish.id, quantity: 1 }], extraIngredients: [], totalPrice: 1500 })
    expect(result.ok).toBe(true)

    const orderDishes = await prisma.orderDish.findMany({ where: { orderId: order.id } })
    expect(orderDishes[0].unitPrice).toBe(1500)
  })

  it('skips an unresolvable dishId (archived/deleted mid-edit) without throwing', async () => {
    const rice = await createInventoryItem()
    inventoryItemIds.push(rice.id)
    const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }])
    dishIds.push(dish.id)
    const order = await seedOrderWithLog(rice.id, 0)

    await expect(
      updateOrderItems(order.id, {
        dishes: [
          { dishId: dish.id, quantity: 1 },
          { dishId: randomUUID(), quantity: 9 }, // syntactically valid UUID, no matching Dish row
        ],
        extraIngredients: [],
        totalPrice: 1200,
      })
    ).resolves.toMatchObject({ ok: true })

    const orderDishes = await prisma.orderDish.findMany({ where: { orderId: order.id } })
    expect(orderDishes).toHaveLength(1)
    expect(orderDishes[0].dishId).toBe(dish.id)
  })

  it('updates order.totalPrice to the supplied value', async () => {
    const customer = await createCustomer()
    userIds.push(customer.id)
    const order = await prisma.order.create({
      data: { customerId: customer.id, description: 'price check', totalPrice: 0 },
    })
    orderIds.push(order.id)

    const result = await updateOrderItems(order.id, { dishes: [], extraIngredients: [], totalPrice: 999 })
    expect(result.ok).toBe(true)

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalPrice).toBe(999)
  })
})
