import { Prisma } from '@prisma/client'
import { ActionError } from '@/lib/errors'

/**
 * Atomically decrements InventoryItem.currentStock, refusing to go below zero, inside an
 * existing interactive transaction. Must be called with the `tx` client from
 * prisma.$transaction(async (tx) => {...}) so that a rejection here rolls back everything else
 * done in the same transaction (e.g. the Order row and any earlier ingredient logs already
 * written in this call).
 *
 * The guard MUST stay expressed as a single WHERE-guarded updateMany, never as a SELECT-then-
 * UPDATE: under Postgres READ COMMITTED, `UPDATE ... WHERE id = $1 AND currentStock >= $2`
 * takes a row-level lock before evaluating its WHERE clause, so a concurrent transaction
 * racing for the same row blocks and then re-evaluates against the newly committed stock value.
 * Splitting this into a read followed by a write would reintroduce the negative-stock race
 * this whole phase exists to close.
 */
export async function decrementStockOrThrow(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  quantityUsed: number
): Promise<void> {
  const result = await tx.inventoryItem.updateMany({
    where: { id: inventoryItemId, currentStock: { gte: quantityUsed } },
    data: { currentStock: { decrement: quantityUsed } },
  })

  if (result.count === 0) {
    const item = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } })
    if (!item) {
      throw new ActionError('One of the selected inventory items no longer exists.', 'NOT_FOUND')
    }
    throw new ActionError(
      `Not enough "${item.name}" in stock: have ${item.currentStock} ${item.unit}, need ${quantityUsed}.`,
      'INSUFFICIENT_STOCK'
    )
  }
}

/** Reverts every OrderIngredientLog row for an order back onto InventoryItem.currentStock. */
export async function restoreStockForOrder(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  const logs = await tx.orderIngredientLog.findMany({ where: { orderId } })
  for (const log of logs) {
    await tx.inventoryItem.update({
      where: { id: log.inventoryItemId },
      data: { currentStock: { increment: log.quantityUsed } },
    })
  }
}
