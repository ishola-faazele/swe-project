/**
 * Integration: validation expected-error paths — TEST-012.
 *
 * Malformed input is rejected with code: 'VALIDATION' before reaching Prisma, across a
 * representative sample: a non-UUID order id, an oversized ingredient array (>50 entries), and
 * a customer payload with all three contact fields blank.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue({}),
  notifyLowStock: vi.fn().mockResolvedValue({}),
}))

import { createClient } from '@/utils/supabase/server'
import { createOrder, deleteOrder } from '@/app/admin/orders/actions'
import { createCustomer } from '@/app/admin/customers/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  mockAuthSession,
  newRegistry,
  type TestRegistry,
} from './helpers'

const createClientMock = vi.mocked(createClient)

describe('validation expected-error paths (TEST-012)', () => {
  let reg: TestRegistry

  beforeEach(() => {
    reg = newRegistry()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('deleteOrder resolves { ok: false, code: VALIDATION } for a non-UUID id', async () => {
    const admin = await createTestAdmin(reg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    await expect(deleteOrder('not-a-uuid')).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION',
    })
  })

  test('createOrder resolves { ok: false, code: VALIDATION } for an oversized (51-entry) ingredient array', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const ingredients = Array.from({ length: 51 }, () => ({
      inventoryItemId: randomUUID(),
      quantityUsed: 1,
    }))

    const result = await createOrder({
      customerId: customer.id,
      description: 'Pathologically large ingredient list',
      totalPrice: 1,
      ingredients,
    })

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    if (!result.ok) expect(result.error).toContain('cannot list more than 50')
  })

  test('createCustomer resolves { ok: false, code: VALIDATION } when all contact fields are blank', async () => {
    const admin = await createTestAdmin(reg)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    await expect(
      createCustomer({ name: '', email: '', phone: '' })
    ).resolves.toMatchObject({ ok: false, code: 'VALIDATION' })
  })
})
