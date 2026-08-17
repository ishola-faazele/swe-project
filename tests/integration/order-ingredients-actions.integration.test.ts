/**
 * Integration: auth matrix for src/app/admin/orders/[id]/actions.ts — TEST-007.
 *
 * Same three-case pattern as TEST-006 (unauthenticated / CUSTOMER / ADMIN), applied to the
 * single action in this file.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { AuthError } from '@/lib/auth'
import { updateOrderIngredients } from '@/app/admin/orders/[id]/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestOrder,
  mockAuthSession,
  mockNoSession,
  newRegistry,
  type TestRegistry,
} from './helpers'
import type { Order, User } from '@prisma/client'

const createClientMock = vi.mocked(createClient)

describe('order-ingredients-actions.ts auth matrix (TEST-007)', () => {
  let reg: TestRegistry
  let admin: User
  let customer: User
  let order: Order

  beforeEach(async () => {
    reg = newRegistry()
    admin = await createTestAdmin(reg)
    customer = await createTestCustomer(reg)
    order = await createTestOrder(reg, customer.id)
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('rejects when unauthenticated', async () => {
    mockNoSession(createClientMock)
    await expect(updateOrderIngredients(order.id, [])).rejects.toThrow(AuthError)
  })

  test('rejects for a CUSTOMER session', async () => {
    mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
    await expect(updateOrderIngredients(order.id, [])).rejects.toThrow(AuthError)
  })

  test('succeeds for an ADMIN session', async () => {
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
    const result = await updateOrderIngredients(order.id, [])
    expect(result.ok).toBe(true)
  })
})
