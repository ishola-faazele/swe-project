"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { expandDishesToIngredients } from '@/lib/recipe'

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
}) {
  await prisma.$transaction(async (tx) => {
    // 1. Get existing logs
    const existingLogs = await tx.orderIngredientLog.findMany({
      where: { orderId }
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
      where: { orderId }
    })
    await tx.orderDish.deleteMany({
      where: { orderId }
    })

    // 4. Re-read dish data fresh. Price is deliberately re-snapshotted at edit time: re-saving an
    // order's dish list is an active decision happening now, so it records the price the admin is
    // actually looking at rather than a stale one.
    const dishRecords = await tx.dish.findMany({
      where: { id: { in: data.dishes.map(d => d.dishId) } },
      include: { ingredients: true }
    })

    for (const selection of data.dishes) {
      const dish = dishRecords.find(d => d.id === selection.dishId)
      // Skip a dish that no longer resolves (archived/deleted mid-edit) rather than failing the save.
      if (!dish || selection.quantity <= 0) continue

      await tx.orderDish.create({
        data: {
          orderId,
          dishId: dish.id,
          dishName: dish.name,
          unitPrice: dish.price,
          quantity: selection.quantity
        }
      })
    }

    // 5. Merge dish-derived and manually-added ingredient lines, then apply the new deductions —
    // one log row and one decrement per InventoryItem.
    const merged = expandDishesToIngredients(data.dishes, dishRecords, data.extraIngredients)
    for (const line of merged) {
      if (line.quantityUsed <= 0) continue

      await tx.inventoryItem.update({
        where: { id: line.inventoryItemId },
        data: { currentStock: { decrement: line.quantityUsed } }
      })

      await tx.orderIngredientLog.create({
        data: {
          orderId,
          inventoryItemId: line.inventoryItemId,
          quantityUsed: line.quantityUsed
        }
      })
    }

    await tx.order.update({
      where: { id: orderId },
      data: { totalPrice: data.totalPrice }
    })
  })

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/inventory')
}
