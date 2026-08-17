/**
 * Integration: admin-lockout regression test — TEST-015.
 *
 * Seeds a User row with a Prisma-generated id (i.e. NOT matching any Supabase auth UUID) and a
 * known email, simulates a Supabase session for that same email but a different auth UUID
 * (reproducing the exact divergence src/app/auth/callback/route.ts leaves unreconciled for
 * pre-existing rows), and asserts requireAdmin() still resolves and authorizes via the email
 * fallback. This is the PRD's dedicated regression test for the admin-lockout failure mode.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { getCurrentDbUser, requireAdmin } from '@/lib/auth'
import { getOrders } from '@/app/admin/orders/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  mockAuthSession,
  newRegistry,
  type TestRegistry,
} from './helpers'

const createClientMock = vi.mocked(createClient)

describe('admin-lockout regression (TEST-015)', () => {
  let reg: TestRegistry

  beforeEach(() => {
    reg = newRegistry()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('resolves and authorizes an admin whose Prisma id diverges from the Supabase auth UUID, via the email fallback', async () => {
    // Prisma-generated id, deliberately NOT overridden to match any Supabase UUID — reproduces
    // a row that existed before auth/callback/route.ts's id-reconciliation gap.
    const admin = await createTestAdmin(reg)
    const divergentAuthUUID = randomUUID()
    expect(divergentAuthUUID).not.toBe(admin.id) // sanity: the ids are genuinely different

    mockAuthSession(createClientMock, { id: divergentAuthUUID, email: admin.email })

    const resolved = await getCurrentDbUser()
    expect(resolved?.id).toBe(admin.id)

    await expect(requireAdmin()).resolves.toMatchObject({ id: admin.id, role: 'ADMIN' })

    // End-to-end confirmation: a real hardened action succeeds under this session, not just
    // requireAdmin() in isolation.
    const orders = await getOrders()
    expect(Array.isArray(orders)).toBe(true)
  })
})
