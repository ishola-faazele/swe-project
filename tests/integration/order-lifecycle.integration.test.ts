/**
 * Integration: order-lifecycle invariants — TEST-013.
 *
 * The direct verification of the PRD's core integrity success metric: currentStock before
 * order creation equals currentStock after a full create -> cancel (or create -> delete)
 * cycle. Covers cancellation idempotency, delete-after-cancel, delete-without-cancel, un-cancel
 * rejection, and cancelled-order-edit rejection — all sharing the same
 * fixture-order-with-known-ingredients setup pattern.
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
import { createOrder, deleteOrder, updateOrderStatus } from '@/app/admin/orders/actions'
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
import type { User } from '@prisma/client'

const createClientMock = vi.mocked(createClient)

describe('order-lifecycle invariants (TEST-013)', () => {
  let reg: TestRegistry
  let admin: User
  let customer: User

  beforeEach(async () => {
    reg = newRegistry()
    admin = await createTestAdmin(reg)
    customer = await createTestCustomer(reg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('cancellation restores stock to the pre-order level and is idempotent on a repeated cancel', async () => {
    const item = await createTestInventoryItem(reg, { currentStock: 20 })
    const preOrderStock = 20

    const created = await createOrder({
      customerId: customer.id,
      description: 'Idempotency test order',
      totalPrice: 10,
      ingredients: [{ inventoryItemId: item.id, quantityUsed: 5 }],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const afterCreate = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterCreate.currentStock).toBe(preOrderStock - 5)

    const firstCancel = await updateOrderStatus(created.data.id, 'CANCELLED')
    expect(firstCancel.ok).toBe(true)
    const afterFirstCancel = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterFirstCancel.currentStock).toBe(preOrderStock)

    // Repeated cancel of an already-CANCELLED order must not restore stock a second time.
    const secondCancel = await updateOrderStatus(created.data.id, 'CANCELLED')
    expect(secondCancel.ok).toBe(true)
    const afterSecondCancel = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterSecondCancel.currentStock).toBe(preOrderStock)
  })

  test('delete-after-cancel does not double-restore stock', async () => {
    const item = await createTestInventoryItem(reg, { currentStock: 20 })

    const created = await createOrder({
      customerId: customer.id,
      description: 'Delete-after-cancel test order',
      totalPrice: 10,
      ingredients: [{ inventoryItemId: item.id, quantityUsed: 5 }],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const cancelResult = await updateOrderStatus(created.data.id, 'CANCELLED')
    expect(cancelResult.ok).toBe(true)
    const afterCancel = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterCancel.currentStock).toBe(20)

    const deleteResult = await deleteOrder(created.data.id)
    expect(deleteResult.ok).toBe(true)
    const afterDelete = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterDelete.currentStock).toBe(20) // unchanged from the single cancellation restore
  })

  test('delete-without-cancel restores stock exactly once to the pre-order level', async () => {
    const item = await createTestInventoryItem(reg, { currentStock: 20 })

    const created = await createOrder({
      customerId: customer.id,
      description: 'Delete-without-cancel test order',
      totalPrice: 10,
      ingredients: [{ inventoryItemId: item.id, quantityUsed: 5 }],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const afterCreate = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterCreate.currentStock).toBe(15)

    const deleteResult = await deleteOrder(created.data.id)
    expect(deleteResult.ok).toBe(true)
    const afterDelete = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterDelete.currentStock).toBe(20)
  })

  test('rejects moving a CANCELLED order to an active status, leaving it CANCELLED', async () => {
    const item = await createTestInventoryItem(reg, { currentStock: 20 })
    const created = await createOrder({
      customerId: customer.id,
      description: 'Un-cancel rejection test order',
      totalPrice: 10,
      ingredients: [{ inventoryItemId: item.id, quantityUsed: 5 }],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const cancelResult = await updateOrderStatus(created.data.id, 'CANCELLED')
    expect(cancelResult.ok).toBe(true)

    const unCancelResult = await updateOrderStatus(created.data.id, 'PENDING')
    expect(unCancelResult).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' })

    const reFetched = await prisma.order.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(reFetched.status).toBe('CANCELLED')
  })

  test('rejects editing ingredients on a CANCELLED order, leaving logs and stock untouched', async () => {
    const item = await createTestInventoryItem(reg, { currentStock: 20 })
    const created = await createOrder({
      customerId: customer.id,
      description: 'Cancelled-order-edit rejection test order',
      totalPrice: 10,
      ingredients: [{ inventoryItemId: item.id, quantityUsed: 5 }],
    })
    if (!created.ok) throw new Error('fixture setup failed: ' + created.error)
    reg.orderIds.push(created.data.id)

    const cancelResult = await updateOrderStatus(created.data.id, 'CANCELLED')
    expect(cancelResult.ok).toBe(true)

    const logsBefore = await prisma.orderIngredientLog.findMany({
      where: { orderId: created.data.id },
    })
    const stockBefore = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })

    const editResult = await updateOrderIngredients(created.data.id, [
      { inventoryItemId: item.id, quantityUsed: 3 },
    ])
    expect(editResult).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' })

    const logsAfter = await prisma.orderIngredientLog.findMany({
      where: { orderId: created.data.id },
    })
    const stockAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(logsAfter).toEqual(logsBefore)
    expect(stockAfter.currentStock).toBe(stockBefore.currentStock)
  })
})
