/**
 * Integration: insufficient-stock expected-error paths — TEST-010.
 *
 * createOrder and updateOrderIngredients both resolve (never reject) to
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
import { updateOrderIngredients } from '@/app/admin/orders/[id]/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestInventoryItem,
  mockAuthSession,
  newRegistry,
  type TestRegistry,
} from './helpers'

const createClientMock = vi.mocked(createClient)

describe('insufficient-stock expected-error paths (TEST-010)', () => {
  let reg: TestRegistry

  beforeEach(() => {
    reg = newRegistry()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('createOrder resolves { ok: false, code: INSUFFICIENT_STOCK } without writing an Order row or touching stock', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg, { currentStock: 10 })
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const stockBefore = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    const orderCountBefore = await prisma.order.count({ where: { customerId: customer.id } })

    await expect(
      createOrder({
        customerId: customer.id,
        description: 'Requests way more than available',
        totalPrice: 100,
        ingredients: [{ inventoryItemId: item.id, quantityUsed: 999 }],
      })
    ).resolves.toMatchObject({ ok: false, code: 'INSUFFICIENT_STOCK' })

    const stockAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(stockAfter.currentStock).toBe(stockBefore.currentStock)

    const orderCountAfter = await prisma.order.count({ where: { customerId: customer.id } })
    expect(orderCountAfter).toBe(orderCountBefore)
  })

  test('updateOrderIngredients resolves { ok: false, code: INSUFFICIENT_STOCK } and leaves the original logs/stock untouched', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg, { currentStock: 10 })
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const created = await createOrder({
      customerId: customer.id,
      description: 'Initial order using 8 of 10',
      totalPrice: 50,
      ingredients: [{ inventoryItemId: item.id, quantityUsed: 8 }],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const stockAfterCreate = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(stockAfterCreate.currentStock).toBe(2) // 10 - 8

    const logsBefore = await prisma.orderIngredientLog.findMany({
      where: { orderId: created.data.id },
    })

    // After accounting for the order's own already-logged 8 units (which the revert-then-
    // reapply logic would credit back to 10 before re-deducting), 999 still exceeds available
    // stock — must fail without leaving any partial write.
    await expect(
      updateOrderIngredients(created.data.id, [{ inventoryItemId: item.id, quantityUsed: 999 }])
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
