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
import { addDishMedia, removeDishMedia, reorderDishMedia } from '@/app/admin/menu/[id]/actions'
import { createTestAdmin, mockAuthSession, newRegistry, cleanupRegistry, type TestRegistry } from './helpers'

const createClientMock = vi.mocked(createClient)

/**
 * Fixture-only helper for the deleteDish/toggleDishActive/getDishes blocks below, which are NOT
 * part of the ActionResult migration (TEST-005) themselves — they just need *a dish to exist* as
 * setup and were, pre-migration, able to destructure the bare Dish return value directly. Now that
 * createDish returns ActionResult<Dish>, those call sites need SOME unwrap to compile; this keeps
 * that unwrap out of the actual test bodies so their own assertions stay byte-for-byte unchanged.
 */
async function mustCreateDish(data: Parameters<typeof createDish>[0]) {
  const result = await createDish(data)
  if (!result.ok) throw new Error(`createDish fixture setup failed: ${result.error}`)
  return result.data
}

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

      const result = await createDish({
        name: uniqueName('Jollof'),
        price: 1200,
        ingredients: [
          { inventoryItemId: rice.id, quantityPerDish: 0.25 },
          { inventoryItemId: tomatoes.id, quantityPerDish: 0.1 },
        ],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      dishIds.push(result.data.id)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: result.data.id } })
      expect(recipe).toHaveLength(2)
      expect(result.data.price).toBe(1200)
      expect(result.data.isActive).toBe(true)
    })

    it('sums a duplicate ingredient pick into one row instead of throwing P2002', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)

      const result = await createDish({
        name: uniqueName('Waakye'),
        price: 900,
        ingredients: [
          { inventoryItemId: rice.id, quantityPerDish: 0.2 },
          { inventoryItemId: rice.id, quantityPerDish: 0.05 },
        ],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      dishIds.push(result.data.id)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: result.data.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].quantityPerDish).toBeCloseTo(0.25)
    })

    it('creates a dish with an empty recipe (a dish that sells but deducts no stock)', async () => {
      const result = await createDish({ name: uniqueName('Bottled Water'), price: 100, ingredients: [] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      dishIds.push(result.data.id)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: result.data.id } })
      expect(recipe).toHaveLength(0)
    })

    it('rejects a negative price with a VALIDATION ActionResult', async () => {
      const result = await createDish({ name: uniqueName('Bad Dish'), price: -100, ingredients: [] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('VALIDATION')
    })
  })

  describe('updateDish', () => {
    it('updating only name/price leaves existing DishIngredient rows untouched', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const created = await createDish({
        name: uniqueName('Fried Rice'),
        price: 1300,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }],
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      dishIds.push(created.data.id)

      const result = await updateDish(created.data.id, { name: uniqueName('Fried Rice (renamed)'), price: 1400 })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.price).toBe(1400)
      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: created.data.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].inventoryItemId).toBe(rice.id)
      expect(recipe[0].quantityPerDish).toBeCloseTo(0.25)
    })

    it('supplying a new ingredients array fully replaces the old recipe with no leftover rows', async () => {
      const rice = await createInventoryItem()
      const chicken = await createInventoryItem()
      inventoryItemIds.push(rice.id, chicken.id)
      const created = await createDish({
        name: uniqueName('Fried Rice'),
        price: 1300,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }],
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      dishIds.push(created.data.id)

      const result = await updateDish(created.data.id, {
        ingredients: [{ inventoryItemId: chicken.id, quantityPerDish: 0.1 }],
      })
      expect(result.ok).toBe(true)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: created.data.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].inventoryItemId).toBe(chicken.id)
    })

    it('sums duplicate ingredient picks in the new recipe instead of throwing P2002', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const created = await createDish({ name: uniqueName('Dish'), price: 500, ingredients: [] })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      dishIds.push(created.data.id)

      const result = await updateDish(created.data.id, {
        ingredients: [
          { inventoryItemId: rice.id, quantityPerDish: 0.1 },
          { inventoryItemId: rice.id, quantityPerDish: 0.2 },
        ],
      })
      expect(result.ok).toBe(true)

      const recipe = await prisma.dishIngredient.findMany({ where: { dishId: created.data.id } })
      expect(recipe).toHaveLength(1)
      expect(recipe[0].quantityPerDish).toBeCloseTo(0.3)
    })

    it('rejects a negative price with a VALIDATION ActionResult', async () => {
      const created = await createDish({ name: uniqueName('Fried Rice'), price: 1300, ingredients: [] })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      dishIds.push(created.data.id)

      const result = await updateDish(created.data.id, { price: -50 })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('VALIDATION')
    })
  })

  describe('deleteDish', () => {
    it('hard-deletes a never-ordered dish and its recipe, returning { archived: false }', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await mustCreateDish({
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

    // This is the test that would have caught a missing tx.dishMedia.deleteMany line as an
    // unhandled P2003 — DishMedia.dishId has no ON DELETE CASCADE, so deleteDish must clean these
    // up itself before deleting the Dish row.
    it('deletes a never-ordered dish\'s attached DishMedia rows along with the dish, no P2003', async () => {
      const dish = await mustCreateDish({ name: uniqueName('Media Dish To Delete'), price: 500, ingredients: [] })
      const attached = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/x.jpg', type: 'IMAGE' })
      expect(attached.ok).toBe(true)

      const result = await deleteDish(dish.id)

      expect(result).toEqual({ archived: false })
      expect(await prisma.dish.findUnique({ where: { id: dish.id } })).toBeNull()
      expect(await prisma.dishMedia.findMany({ where: { dishId: dish.id } })).toHaveLength(0)
    })

    it('archives (isActive: false) a dish referenced by an order instead of deleting it, returning { archived: true }', async () => {
      const rice = await createInventoryItem()
      inventoryItemIds.push(rice.id)
      const dish = await mustCreateDish({
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
      const dish = await mustCreateDish({ name: uniqueName('Referenced Dish 2'), price: 500, ingredients: [] })
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
      const dishA = await mustCreateDish({ name: uniqueName('A'), price: 100, ingredients: [] })
      const dishB = await mustCreateDish({ name: uniqueName('B'), price: 100, ingredients: [] })
      dishIds.push(dishA.id, dishB.id)

      await toggleDishActive(dishA.id, false)

      expect((await prisma.dish.findUnique({ where: { id: dishA.id } }))?.isActive).toBe(false)
      expect((await prisma.dish.findUnique({ where: { id: dishB.id } }))?.isActive).toBe(true)
    })

    it('restores isActive: true', async () => {
      const dish = await mustCreateDish({ name: uniqueName('Restorable'), price: 100, ingredients: [] })
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
      const active = await mustCreateDish({
        name: uniqueName('Active Dish'),
        price: 100,
        ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.1 }],
      })
      const archived = await mustCreateDish({ name: uniqueName('Archived Dish'), price: 100, ingredients: [] })
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

  describe('DishMedia (addDishMedia/removeDishMedia/reorderDishMedia)', () => {
    it('assigns position 0 to the first item and currentMax + 1 to the next', async () => {
      const dish = await mustCreateDish({ name: uniqueName('Media Dish'), price: 100, ingredients: [] })
      dishIds.push(dish.id)

      const first = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/a.jpg', type: 'IMAGE' })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.data.position).toBe(0)

      const second = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/b.mp4', type: 'VIDEO' })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.data.position).toBe(1)
    })

    it('removing an item does not renumber the remaining positions — a gap, not a bug', async () => {
      const dish = await mustCreateDish({ name: uniqueName('Media Gap Dish'), price: 100, ingredients: [] })
      dishIds.push(dish.id)

      const a = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/a.jpg', type: 'IMAGE' })
      const b = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/b.jpg', type: 'IMAGE' })
      const c = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/c.jpg', type: 'IMAGE' })
      if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed')

      const removed = await removeDishMedia(b.data.id)
      expect(removed.ok).toBe(true)

      const remaining = await prisma.dishMedia.findMany({ where: { dishId: dish.id }, orderBy: { position: 'asc' } })
      expect(remaining.map((m) => m.position)).toEqual([0, 2])
    })

    it('rejects removal of a nonexistent media row with NOT_FOUND', async () => {
      const result = await removeDishMedia('00000000-0000-0000-0000-000000000000')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('NOT_FOUND')
    })

    it('reorderDishMedia swaps two adjacent items\' positions', async () => {
      const dish = await mustCreateDish({ name: uniqueName('Reorder Dish'), price: 100, ingredients: [] })
      dishIds.push(dish.id)

      const a = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/a.jpg', type: 'IMAGE' })
      const b = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/b.jpg', type: 'IMAGE' })
      if (!a.ok || !b.ok) throw new Error('setup failed')

      const result = await reorderDishMedia({ dishId: dish.id, mediaId: a.data.id, direction: 'down' })
      expect(result.ok).toBe(true)

      const afterA = await prisma.dishMedia.findUnique({ where: { id: a.data.id } })
      const afterB = await prisma.dishMedia.findUnique({ where: { id: b.data.id } })
      expect(afterA?.position).toBe(1)
      expect(afterB?.position).toBe(0)
    })

    it('reorderDishMedia is a no-op at the boundary (moving the first item up)', async () => {
      const dish = await mustCreateDish({ name: uniqueName('Boundary Dish'), price: 100, ingredients: [] })
      dishIds.push(dish.id)

      const a = await addDishMedia({ dishId: dish.id, url: 'http://minio.local/a.jpg', type: 'IMAGE' })
      if (!a.ok) throw new Error('setup failed')

      const result = await reorderDishMedia({ dishId: dish.id, mediaId: a.data.id, direction: 'up' })
      expect(result.ok).toBe(true)

      const after = await prisma.dishMedia.findUnique({ where: { id: a.data.id } })
      expect(after?.position).toBe(0)
    })
  })
})
