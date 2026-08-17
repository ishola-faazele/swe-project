"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { decrementStockOrThrow } from '@/lib/inventory'
import { updateOrderIngredientsSchema } from '@/lib/validation'

export async function updateOrderIngredients(
  orderId: string,
  ingredients: { inventoryItemId: string, quantityUsed: number }[]
): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const input = updateOrderIngredientsSchema.parse({ orderId, ingredients })

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: input.orderId } })
      if (!order) throw new ActionError('Order not found.', 'NOT_FOUND')
      // A cancelled order has already had its stock restored. Running the revert-then-reapply
      // logic below against it would deduct stock a second time for an order meant to be inert.
      if (order.status === 'CANCELLED') {
        throw new ActionError('Cannot edit ingredients on a cancelled order.', 'INVALID_TRANSITION')
      }

      // 1. Get existing logs
      const existingLogs = await tx.orderIngredientLog.findMany({
        where: { orderId: input.orderId }
      })

      // 2. Revert previous inventory deductions
      for (const log of existingLogs) {
        await tx.inventoryItem.update({
          where: { id: log.inventoryItemId },
          data: { currentStock: { increment: log.quantityUsed } }
        })
      }

      // 3. Delete old logs
      await tx.orderIngredientLog.deleteMany({
        where: { orderId: input.orderId }
      })

      // 4. Apply new deductions and create new logs
      for (const ing of input.ingredients) {
        if (ing.quantityUsed <= 0) continue

        // Guard runs AFTER the revert above, so it correctly checks against
        // (currentStock + oldQty), not the stale pre-revert value.
        await decrementStockOrThrow(tx, ing.inventoryItemId, ing.quantityUsed)

        await tx.orderIngredientLog.create({
          data: {
            orderId: input.orderId,
            inventoryItemId: ing.inventoryItemId,
            quantityUsed: ing.quantityUsed
          }
        })
      }
    })
  } catch (err) {
    return toErrorResult(err, "Could not update this order's ingredients.")
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/inventory')
  return okResult(undefined)
}
