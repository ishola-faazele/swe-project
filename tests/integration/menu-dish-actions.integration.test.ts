/**
 * Narrow/wide integration tests for the Dish CRUD Server Actions in this file, run against the
 * REAL local Supabase Postgres instance via the same `prisma` singleton the app uses — not a
 * mock. `next/cache`'s `revalidatePath` is stubbed since these actions run outside an actual
 * Next.js request here; the DB work under test always happens before that call.
 * `@/utils/supabase/server` is stubbed too — every action in this file now requires an ADMIN
 * session via requireAdmin() (added during the Phase 0 + Phase 2 merge, see docs/ROADMAP.md;
 * this file had no authorization at all beforehand). Every fixture is scoped and torn down per
 * test — see test/helpers/fixtures.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { cleanupFixtures, createCustomer, createInventoryItem, uniqueName } from '../../test/helpers/fixtures'
import { createDish, updateDish, deleteDish, toggleDishActive, getDishes } from '@/app/admin/menu/actions'
import { createTestAdmin, mockAuthSession, newRegistry, cleanupRegistry, type TestRegistry } from './helpers'

const createClientMock = vi.mocked(createClient)

describe('menu actions (integration)', () => {
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

  describe('createDish', () => {
    it('creates a Dish row and one DishIngredient row per distinct ingredient', async () => {
      const rice = await createInventoryItem()
      const tomatoes = await createInventoryItem()
      inventoryItemIds.push(rice.id, tomatoes.id)

      const dish = await createDish({
        name: uniqueName('Jollof'),
        price: 1200,
        ingredients: [
          { inventoryItemId: rice.id, quantityPerDish: 0.25 },
          { inventoryItemId: tomatoes.id, quantityPerDish: 0.1 },
        ],
      })
      dishIds.push(dish.id)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(2)
      expect(dish.price).toBe(1200)
      expect(dish.isActive).toBe(true)
    })

    it('sums a duplicate ingredient pick into one row instead of throwing P2002', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)

      const dish = await createDish({
        name: uniqueName('Waakye'),
        price: 900,
        ingredients: [
          { inventoryItemId: rice.id, quantityPerDish: 0.2 },
          { inventoryItemId: rice.id, quantityPerDish: 0.05 },
        ],
      })
      dishIds.push(dish.id)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].quantityPerDish).toBeCloseTo(0.25)
    })

    it('creates a dish with an empty recipe (a dish that sells but deducts no stock)', async () => {
      const dish = await createDish({ name: uniqueName('Bottled Water'), price: 100, ingredients: [] })
      dishIds.push(dish.id)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(0)
    })
  })

  describe('updateDish', () => {
    it('updating only name/price leaves existing DishIngredient rows untouched', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDish({
        name: uniqueName('Fried Rice'),
        price: 1300,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }],
      })
      dishIds.push(dish.id)

      const updated = await updateDish(dish.id, { name: uniqueName('Fried Rice (renamed)'), price: 1400 })

      expect(updated.price).toBe(1400)
      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].inventoryItemId).toBe(rice.id)
      expect(recipe[0].quantityPerDish).toBeCloseTo(0.25)
    })

    it('supplying a new ingredients array fully replaces the old recipe with no leftover rows', async () => {
      const rice = await createInventoryItem()
      const chicken = await createInventoryItem()
      inventoryItemIds.push(rice.id, chicken.id)
      const dish = await createDish({
        name: uniqueName('Fried Rice'),
        price: 1300,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }],
      })
      dishIds.push(dish.id)

      await updateDish(dish.id, {
        ingredients: [{ inventoryItemId: chicken.id, quantityPerDish: 0.1 }],
      })

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].inventoryItemId).toBe(chicken.id)
    })

    it('sums duplicate ingredient picks in the new recipe instead of throwing P2002', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDish({ name: uniqueName('Dish'), price: 500, ingredients: [] })
      dishIds.push(dish.id)

      await updateDish(dish.id, {
        ingredients: [
          { inventoryItemId: rice.id, quantityPerDish: 0.1 },
          { inventoryItemId: rice.id, quantityPerDish: 0.2 },
        ],
      })

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].quantityPerDish).toBeCloseTo(0.3)
    })
  })

  describe('deleteDish', () => {
    it('hard-deletes a never-ordered dish and its recipe, returning { archived: false }', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDish({
        name: uniqueName('Never Ordered'),
        price: 700,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.1 }],
      })
      // Not tracked in dishIds — deleteDish should remove it itself; we assert that below.

      const result = await deleteDish(dish.id)

      expect(result).toEqual({ archived: false })
      expect(await prisma.dish.findUnique({ where: { id: dish.id } })).toBeNull()
      expect(await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })).toHaveLength(0)
    })

    it('archives (isActive: false) a dish referenced by an order instead of deleting it, returning { archived: true }', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await createDish({
        name: uniqueName('Referenced Dish'),
        price: 700,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.1 }],
      })
      dishIds.push(dish.id)

      const customer = await createCustomer()
      userIds.push(customer.id)
      const order = await prisma.order.create({
        data: { customerId: customer.id, description: 'test order', totalPrice: 700 },
      })
      orderIds.push(order.id)
      await prisma.orderDish.create({
        data: { orderId: order.id, dishId: dish.id, dishName: dish.name, unitPrice: dish.price, quantity: 1 },
      })

      const result = await deleteDish(dish.id)

      expect(result).toEqual({ archived: true })
      const persisted = await prisma.dish.findUnique({ where: { id: dish.id } })
      expect(persisted?.isActive).toBe(false)
      // Order history stays intact — the dish row (and its recipe) is not deleted.
      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: dish.id } })
      expect(recipe).toHaveLength(1)
    })

    it('never attempts a hard-delete for a referenced dish (no P2003)', async () => {
      const dish = await createDish({ name: uniqueName('Referenced Dish 2'), price: 500, ingredients: [] })
      dishIds.push(dish.id)
      const customer = await createCustomer()
      userIds.push(customer.id)
      const order = await prisma.order.create({
        data: { customerId: customer.id, description: 'test order', totalPrice: 500 },
      })
      orderIds.push(order.id)
      await prisma.orderDish.create({
        data: { orderId: order.id, dishId: dish.id, dishName: dish.name, unitPrice: dish.price, quantity: 1 },
      })

      await expect(deleteDish(dish.id)).resolves.toEqual({ archived: true })
    })
  })

  describe('toggleDishActive', () => {
    it('sets isActive: false on the target dish only', async () => {
      const dishA = await createDish({ name: uniqueName('A'), price: 100, ingredients: [] })
      const dishB = await createDish({ name: uniqueName('B'), price: 100, ingredients: [] })
      dishIds.push(dishA.id, dishB.id)

      await toggleDishActive(dishA.id, false)

      expect((await prisma.dish.findUnique({ where: { id: dishA.id } }))?.isActive).toBe(false)
      expect((await prisma.dish.findUnique({ where: { id: dishB.id } }))?.isActive).toBe(true)
    })

    it('restores isActive: true', async () => {
      const dish = await createDish({ name: uniqueName('Restorable'), price: 100, ingredients: [] })
      dishIds.push(dish.id)
      await toggleDishActive(dish.id, false)

      await toggleDishActive(dish.id, true)

      expect((await prisma.dish.findUnique({ where: { id: dish.id } }))?.isActive).toBe(true)
    })
  })

  describe('getDishes', () => {
    it('includes both active and archived dishes, each with ingredients + inventoryItem populated', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const active = await createDish({
        name: uniqueName('Active Dish'),
        price: 100,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.1 }],
      })
      const archived = await createDish({ name: uniqueName('Archived Dish'), price: 100, ingredients: [] })
      dishIds.push(active.id, archived.id)
      await toggleDishActive(archived.id, false)

      const all = await getDishes()
      const activeRow = all.find((d) => d.id === active.id)
      const archivedRow = all.find((d) => d.id === archived.id)

      expect(activeRow).toBeDefined()
      expect(archivedRow).toBeDefined()
      expect(archivedRow?.isActive).toBe(false)
      expect(activeRow?.ingredients[0]?.inventoryItem.id).toBe(rice.id)
    })
  })
})
