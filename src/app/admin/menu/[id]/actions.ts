"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { addDishMediaSchema, reorderDishMediaSchema, idSchema } from '@/lib/validation'
import type { DishMedia } from '@prisma/client'

/**
 * A dish's photos and videos, managed one item at a time.
 *
 * Every action here persists immediately on its own — there is no surrounding form to defer to and
 * no "Save" button gating any of them. That is the point: adding a third photo to an already-saved
 * dish must never require re-submitting that dish's name, price, or recipe.
 *
 * Position convention, shared by all three:
 * - A new item is assigned `currentMax + 1` (or 0 for the first), computed inside the same
 *   transaction that inserts it.
 * - Positions are NEVER renumbered on removal. [0, 1, 2] minus position 1 leaves [0, 2] — a gap,
 *   not a bug. The cover is recomputed on every read as "lowest remaining position", so removing
 *   the current cover promotes the next one automatically, with zero additional writes.
 */
export async function addDishMedia(
  input: { dishId: string; url: string; type: 'IMAGE' | 'VIDEO' }
): Promise<ActionResult<DishMedia>> {
  await requireAdmin()

  try {
    const parsed = addDishMediaSchema.parse(input)

    const media = await prisma.$transaction(async (tx) => {
      // Two admin tabs adding to the same dish at once can both read this same max and assign the
      // same position. Accepted as harmless: a tie only affects which of the two sorts first,
      // never correctness — nothing ever looks a row up BY position.
      const current = await tx.dishMedia.aggregate({
        where: { dishId: parsed.dishId },
        _max: { position: true },
      })

      return tx.dishMedia.create({
        data: {
          dishId: parsed.dishId,
          url: parsed.url,
          type: parsed.type,
          position: (current._max.position ?? -1) + 1,
        },
      })
    })

    revalidatePath(`/admin/menu/${parsed.dishId}`)
    revalidatePath('/admin/menu') // the gallery card's cover may have just been set for the first time
    return okResult(media)
  } catch (err) {
    return toErrorResult(err, 'Could not attach this media. Please try again.')
  }
}

export async function removeDishMedia(id: string): Promise<ActionResult<{ dishId: string }>> {
  await requireAdmin()

  try {
    const parsedId = idSchema.parse(id)

    // No renumbering of the remaining positions — see this file's header. The bucket object this
    // row pointed at is deliberately NOT deleted from MinIO, matching this feature's permanent
    // no-cleanup policy everywhere else.
    const deleted = await prisma.dishMedia.delete({ where: { id: parsedId } })

    revalidatePath(`/admin/menu/${deleted.dishId}`)
    revalidatePath('/admin/menu')
    return okResult({ dishId: deleted.dishId })
  } catch (err) {
    return toErrorResult(err, 'Could not remove this media. Please try again.')
  }
}

/**
 * Swaps one item's `position` with its immediate neighbour's, in a single transaction.
 *
 * Note this does NOT revalidate '/admin/menu': reordering only ever changes the order among a
 * dish's own media, which the gallery card doesn't show. The card's cover can change on add or
 * remove, not on a swap between two internal positions.
 */
export async function reorderDishMedia(
  input: { dishId: string; mediaId: string; direction: 'up' | 'down' }
): Promise<ActionResult<DishMedia[]>> {
  await requireAdmin()

  try {
    const parsed = reorderDishMediaSchema.parse(input)

    const items = await prisma.dishMedia.findMany({
      where: { dishId: parsed.dishId },
      orderBy: { position: 'asc' },
    })

    const index = items.findIndex(m => m.id === parsed.mediaId)
    if (index === -1) {
      throw new ActionError('That media item no longer exists.', 'NOT_FOUND')
    }

    const swapIndex = parsed.direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= items.length) {
      // Already at the boundary. The UI disables the button here, so this is defense-in-depth
      // against a stale render, not an expected everyday path — deliberately still ok:true, since
      // nothing actually went wrong.
      return okResult(items)
    }

    const [a, b] = [items[index], items[swapIndex]]
    const updated = await prisma.$transaction([
      prisma.dishMedia.update({ where: { id: a.id }, data: { position: b.position } }),
      prisma.dishMedia.update({ where: { id: b.id }, data: { position: a.position } }),
    ])

    revalidatePath(`/admin/menu/${parsed.dishId}`)
    return okResult(updated.sort((x, y) => x.position - y.position))
  } catch (err) {
    return toErrorResult(err, 'Could not reorder media. Please try again.')
  }
}
