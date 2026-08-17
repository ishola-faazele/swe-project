/**
 * Unit tests for decrementStockOrThrow() and restoreStockForOrder() — TEST-001, TEST-002.
 *
 * Both functions take a Prisma.TransactionClient. These tests never construct a real
 * PrismaClient or open a database connection — `tx` is a hand-rolled mock exposing only the
 * methods each function actually calls, per docs/tasks-integrity-hardening.md TEST-001/TEST-002
 * ("Exercise against a mocked Prisma.TransactionClient").
 */
import { describe, expect, test, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { ActionError } from '@/lib/errors'
import { decrementStockOrThrow, restoreStockForOrder } from '@/lib/inventory'

function makeMockTx() {
  return {
    inventoryItem: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orderIngredientLog: {
      findMany: vi.fn(),
    },
  }
}

describe('decrementStockOrThrow', () => {
  test('resolves without throwing when stock is sufficient, calling updateMany with the guarded where/data shape', async () => {
    const tx = makeMockTx()
    tx.inventoryItem.updateMany.mockResolvedValue({ count: 1 })

    await expect(
      decrementStockOrThrow(tx as unknown as Prisma.TransactionClient, 'item-1', 5)
    ).resolves.toBeUndefined()

    expect(tx.inventoryItem.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1', currentStock: { gte: 5 } },
      data: { currentStock: { decrement: 5 } },
    })
    // The guard succeeded on the single updateMany call — no fallback findUnique needed.
    expect(tx.inventoryItem.findUnique).not.toHaveBeenCalled()
  })

  test('throws ActionError with code INSUFFICIENT_STOCK, naming the item/have/unit/need, when stock is short', async () => {
    const tx = makeMockTx()
    tx.inventoryItem.updateMany.mockResolvedValue({ count: 0 })
    tx.inventoryItem.findUnique.mockResolvedValue({
      id: 'item-1',
      name: 'Jollof Rice',
      currentStock: 2,
      unit: 'kg',
    })

    const call = decrementStockOrThrow(tx as unknown as Prisma.TransactionClient, 'item-1', 5)

    await expect(call).rejects.toThrow(ActionError)
    await expect(call).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' })
    await expect(call).rejects.toMatchObject({
      message: 'Not enough "Jollof Rice" in stock: have 2 kg, need 5.',
    })
  })

  test('throws ActionError with code NOT_FOUND when the item no longer exists', async () => {
    const tx = makeMockTx()
    tx.inventoryItem.updateMany.mockResolvedValue({ count: 0 })
    tx.inventoryItem.findUnique.mockResolvedValue(null)

    const call = decrementStockOrThrow(tx as unknown as Prisma.TransactionClient, 'missing-item', 5)

    await expect(call).rejects.toThrow(ActionError)
    await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('restoreStockForOrder', () => {
  test('increments every distinct referenced InventoryItem once per logged quantity', async () => {
    const tx = makeMockTx()
    tx.orderIngredientLog.findMany.mockResolvedValue([
      { id: 'log-1', orderId: 'order-1', inventoryItemId: 'item-a', quantityUsed: 3 },
      { id: 'log-2', orderId: 'order-1', inventoryItemId: 'item-b', quantityUsed: 7 },
    ])
    tx.inventoryItem.update.mockResolvedValue({})

    await restoreStockForOrder(tx as unknown as Prisma.TransactionClient, 'order-1')

    expect(tx.orderIngredientLog.findMany).toHaveBeenCalledWith({ where: { orderId: 'order-1' } })
    expect(tx.inventoryItem.update).toHaveBeenCalledTimes(2)
    expect(tx.inventoryItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'item-a' },
      data: { currentStock: { increment: 3 } },
    })
    expect(tx.inventoryItem.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'item-b' },
      data: { currentStock: { increment: 7 } },
    })
  })

  test('is a no-op when the order has no logged ingredients', async () => {
    const tx = makeMockTx()
    tx.orderIngredientLog.findMany.mockResolvedValue([])

    await restoreStockForOrder(tx as unknown as Prisma.TransactionClient, 'order-empty')

    expect(tx.inventoryItem.update).not.toHaveBeenCalled()
  })
})
