/**
 * Integration: auth matrix for src/app/admin/orders/[id]/actions.ts — TEST-007.
 *
 * Same three-case pattern as TEST-006 (unauthenticated / CUSTOMER / ADMIN), applied to the
 * single action in this file. `updateOrderIngredients` was superseded by the dish-aware
 * `updateOrderItems` during the Phase 0 + Phase 2 merge (see docs/ROADMAP.md) — same auth
 * behavior (requireAdmin() at the top), new signature. Behavioral coverage for the merged
 * dish + extra-ingredient logic lives in order-item-actions.integration.test.ts; this file
 * stays scoped to the auth matrix.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { AuthError } from '@/lib/auth'
import { updateOrderItems } from '@/app/admin/orders/[id]/actions'
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
const emptyEdit = { dishes: [], extraIngredients: [], totalPrice: 0 }

describe('order-item-actions.ts auth matrix (TEST-007)', () => {
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
    await expect(updateOrderItems(order.id, emptyEdit)).rejects.toThrow(AuthError)
  })

  test('rejects for a CUSTOMER session', async () => {
    mockAuthSession(createClientMock, { id: customer.id, email: customer.email })
    await expect(updateOrderItems(order.id, emptyEdit)).rejects.toThrow(AuthError)
  })

  test('succeeds for an ADMIN session', async () => {
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })
    const result = await updateOrderItems(order.id, emptyEdit)
    expect(result.ok).toBe(true)
  })
})
