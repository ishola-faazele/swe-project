/**
 * Shared fixture creation, cleanup, and Supabase-auth mocking helpers for the integration
 * suite — TEST-005.
 *
 * Every integration test file creates its own throwaway User/InventoryItem/Order/
 * OrderIngredientLog rows directly via Prisma against the isolated `rosty_integrity_test`
 * database (see docs/.pipeline-state.md, "Test Database Isolation"), tracked in a per-test
 * TestRegistry, and tears them down via cleanupRegistry() in an afterEach — leaving the
 * database in the same state it found it.
 *
 * IMPORTANT: this module deliberately does NOT call vi.mock() itself. Vitest's mock-hoisting
 * transform only rewrites `vi.mock(...)` calls that are written directly inside a given file —
 * calling it from here would not intercept `@/utils/supabase/server` imports made by *other*
 * files (e.g. the action modules under test). Each integration test file must call
 * `vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))` itself, then pass the
 * resulting mock into mockAuthSession()/mockNoSession() below to configure its behavior.
 */
import { randomUUID } from 'node:crypto'
import type { Mock } from 'vitest'
import { prisma } from '@/lib/prisma'
import type { Category, InventoryItem, Order, OrderStatus, User } from '@prisma/client'

export interface TestRegistry {
  orderIds: string[]
  inventoryItemIds: string[]
  userIds: string[]
}

export function newRegistry(): TestRegistry {
  return { orderIds: [], inventoryItemIds: [], userIds: [] }
}

/**
 * Deletes every row a test created, in FK-safe order (logs -> orders/items -> users). Safe to
 * call even if some rows were already deleted by the action under test (e.g. a successful
 * deleteOrder) — deleteMany on a non-matching id simply matches zero rows.
 *
 * Callers that also create Dish/DishIngredient fixtures (via test/helpers/fixtures.ts's
 * createDishWithRecipe) must delete those FIRST, before calling cleanupRegistry — a Dish row
 * referencing one of this registry's InventoryItem ids via DishIngredient, or an OrderDish row
 * on one of this registry's orders, would otherwise violate the FK constraints below.
 */
export async function cleanupRegistry(reg: TestRegistry): Promise<void> {
  if (reg.orderIds.length) {
    await prisma.orderIngredientLog.deleteMany({ where: { orderId: { in: reg.orderIds } } })
    await prisma.orderDish.deleteMany({ where: { orderId: { in: reg.orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: reg.orderIds } } })
  }
  if (reg.inventoryItemIds.length) {
    await prisma.orderIngredientLog.deleteMany({
      where: { inventoryItemId: { in: reg.inventoryItemIds } },
    })
    await prisma.inventoryItem.deleteMany({ where: { id: { in: reg.inventoryItemIds } } })
  }
  if (reg.userIds.length) {
    await prisma.order.deleteMany({ where: { customerId: { in: reg.userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: reg.userIds } } })
  }
}

export async function createTestAdmin(
  reg: TestRegistry,
  overrides: Partial<Pick<User, 'name' | 'email' | 'phone'>> = {}
): Promise<User> {
  const user = await prisma.user.create({
    data: {
      role: 'ADMIN',
      name: overrides.name ?? 'Test Admin',
      email: overrides.email ?? `admin-${randomUUID()}@test.rosty.local`,
      phone: overrides.phone ?? null,
    },
  })
  reg.userIds.push(user.id)
  return user
}

export async function createTestCustomer(
  reg: TestRegistry,
  overrides: Partial<Pick<User, 'name' | 'email' | 'phone'>> = {}
): Promise<User> {
  const user = await prisma.user.create({
    data: {
      role: 'CUSTOMER',
      name: overrides.name ?? 'Test Customer',
      email: overrides.email ?? `customer-${randomUUID()}@test.rosty.local`,
      phone: overrides.phone ?? null,
    },
  })
  reg.userIds.push(user.id)
  return user
}

export async function createTestInventoryItem(
  reg: TestRegistry,
  overrides: Partial<
    Pick<InventoryItem, 'name' | 'category' | 'unit' | 'currentStock' | 'minimumThreshold'>
  > = {}
): Promise<InventoryItem> {
  const item = await prisma.inventoryItem.create({
    data: {
      name: overrides.name ?? `Test Item ${randomUUID()}`,
      category: overrides.category ?? ('INGREDIENT' as Category),
      unit: overrides.unit ?? 'kg',
      currentStock: overrides.currentStock ?? 100,
      minimumThreshold: overrides.minimumThreshold ?? 0,
    },
  })
  reg.inventoryItemIds.push(item.id)
  return item
}

/**
 * Writes an Order (+ OrderIngredientLog rows, if any ingredients are given) directly via
 * Prisma, bypassing the createOrder action entirely. Does NOT touch InventoryItem.currentStock
 * — use this only for tests that need *an order to exist* (e.g. auth-matrix fixtures, FK-guard
 * fixtures) and don't care about stock reconciliation. Tests asserting stock invariants
 * (insufficient-stock, order-lifecycle, concurrency) call the real createOrder action instead
 * so a genuine guarded decrement happens.
 */
export async function createTestOrder(
  reg: TestRegistry,
  customerId: string,
  ingredients: { inventoryItemId: string; quantityUsed: number }[] = [],
  overrides: Partial<Pick<Order, 'description' | 'totalPrice' | 'status'>> = {}
): Promise<Order> {
  const order = await prisma.order.create({
    data: {
      customerId,
      description: overrides.description ?? 'Test order',
      totalPrice: overrides.totalPrice ?? 0,
      status: overrides.status ?? ('PENDING' as OrderStatus),
    },
  })
  reg.orderIds.push(order.id)
  if (ingredients.length > 0) {
    await prisma.orderIngredientLog.createMany({
      data: ingredients.map((i) => ({
        orderId: order.id,
        inventoryItemId: i.inventoryItemId,
        quantityUsed: i.quantityUsed,
      })),
    })
  }
  return order
}

/**
 * Configures an already-`vi.mock`'d createClient to simulate an authenticated Supabase
 * session for the given { id, email } pair. Pass a fixture User's own { id, email } for the
 * normal case, or a deliberately different id (matching email) to reproduce the admin-lockout
 * scenario (TEST-015).
 */
export function mockAuthSession(
  createClientMock: Mock,
  session: { id: string; email: string | null }
): void {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: session.id, email: session.email } } }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

/** Configures an already-`vi.mock`'d createClient to simulate no signed-in user. */
export function mockNoSession(createClientMock: Mock): void {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}
