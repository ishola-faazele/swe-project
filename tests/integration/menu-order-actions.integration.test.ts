/**
 * Narrow/wide integration tests for createOrder/deleteOrder, run against the REAL local Supabase
 * Postgres instance via the same `prisma` singleton the app uses. Three things are stubbed:
 *   - `@/utils/supabase/server` (mocked below) — createOrder/deleteOrder now require an ADMIN
 *     session via requireAdmin() (added during the Phase 0 + Phase 2 merge, see docs/ROADMAP.md);
 *     auth-matrix coverage itself lives in orders-actions.integration.test.ts, so this file just
 *     configures a fixed admin session and moves on to the dish/stock behavior under test.
 *   - `next/cache` — revalidatePath needs a Next request context.
 *   - `@/lib/notifications` (mocked below) — createOrder fires a REAL email via Resend using a
 *     live API key in .env; without this every test run would burn Resend's daily quota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue({}),
  notifyLowStock: vi.fn().mockResolvedValue({}),
}))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { cleanupFixtures, createCustomer, createDishWithRecipe, createInventoryItem, uniqueName } from '../../test/helpers/fixtures'
import { createOrder, deleteOrder } from '@/app/admin/orders/actions'
import { createTestAdmin, mockAuthSession, newRegistry, cleanupRegistry, type TestRegistry } from './helpers'
import { randomUUID } from 'node:crypto'

const createClientMock = vi.mocked(createClient)

describe('orders actions (integration)', () => {
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

  describe('createOrder', () => {
    it('two dishes sharing an ingredient produce exactly ONE merged OrderIngredientLog row with the summed quantity, and the correct net stock decrement', async () => {
      const rice = await createInventoryItem({ currentStock: 80 })
      inventoryItemIds.push(rice.id)
      const jollof = await createDishWithRecipe(uniqueName('Jollof'), 1200, [
        { inventoryItemId: rice.id, quantityPerDish: 0.25 },
      ])
      const friedRice = await createDishWithRecipe(uniqueName('Fried Rice'), 1300, [
        { inventoryItemId: rice.id, quantityPerDish: 0.25 },
      ])
      dishIds.push(jollof.id, friedRice.id)
      const customer = await createCustomer()
      userIds.push(customer.id)

      const result = await createOrder({
        customerId: customer.id,
        description: 'test order',
        totalPrice: 0,
        dishes: [
          { dishId: jollof.id, quantity: 2 }, // 0.5 rice
          { dishId: friedRice.id, quantity: 3 }, // 0.75 rice
        ],
      })
      if (!result.ok) throw new Error('fixture setup failed: ' + result.error)
      orderIds.push(result.data.id)

      const logs = await prisma.orderIngredientLog.findMany({ where: { orderId: result.data.id } })
      expect(logs).toHaveLength(1)
      expect(logs[0].inventoryItemId).toBe(rice.id)
      expect(logs[0].quantityUsed).toBeCloseTo(1.25)

      const updatedRice = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: rice.id } })
      expect(updatedRice.currentStock).toBeCloseTo(80 - 1.25)
    })

    it('every selected dish gets an OrderDish row with dishName/unitPrice snapshotted from DB-fresh data, not client input', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [
        { inventoryItemId: rice.id, quantityPerDish: 0.25 },
      ])
      dishIds.push(dish.id)
      const customer = await createCustomer()
      userIds.push(customer.id)

      const result = await createOrder({
        customerId: customer.id,
        description: 'test order',
        // Client-supplied totalPrice is trusted for the order total (per TDD), but the per-dish
        // snapshot must come from the DB record, not from anything the client could have sent.
        totalPrice: 2400,
        dishes: [{ dishId: dish.id, quantity: 2 }],
      })
      if (!result.ok) throw new Error('fixture setup failed: ' + result.error)
      orderIds.push(result.data.id)

      const orderDishes = await prisma.orderDish.findMany({ where: { orderId: result.data.id } })
      expect(orderDishes).toHaveLength(1)
      expect(orderDishes[0]).toMatchObject({ dishId: dish.id, dishName: dish.name, unitPrice: dish.price, quantity: 2 })
    })

    it('skips an unresolvable dishId (archived/deleted mid-submit) without throwing', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [
        { inventoryItemId: rice.id, quantityPerDish: 0.25 },
      ])
      dishIds.push(dish.id)
      const customer = await createCustomer()
      userIds.push(customer.id)

      const result = await createOrder({
        customerId: customer.id,
        description: 'test order',
        totalPrice: 1200,
        dishes: [
          { dishId: dish.id, quantity: 1 },
          { dishId: randomUUID(), quantity: 5 }, // syntactically valid UUID, no matching Dish row
        ],
      })
      if (!result.ok) throw new Error('fixture setup failed: ' + result.error)
      orderIds.push(result.data.id)

      const orderDishes = await prisma.orderDish.findMany({ where: { orderId: result.data.id } })
      expect(orderDishes).toHaveLength(1)
      expect(orderDishes[0].dishId).toBe(dish.id)
    })

    it('creates zero OrderIngredientLog/OrderDish rows for an order with no dish selections (legacy-shaped create)', async () => {
      const customer = await createCustomer()
      userIds.push(customer.id)

      const result = await createOrder({ customerId: customer.id, description: 'notes only', totalPrice: 500, dishes: [] })
      if (!result.ok) throw new Error('fixture setup failed: ' + result.error)
      orderIds.push(result.data.id)

      expect(await prisma.orderDish.findMany({ where: { orderId: result.data.id } })).toHaveLength(0)
      expect(await prisma.orderIngredientLog.findMany({ where: { orderId: result.data.id } })).toHaveLength(0)
    })
  })

  describe('deleteOrder', () => {
    it('deletes an order carrying OrderDish rows with no P2003', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDishWithRecipe(uniqueName('Jollof'), 1200, [
        { inventoryItemId: rice.id, quantityPerDish: 0.25 },
      ])
      dishIds.push(dish.id)
      const customer = await createCustomer()
      userIds.push(customer.id)
      const created = await createOrder({
        customerId: customer.id,
        description: 'to be deleted',
        totalPrice: 1200,
        dishes: [{ dishId: dish.id, quantity: 1 }],
      })
      if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
      // Deliberately not pushed to orderIds — deleteOrder should remove it; assert that directly.

      const deleteResult = await deleteOrder(created.data.id)
      expect(deleteResult.ok).toBe(true)

      expect(await prisma.order.findUnique({ where: { id: created.data.id } })).toBeNull()
      expect(await prisma.orderDish.findMany({ where: { orderId: created.data.id } })).toHaveLength(0)
      expect(await prisma.orderIngredientLog.findMany({ where: { orderId: created.data.id } })).toHaveLength(0)
    })

    it('deletes a legacy order with zero OrderDish rows', async () => {
      const customer = await createCustomer()
      userIds.push(customer.id)
      const order = await prisma.order.create({
        data: { customerId: customer.id, description: 'legacy order', totalPrice: 500 },
      })

      const deleteResult = await deleteOrder(order.id)
      expect(deleteResult.ok).toBe(true)
      expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull()
    })
  })
})
