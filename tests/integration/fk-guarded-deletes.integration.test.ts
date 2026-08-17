/**
 * Integration: FK-referenced-delete expected-error paths — TEST-011.
 *
 * deleteCustomer and deleteInventoryItem resolve { ok: false, code: 'FK_CONSTRAINT' } with a
 * specific count-based message when the target record has existing references, instead of
 * throwing an unhandled P2003.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { deleteCustomer } from '@/app/admin/customers/actions'
import { deleteInventoryItem } from '@/app/admin/inventory/actions'
import {
  cleanupRegistry,
  createTestAdmin,
  createTestCustomer,
  createTestInventoryItem,
  createTestOrder,
  mockAuthSession,
  newRegistry,
  type TestRegistry,
} from './helpers'

const createClientMock = vi.mocked(createClient)

describe('FK-referenced-delete expected-error paths (TEST-011)', () => {
  let reg: TestRegistry

  beforeEach(() => {
    reg = newRegistry()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupRegistry(reg)
  })

  test('deleteCustomer resolves { ok: false, code: FK_CONSTRAINT } with the exact order count', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    await createTestOrder(reg, customer.id)
    await createTestOrder(reg, customer.id)
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const result = await deleteCustomer(customer.id)

    expect(result).toMatchObject({ ok: false, code: 'FK_CONSTRAINT' })
    if (!result.ok) expect(result.error).toContain('2 orders on file')

    expect(await prisma.user.findUnique({ where: { id: customer.id } })).not.toBeNull()
  })

  test('deleteInventoryItem resolves { ok: false, code: FK_CONSTRAINT } with the exact usage count', async () => {
    const admin = await createTestAdmin(reg)
    const customer = await createTestCustomer(reg)
    const item = await createTestInventoryItem(reg)
    await createTestOrder(reg, customer.id, [{ inventoryItemId: item.id, quantityUsed: 1 }])
    mockAuthSession(createClientMock, { id: admin.id, email: admin.email })

    const result = await deleteInventoryItem(item.id)

    expect(result).toMatchObject({ ok: false, code: 'FK_CONSTRAINT' })
    if (!result.ok) expect(result.error).toContain('referenced by 1 order record')

    expect(await prisma.inventoryItem.findUnique({ where: { id: item.id } })).not.toBeNull()
  })
})
