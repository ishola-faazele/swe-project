"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin, requireStaffOrAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { decrementStockOrThrow } from '@/lib/inventory'
import { updateOrderDueDateSchema, updateOrderItemsSchema } from '@/lib/validation'
import { expandDishesToIngredients } from '@/lib/recipe'
import type { Order } from '@prisma/client'

/**
 * Sets or clears an order's due date after creation. Touches no stock and no
 * line items, so it needs no transaction — it is a single-column update.
 *
 * `toErrorResult` already maps a Prisma P2025 (row vanished, e.g. the order was
 * deleted in another tab) onto a clean NOT_FOUND result, so no separate
 * existence check is needed here — same convention as its sibling actions.
 */
export async function updateOrderDueDate(
  id: string,
  dueDate: Date | null
): Promise<ActionResult<Order>> {
  await requireStaffOrAdmin()

  let order: Order
  try {
    const input = updateOrderDueDateSchema.parse({ id, dueDate })
    order = await prisma.order.update({
      where: { id: input.id },
      data: { dueDate: input.dueDate ?? null },
    })
  } catch (err) {
    return toErrorResult(err, "Could not update this order's due date.")
  }

  revalidatePath(`/admin/orders/${id}`)
  revalidatePath('/admin/orders')
  return okResult(order)
}

/**
 * The single writer of OrderIngredientLog and OrderDish for the edit flow. Dishes and manually
 * added extra ingredients are saved together, in one transaction, because both feed the same
 * merged deduction — two independent actions would each "delete all logs and recreate them" and
 * silently clobber whichever was saved first.
 */
export async function updateOrderItems(orderId: string, data: {
  dishes: { dishId: string; quantity: number }[]
  extraIngredients: { inventoryItemId: string; quantityUsed: number }[]
  totalPrice: number
}): Promise<ActionResult<void>> {
  await requireStaffOrAdmin()

  try {
    const input = updateOrderItemsSchema.parse({ orderId, ...data })

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: input.orderId } })
      if (!order) throw new ActionError('Order not found.', 'NOT_FOUND')
      // A cancelled order has already had its stock restored. Running the revert-then-reapply
      // logic below against it would deduct stock a second time for an order meant to be inert.
      if (order.status === 'CANCELLED') {
        throw new ActionError('Cannot edit items on a cancelled order.', 'INVALID_TRANSITION')
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

      // 3. Delete old logs and old dish snapshots
      await tx.orderIngredientLog.deleteMany({
        where: { orderId: input.orderId }
      })
      await tx.orderDish.deleteMany({
        where: { orderId: input.orderId }
      })

      // 4. Re-read dish data fresh. Price is deliberately re-snapshotted at edit time: re-saving
      // an order's dish list is an active decision happening now, so it records the price the
      // admin is actually looking at rather than a stale one.
      const dishRecords = await tx.dish.findMany({
        where: { id: { in: input.dishes.map(d => d.dishId) } },
        include: { ingredients: true }
      })

      for (const selection of input.dishes) {
        const dish = dishRecords.find(d => d.id === selection.dishId)
        // Skip a dish that no longer resolves (archived/deleted mid-edit) rather than failing the save.
        if (!dish || selection.quantity <= 0) continue

        await tx.orderDish.create({
          data: {
            orderId: input.orderId,
            dishId: dish.id,
            dishName: dish.name,
            unitPrice: dish.price,
            quantity: selection.quantity
          }
        })
      }

      // 5. Merge dish-derived and manually-added ingredient lines, then apply the new
      // deductions — one log row and one guarded decrement per InventoryItem. The revert above
      // ran first, so the guard here correctly checks against (currentStock + oldQty), not the
      // stale pre-revert value.
      const merged = expandDishesToIngredients(input.dishes, dishRecords, input.extraIngredients)
      for (const line of merged) {
        if (line.quantityUsed <= 0) continue

        await decrementStockOrThrow(tx, line.inventoryItemId, line.quantityUsed)

        await tx.orderIngredientLog.create({
          data: {
            orderId: input.orderId,
            inventoryItemId: line.inventoryItemId,
            quantityUsed: line.quantityUsed
          }
        })
      }

      await tx.order.update({
        where: { id: input.orderId },
        data: { totalPrice: input.totalPrice }
      })
    })
  } catch (err) {
    return toErrorResult(err, "Could not update this order's items.")
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/inventory')
  return okResult(undefined)
}

/**
 * Updates the text details (description and notes) of an order.
 */
export async function updateOrderInfo(
  id: string,
  description: string,
  notes: string | null
): Promise<ActionResult<Order>> {
  await requireStaffOrAdmin()

  let order: Order
  try {
    const { updateOrderInfoSchema } = await import('@/lib/validation')
    const input = updateOrderInfoSchema.parse({ id, description, notes })
    order = await prisma.order.update({
      where: { id: input.id },
      data: { 
        description: input.description,
        notes: input.notes ?? null,
      },
    })
  } catch (err) {
    return toErrorResult(err, "Could not update this order's details.")
  }

  revalidatePath(`/admin/orders/${id}`)
  revalidatePath('/admin/orders')
  return okResult(order)
}
