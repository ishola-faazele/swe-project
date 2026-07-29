"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function updateOrderIngredients(
  orderId: string, 
  ingredients: { inventoryItemId: string, quantityUsed: number }[]
) {
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

    // 3. Delete old logs
    await tx.orderIngredientLog.deleteMany({
      where: { orderId }
    })

    // 4. Apply new deductions and create new logs
    for (const ing of ingredients) {
      if (ing.quantityUsed <= 0) continue
      
      await tx.inventoryItem.update({
        where: { id: ing.inventoryItemId },
        data: { currentStock: { decrement: ing.quantityUsed } }
      })

      await tx.orderIngredientLog.create({
        data: {
          orderId,
          inventoryItemId: ing.inventoryItemId,
          quantityUsed: ing.quantityUsed
        }
      })
    }
  })
  
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/inventory')
}
