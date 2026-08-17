"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { OrderStatus } from '@prisma/client'
import { notifyOrderStatusChange, notifyLowStock } from '@/lib/notifications'
import { expandDishesToIngredients } from '@/lib/recipe'

export async function getOrders() {
  return await prisma.order.findMany({
    include: {
      customer: true,
      ingredientLogs: {
        include: {
          inventoryItem: true
        }
      },
      dishes: true
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
  dishes: { dishId: string; quantity: number }[]
}) {
  const { order, ingredientTotals } = await prisma.$transaction(async (tx) => {
    // 1. Re-read dishes fresh inside the transaction — client-supplied prices and recipes are
    // never trusted for the snapshot or the stock deduction.
    const dishRecords = await tx.dish.findMany({
      where: { id: { in: data.dishes.map(d => d.dishId) } },
      include: { ingredients: true }
    })

    // 2. Create the order
    const newOrder = await tx.order.create({
      data: {
        customerId: data.customerId,
        description: data.description,
        totalPrice: data.totalPrice,
        dueDate: data.dueDate,
        status: 'PENDING'
      }
    })

    // 3. Snapshot each selected dish's name and price onto the order
    for (const selection of data.dishes) {
      const dish = dishRecords.find(d => d.id === selection.dishId)
      // A dish archived or deleted by another session between page load and submit no longer
      // resolves — skip that line rather than failing the whole order.
      if (!dish || selection.quantity <= 0) continue

      await tx.orderDish.create({
        data: {
          orderId: newOrder.id,
          dishId: dish.id,
          dishName: dish.name,
          unitPrice: dish.price,
          quantity: selection.quantity
        }
      })
    }

    // 4. Log ingredients and deduct inventory — one merged line per InventoryItem, so two dishes
    // sharing an ingredient produce a single log row with the summed quantity.
    const ingredientTotals = expandDishesToIngredients(data.dishes, dishRecords)
    for (const line of ingredientTotals) {
      if (line.quantityUsed <= 0) continue

      await tx.orderIngredientLog.create({
        data: {
          orderId: newOrder.id,
          inventoryItemId: line.inventoryItemId,
          quantityUsed: line.quantityUsed
        }
      })

      await tx.inventoryItem.update({
        where: { id: line.inventoryItemId },
        data: {
          currentStock: {
            decrement: line.quantityUsed
          }
        }
      })
    }

    return { order: newOrder, ingredientTotals }
  })

  // After order created, check for low stock items and notify admin
  const customer = await prisma.user.findUnique({ where: { id: data.customerId } })
  if (customer) {
    // Fire-and-forget: notify customer of new order
    notifyOrderStatusChange({
      customerEmail: customer.email,
      customerPhone: customer.phone,
      orderId: order.id,
      orderDescription: data.description,
      newStatus: 'PENDING',
    }).catch(console.error)
  }

  // Check all deducted items for low stock — driven by what was actually deducted, since the
  // deduction list is now derived from the selected dishes' recipes rather than passed in.
  for (const line of ingredientTotals) {
    const item = await prisma.inventoryItem.findUnique({ where: { id: line.inventoryItemId } })
    if (item && item.minimumThreshold > 0 && item.currentStock <= item.minimumThreshold) {
      // Send low stock alert (fire-and-forget)
      notifyLowStock({
        itemName: item.name,
        currentStock: item.currentStock,
        unit: item.unit,
        adminEmail: process.env.ADMIN_ALERT_EMAIL,
      }).catch(console.error)
    }
  }

  revalidatePath('/admin/orders')
  return order
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  const order = await prisma.order.update({
    where: { id },
    data: { status },
    include: { customer: true },
  })

  // Fire-and-forget: notify customer of status change
  notifyOrderStatusChange({
    customerEmail: order.customer.email,
    customerPhone: order.customer.phone,
    orderId: order.id,
    orderDescription: order.description,
    newStatus: status,
    dueDate: order.dueDate?.toLocaleDateString() ?? null,
  }).catch(console.error)
  
  revalidatePath('/admin/orders')
  return order
}

export async function deleteOrder(id: string) {
  // $transaction is needed to delete logs first
  await prisma.$transaction(async (tx) => {
    // Optionally restore inventory here if deleting? 
    // Usually, if an order is cancelled, we might restore, but if deleted maybe just clean up logs.
    await tx.orderIngredientLog.deleteMany({
      where: { orderId: id }
    })
    await tx.orderDish.deleteMany({
      where: { orderId: id }
    })
    await tx.order.delete({
      where: { id }
    })
  })
  
  revalidatePath('/admin/orders')
}
