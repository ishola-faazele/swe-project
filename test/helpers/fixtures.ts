/**
 * Shared fixture builders + FK-safe teardown for the narrow/wide integration test layers.
 *
 * These tests run against the REAL local Supabase Postgres instance (via the same `prisma`
 * singleton the app itself uses), not a mock. Every fixture created here is deliberately scoped
 * and randomly-suffixed rather than reusing the global seed data (`Long Grain Rice`, etc.) — each
 * test seeds only what it needs and deletes exactly that, so tests stay independent of each other
 * and of whatever the seed script currently contains.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Category } from '@prisma/client'

export function uniqueName(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

export async function createInventoryItem(overrides: {
  name?: string
  category?: Category
  unit?: string
  currentStock?: number
  minimumThreshold?: number
} = {}) {
  return prisma.inventoryItem.create({
    data: {
      name: overrides.name ?? uniqueName('test-item'),
      category: overrides.category ?? 'INGREDIENT',
      unit: overrides.unit ?? 'kg',
      currentStock: overrides.currentStock ?? 100,
      minimumThreshold: overrides.minimumThreshold ?? 0,
    },
  })
}

export async function createCustomer(overrides: { name?: string; email?: string; phone?: string } = {}) {
  const suffix = randomUUID().slice(0, 8)
  return prisma.user.create({
    data: {
      name: overrides.name ?? `Test Customer ${suffix}`,
      email: overrides.email ?? `test-${suffix}@example.com`,
      phone: overrides.phone,
      role: 'CUSTOMER',
    },
  })
}

export async function createDishWithRecipe(
  name: string,
  price: number,
  ingredients: { inventoryItemId: string; quantityPerDish: number }[]
) {
  return prisma.dish.create({
    data: { name, price, ingredients: { create: ingredients } },
    include: { ingredients: true },
  })
}

/**
 * FK-safe teardown, mirroring prisma/seed.ts's own cleanup ordering (children before parents):
 * order-level child rows -> order -> dish-level child rows -> dish -> user -> inventoryItem.
 * Pass only the ids a given test actually created — never touches seeded or other tests' rows.
 */
export async function cleanupFixtures(ids: {
  orderIds?: string[]
  dishIds?: string[]
  inventoryItemIds?: string[]
  userIds?: string[]
}) {
  const orderIds = ids.orderIds ?? []
  const dishIds = ids.dishIds ?? []
  const inventoryItemIds = ids.inventoryItemIds ?? []
  const userIds = ids.userIds ?? []

  if (orderIds.length) {
    await prisma.orderIngredientLog.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.orderDish.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
  }
  if (dishIds.length) {
    await prisma.dishIngredient.deleteMany({ where: { dishId: { in: dishIds } } })
    await prisma.dish.deleteMany({ where: { id: { in: dishIds } } })
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }
  if (inventoryItemIds.length) {
    await prisma.inventoryItem.deleteMany({ where: { id: { in: inventoryItemIds } } })
  }
}
