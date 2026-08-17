/**
 * Narrow/wide integration tests for createOrder/deleteOrder, run against the REAL local Supabase
 * Postgres instance via the same `prisma` singleton the app uses. Two things are stubbed, both
 * documented findings from this feature's earlier verification pass (see docs/.pipeline-state.md):
 *   - `next/cache` (aliased in vitest.config.mts) — revalidatePath needs a Next request context.
 *   - `@/lib/notifications` (mocked below) — createOrder fires a REAL email via Resend using a
 *     live API key in .env; without this every test run would burn Resend's daily quota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { cleanupFixtures, createCustomer, createDishWithRecipe, createInventoryItem, uniqueName } from '../../../../test/helpers/fixtures'
import { createOrder, deleteOrder } from './actions'

vi.mock('@/lib/notifications', () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue({}),
  notifyLowStock: vi.fn().mockResolvedValue({}),
}))

describe('orders actions (integration)', () => {
  let inventoryItemIds: string[]
  let dishIds: string[]
  let orderIds: string[]
  let userIds: string[]

  beforeEach(() => {
    inventoryItemIds = []
    dishIds = []
    orderIds = []
    userIds = []
  })

  afterEach(async () => {
    await cleanupFixtures({ orderIds, dishIds, inventoryItemIds, userIds })
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

      const order = await createOrder({
        customerId: customer.id,
        description: 'test order',
        totalPrice: 0,
        dishes: [
          { dishId: jollof.id, quantity: 2 }, // 0.5 rice
          { dishId: friedRice.id, quantity: 3 }, // 0.75 rice
        ],
      })
      orderIds.push(order.id)

      const logs = await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })
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

      const order = await createOrder({
        customerId: customer.id,
        description: 'test order',
        // Client-supplied totalPrice is trusted for the order total (per TDD), but the per-dish
        // snapshot must come from the DB record, not from anything the client could have sent.
        totalPrice: 2400,
        dishes: [{ dishId: dish.id, quantity: 2 }],
      })
      orderIds.push(order.id)

      const orderDishes = await prisma.orderDish.findMany({ where: { orderId: order.id } })
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

      const order = await createOrder({
        customerId: customer.id,
        description: 'test order',
        totalPrice: 1200,
        dishes: [
          { dishId: dish.id, quantity: 1 },
          { dishId: 'does-not-exist', quantity: 5 },
        ],
      })
      orderIds.push(order.id)

      const orderDishes = await prisma.orderDish.findMany({ where: { orderId: order.id } })
      expect(orderDishes).toHaveLength(1)
      expect(orderDishes[0].dishId).toBe(dish.id)
    })

    it('creates zero OrderIngredientLog/OrderDish rows for an order with no dish selections (legacy-shaped create)', async () => {
      const customer = await createCustomer()
      userIds.push(customer.id)

      const order = await createOrder({ customerId: customer.id, description: 'notes only', totalPrice: 500, dishes: [] })
      orderIds.push(order.id)

      expect(await prisma.orderDish.findMany({ where: { orderId: order.id } })).toHaveLength(0)
      expect(await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })).toHaveLength(0)
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
      const order = await createOrder({
        customerId: customer.id,
        description: 'to be deleted',
        totalPrice: 1200,
        dishes: [{ dishId: dish.id, quantity: 1 }],
      })
      // Deliberately not pushed to orderIds — deleteOrder should remove it; assert that directly.

      await expect(deleteOrder(order.id)).resolves.not.toThrow()

      expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull()
      expect(await prisma.orderDish.findMany({ where: { orderId: order.id } })).toHaveLength(0)
      expect(await prisma.orderIngredientLog.findMany({ where: { orderId: order.id } })).toHaveLength(0)
    })

    it('deletes a legacy order with zero OrderDish rows', async () => {
      const customer = await createCustomer()
      userIds.push(customer.id)
      const order = await prisma.order.create({
        data: { customerId: customer.id, description: 'legacy order', totalPrice: 500 },
      })

      await expect(deleteOrder(order.id)).resolves.not.toThrow()
      expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull()
    })
  })
})
