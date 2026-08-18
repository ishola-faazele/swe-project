"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { Category, type InventoryItem } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { createInventoryItemSchema, idSchema, updateInventoryItemSchema } from '@/lib/validation'

/**
 * The single enforcement point for "what counts as a selectable inventory item".
 *
 * Defaults to active-only, which is what every picker/reference call site wants (the recipe
 * builder, the order-detail extra-ingredients editor, OrderClient's fetched-but-unused prop) —
 * an archived item must never be offered for a NEW recipe row or order line. Only the inventory
 * management screen itself opts into `includeArchived: true`, so its reveal toggle has archived
 * rows to show and restore. Historical reads (a past order's OrderIngredientLog rows) never come
 * through here at all — they join `inventoryItem` directly — so archiving can't rewrite history.
 */
export async function getInventoryItems(
  options: { includeArchived?: boolean } = {}
): Promise<InventoryItem[]> {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return await prisma.inventoryItem.findMany({
    where: options.includeArchived ? undefined : { isActive: true },
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

export async function deleteInventoryItem(id: string): Promise<ActionResult<{ archived: boolean }>> {
  await requireAdmin()

  try {
    const parsedId = idSchema.parse(id)

    // TWO independent relations point at InventoryItem, and neither declares an onDelete clause,
    // so both default to RESTRICT: OrderIngredientLog (what a past order actually consumed) and
    // DishIngredient (what a dish's recipe calls for). A recipe can reference an ingredient that
    // has never once been ordered, so counting only OrderIngredientLog — as this pre-check used
    // to — let that case slip through to a raw P2003 at the database. Both must be counted.
    const [orderUsageCount, recipeUsageCount] = await Promise.all([
      prisma.orderIngredientLog.count({ where: { inventoryItemId: parsedId } }),
      prisma.dishIngredient.count({ where: { inventoryItemId: parsedId } }),
    ])

    if (orderUsageCount > 0 || recipeUsageCount > 0) {
      // Referenced somewhere — archive instead of erroring, exactly like deleteDish. The row
      // genuinely cannot be hard-deleted, and history has to keep resolving its name and unit.
      await prisma.inventoryItem.update({
        where: { id: parsedId },
        data: { isActive: false }
      })

      revalidatePath('/admin/inventory')
      return okResult({ archived: true })
    }

    // Unreferenced by both tables — safe to hard-delete. The small TOCTOU window between the
    // counts and this delete is accepted for a single-admin tool; toErrorResult's P2003 branch
    // backstops it.
    await prisma.inventoryItem.delete({
      where: { id: parsedId }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not delete this inventory item. Please try again.')
  }

  revalidatePath('/admin/inventory')
  return okResult({ archived: false })
}

/**
 * Explicit, manual archive/restore — the counterpart to deleteInventoryItem's automatic
 * archive-on-conflict fallback, mirroring toggleDishActive's relationship to deleteDish.
 * Restoring is unconditional: bringing an item back into the pickers references nothing.
 */
export async function toggleInventoryItemActive(id: string, isActive: boolean): Promise<ActionResult<InventoryItem>> {
  await requireAdmin()

  let item: InventoryItem
  try {
    const parsedId = idSchema.parse(id)

    item = await prisma.inventoryItem.update({
      where: { id: parsedId },
      data: { isActive }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this inventory item. Please try again.')
  }

  revalidatePath('/admin/inventory')
  return okResult(item)
}
