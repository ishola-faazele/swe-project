/**
 * Integration: concurrency test for createOrder — TEST-014.
 *
 * Fires two simultaneous createOrder calls against a fixture inventory item with stock
 * sufficient for exactly one of them, against the REAL isolated database (not a mock), and
 * asserts exactly one succeeds — direct verification that the guarded
 * `updateMany({ where: { currentStock: { gte } } })` decrement is race-safe under Postgres
 * READ COMMITTED row-level locking. Both promises must resolve (INSUFFICIENT_STOCK is an
 * expected business failure, not an exception) — uses Promise.all, not Promise.allSettled.
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

describe('createOrder concurrency guard (TEST-014)', () => {
  let reg: TestRegistry

  beforeEach(() => {
    reg = newRegistry()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('exactly one of two simultaneous full-stock orders succeeds; final stock is never negative', async () => {
    const admin = await createTestAdmin(reg)
    const customerA = await createTestCustomer(reg)
    const customerB = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg, { currentStock: 10 })
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const [resultA, resultB] = await Promise.all([
      createOrder({
        customerId: customerA.id,
        description: 'Concurrency order A',
        totalPrice: 10,
        ingredients: [{ inventoryItemId: item.id, quantityUsed: 10 }],
      }),
      createOrder({
        customerId: customerB.id,
        description: 'Concurrency order B',
        totalPrice: 10,
        ingredients: [{ inventoryItemId: item.id, quantityUsed: 10 }],
      }),
    ])

    for (const result of [resultA, resultB]) {
      if (result.ok) reg.orderIds.push(result.data.id)
    }

    const outcomes = [resultA, resultB]
    const succeeded = outcomes.filter((r) => r.ok)
    const failed = outcomes.filter((r) => !r.ok)

    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ ok: false, code: 'INSUFFICIENT_STOCK' })

    const finalItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(finalItem.currentStock).toBeGreaterThanOrEqual(0)
    // 10 (starting stock) - exactly one deduction of 10 = 0. Not -10 (double-deducted), not
    // 10 (zero deductions).
    expect(finalItem.currentStock).toBe(0)
  })
})
