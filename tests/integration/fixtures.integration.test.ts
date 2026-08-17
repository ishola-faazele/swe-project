/**
 * Smoke test for the shared fixture/cleanup helpers themselves — TEST-005.
 *
 * Confirms createTestAdmin()/createTestInventoryItem() actually write rows to the isolated
 * rosty_integrity_test database, and that cleanupRegistry() leaves zero residual rows behind
 * (verified by a row-count check before/after), before any other integration test relies on
 * these helpers.
 */
import { describe, expect, test } from 'vitest'
import { prisma } from '@/lib/prisma'
import { cleanupRegistry, createTestAdmin, createTestInventoryItem, newRegistry } from './helpers'

describe('integration test fixture helpers (TEST-005)', () => {
  test('creates an admin and an inventory item, then cleans up leaving zero residual rows', async () => {
    const usersBefore = await prisma.user.count()
    const itemsBefore = await prisma.inventoryItem.count()

    const reg = newRegistry()
    const admin = await createTestAdmin(reg)
    const item = await createTestInventoryItem(reg)

    expect(admin.role).toBe('ADMIN')
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull()
    expect(await prisma.inventoryItem.findUnique({ where: { id: item.id } })).not.toBeNull()
    expect(await prisma.user.count()).toBe(usersBefore + 1)
    expect(await prisma.inventoryItem.count()).toBe(itemsBefore + 1)

    await cleanupRegistry(reg)

    expect(await prisma.user.count()).toBe(usersBefore)
    expect(await prisma.inventoryItem.count()).toBe(itemsBefore)
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).toBeNull()
    expect(await prisma.inventoryItem.findUnique({ where: { id: item.id } })).toBeNull()
  })
})
