"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { OrderStatus } from '@prisma/client'

export async function getOrders() {
  return await prisma.order.findMany({
    include: {
      customer: true,
      ingredientLogs: {
        include: {
          inventoryItem: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })
}

export async function createOrder(data: {
  customerId: string
  description: string
  totalPrice: number
  dueDate?: Date | null
  ingredients: { inventoryItemId: string; quantityUsed: number }[]
}) {
  const order = await prisma.$transaction(async (tx) => {
    // 1. Create the order
    const newOrder = await tx.order.create({
      data: {
        customerId: data.customerId,
        description: data.description,
        totalPrice: data.totalPrice,
        dueDate: data.dueDate,
        status: 'PENDING'
      }
    })

    // 2. Log ingredients and deduct inventory
    for (const ingredient of data.ingredients) {
      await tx.orderIngredientLog.create({
        data: {
          orderId: newOrder.id,
          inventoryItemId: ingredient.inventoryItemId,
          quantityUsed: ingredient.quantityUsed
        }
      })

      await tx.inventoryItem.update({
        where: { id: ingredient.inventoryItemId },
        data: {
          currentStock: {
            decrement: ingredient.quantityUsed
          }
        }
      })
    }

    return newOrder
  })

  revalidatePath('/admin/orders')
  return order
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  const item = await prisma.order.update({
    where: { id },
    data: { status }
  })
  
  revalidatePath('/admin/orders')
  return item
}

export async function deleteOrder(id: string) {
  // $transaction is needed to delete logs first
  await prisma.$transaction(async (tx) => {
    // Optionally restore inventory here if deleting? 
    // Usually, if an order is cancelled, we might restore, but if deleted maybe just clean up logs.
    await tx.orderIngredientLog.deleteMany({
      where: { orderId: id }
    })
    await tx.order.delete({
      where: { id }
    })
  })
  
  revalidatePath('/admin/orders')
}
