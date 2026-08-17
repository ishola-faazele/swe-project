"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { Category, type InventoryItem } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { createInventoryItemSchema, idSchema, updateInventoryItemSchema } from '@/lib/validation'

export async function getInventoryItems() {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return await prisma.inventoryItem.findMany({
    orderBy: {
      name: 'asc'
    }
  })
}

export async function createInventoryItem(data: { name: string, currentStock: number, unit: string, minimumThreshold?: number | null, category: Category }): Promise<ActionResult<InventoryItem>> {
  await requireAdmin()

  let item: InventoryItem
  try {
    const input = createInventoryItemSchema.parse(data)

    item = await prisma.inventoryItem.create({
      data: {
        name: input.name,
        currentStock: input.currentStock,
        unit: input.unit,
        category: input.category,
        minimumThreshold: input.minimumThreshold || 0,
      }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not create this inventory item. Please try again.')
  }

  revalidatePath('/admin/inventory')
  return okResult(item)
}

export async function updateInventoryItem(id: string, data: { name?: string, currentStock?: number, unit?: string, minimumThreshold?: number, category?: Category }): Promise<ActionResult<InventoryItem>> {
  await requireAdmin()

  let item: InventoryItem
  try {
    const { id: parsedId, ...input } = updateInventoryItemSchema.parse({ id, ...data })

    item = await prisma.inventoryItem.update({
      where: { id: parsedId },
      data: {
        ...input,
        minimumThreshold: input.minimumThreshold ?? undefined,
      }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this inventory item. Please try again.')
  }

  revalidatePath('/admin/inventory')
  return okResult(item)
}

export async function deleteInventoryItem(id: string): Promise<ActionResult<void>> {
  await requireAdmin()

  try {
    const parsedId = idSchema.parse(id)

    // Pre-check gives a specific, useful count instead of relying only on the P2003 catch.
    // OrderIngredientLog.inventoryItem has no onDelete clause (Prisma defaults to Restrict), so
    // without this the delete surfaces as a raw 500. The small TOCTOU window between this count
    // and the delete is accepted for a single-admin tool; toErrorResult's P2003 branch backstops it.
    const usageCount = await prisma.orderIngredientLog.count({ where: { inventoryItemId: parsedId } })
    if (usageCount > 0) {
      throw new ActionError(
        `Cannot delete this item — it is referenced by ${usageCount} order record${usageCount === 1 ? '' : 's'}. Historical orders keep a permanent link to the ingredients they used.`,
        'FK_CONSTRAINT'
      )
    }

    await prisma.inventoryItem.delete({
      where: { id: parsedId }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not delete this inventory item. Please try again.')
  }

  revalidatePath('/admin/inventory')
  return okResult(undefined)
}
