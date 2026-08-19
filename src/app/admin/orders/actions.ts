"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { OrderStatus, type Order, type User } from '@prisma/client'
import { notifyOrderStatusChange, notifyLowStock } from '@/lib/notifications'
import { requireAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { decrementStockOrThrow, restoreStockForOrder } from '@/lib/inventory'
import { createOrderSchema, idSchema, updateOrderStatusSchema } from '@/lib/validation'
import { expandDishesToIngredients } from '@/lib/recipe'

export async function getOrders() {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
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
  notes?: string | null
  totalPrice: number
  dueDate?: Date | null
  dishes: { dishId: string; quantity: number }[]
  ingredientOverrides?: { inventoryItemId: string; quantityUsed: number }[]
}): Promise<ActionResult<Order>> {
  await requireAdmin() // throws AuthError — uncaught here, rejects the promise for the client

  let order: Order
  let ingredientTotals: { inventoryItemId: string; quantityUsed: number }[]
  try {
    const input = createOrderSchema.parse(data)

    const result = await prisma.$transaction(async (tx) => {
      // Re-read dishes fresh inside the transaction — client-supplied prices and recipes are
      // never trusted for the snapshot or the stock deduction.
      const dishRecords = await tx.dish.findMany({
        where: { id: { in: input.dishes.map(d => d.dishId) } },
        include: { ingredients: true }
      })

      // 1. Create the order
      const newOrder = await tx.order.create({
        data: {
          customerId: input.customerId,
          description: input.description,
          notes: input.notes ?? null,
          totalPrice: input.totalPrice,
          dueDate: input.dueDate ?? null,
          status: 'PENDING'
        }
      })

      // 2. Snapshot each selected dish's name and price onto the order
      for (const selection of input.dishes) {
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

      // 3. Deduct inventory and log ingredients — one merged, guarded line per InventoryItem, so
      // two dishes sharing an ingredient produce a single log row with the summed quantity.
      // Guard first, log second: decrementStockOrThrow throws ActionError('...',
      // 'INSUFFICIENT_STOCK') when stock is short; because that throw happens inside the
      // $transaction callback, Prisma rolls back everything written so far (including newOrder
      // and any earlier logs) before the error reaches the catch block below.
      //
      // When the admin reviewed and adjusted ingredients at creation time (bulk orders), those
      // overrides replace the auto-calculated recipe expansion entirely.
      const ingredientTotals = (input.ingredientOverrides && input.ingredientOverrides.length > 0)
        ? input.ingredientOverrides.filter(l => l.quantityUsed > 0)
        : expandDishesToIngredients(input.dishes, dishRecords)

      for (const line of ingredientTotals) {
        if (line.quantityUsed <= 0) continue

        await decrementStockOrThrow(tx, line.inventoryItemId, line.quantityUsed)

        await tx.orderIngredientLog.create({
          data: {
            orderId: newOrder.id,
            inventoryItemId: line.inventoryItemId,
            quantityUsed: line.quantityUsed
          }
        })
      }

      return { order: newOrder, ingredientTotals }
    })

    order = result.order
    ingredientTotals = result.ingredientTotals
  } catch (err) {
    return toErrorResult(err, 'Could not create this order. Please try again.')
  }

  // After order created, check for low stock items and notify admin
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } })
  if (customer) {
    // Fire-and-forget: notify customer of new order
    notifyOrderStatusChange({
      customerEmail: customer.email,
      customerPhone: customer.phone,
      orderId: order.id,
      orderDescription: order.description,
      newStatus: 'PENDING',
    }).catch(console.error)
  }

  // Check all deducted items for low stock — driven by what was actually deducted, since the
  // deduction list is derived from the selected dishes' recipes rather than passed in directly.
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
  return okResult(order)
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<ActionResult<Order & { customer: User }>> {
  await requireAdmin()

  let order: Order & { customer: User }
  try {
    const input = updateOrderStatusSchema.parse({ id, status })

    order = await prisma.$transaction(async (tx) => {
      // Read inside the transaction so the status check and the stock restoration below are
      // atomic against the same row.
      const existing = await tx.order.findUnique({ where: { id: input.id } })
      if (!existing) throw new ActionError('Order not found.', 'NOT_FOUND')

      // Only a transition INTO cancelled restores stock. Re-cancelling an already-cancelled
      // order makes this false, which is what keeps a double-submit or a slow retry from
      // crediting the same ingredients back twice.
      const enteringCancelled = input.status === 'CANCELLED' && existing.status !== 'CANCELLED'
      const leavingCancelled = existing.status === 'CANCELLED' && input.status !== 'CANCELLED'

      if (leavingCancelled) {
        throw new ActionError(
          'Cancelled orders cannot be reactivated. Create a new order instead.',
          'INVALID_TRANSITION'
        )
      }
      if (enteringCancelled) {
        await restoreStockForOrder(tx, input.id)
      }

      return tx.order.update({
        where: { id: input.id },
        data: { status: input.status },
        include: { customer: true },
      })
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this order.')
  }

  // Fire-and-forget: notify customer of status change
  notifyOrderStatusChange({
    customerEmail: order.customer.email,
    customerPhone: order.customer.phone,
    orderId: order.id,
    orderDescription: order.description,
    newStatus: order.status,
    dueDate: order.dueDate?.toLocaleDateString() ?? null,
  }).catch(console.error)

  revalidatePath('/admin/orders')
  return okResult(order)
}

export async function deleteOrder(id: string): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const parsedId = idSchema.parse(id)

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: parsedId } })
      if (!order) throw new ActionError('Order not found.', 'NOT_FOUND')

      // Only restore stock if it hasn't already been restored by a prior CANCELLED transition,
      // otherwise deleting a cancelled order would credit its ingredients back a second time.
      // Must run before the logs are deleted — it reads the rows it reverts.
      if (order.status !== 'CANCELLED') {
        await restoreStockForOrder(tx, parsedId)
      }

      await tx.orderIngredientLog.deleteMany({
        where: { orderId: parsedId }
      })
      await tx.orderDish.deleteMany({
        where: { orderId: parsedId }
      })
      await tx.order.delete({
        where: { id: parsedId }
      })
    })
  } catch (err) {
    return toErrorResult(err, 'Could not delete this order.')
  }

  revalidatePath('/admin/orders')
  return okResult(undefined)
}
