"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { type Dish } from '@prisma/client'
import { mergeDuplicateIngredients } from '@/lib/recipe'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { createDishSchema, updateDishSchema } from '@/lib/validation'

export async function getDishes() {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return await prisma.dish.findMany({
    include: {
      ingredients: {
        include: {
          inventoryItem: true
        }
      },
      // Required by MenuClient's gallery cards, which render the lowest-position IMAGE as the
      // dish's cover. admin/orders/* also call this and simply never read the extra field.
      media: {
        orderBy: { position: 'asc' }
      }
    },
    orderBy: {
      name: 'asc'
    }
  })
}

/**
 * Migrated from this file's older bare-throw/no-validation pattern to the newer zod +
 * ActionResult convention — the two are one indivisible convention everywhere else in this
 * codebase, and this action previously had ZERO input validation (a negative price or empty name
 * reached Prisma unchecked).
 *
 * A dish's photos and videos are NOT set here. They are DishMedia rows, each attached
 * independently by addDishMedia (see ./[id]/actions.ts) the moment its upload succeeds, never
 * bundled into this action's payload.
 *
 * toggleDishActive below is deliberately NOT migrated, and deleteDish only far enough to clean up
 * its new DishMedia foreign key. This file is knowingly left in a mixed state; that is a
 * confirmed decision, not an oversight.
 */
export async function createDish(data: {
  name: string
  price: number
  servingSize?: number
  ingredients: { inventoryItemId: string; quantityPerDish: number }[]
  media?: { url: string; type: 'IMAGE' | 'VIDEO' }[]
}): Promise<ActionResult<Dish>> {
  await requireAdmin()

  try {
    const input = createDishSchema.parse(data)

    // DishIngredient is unique on (dishId, inventoryItemId) — picking the same ingredient twice in
    // the recipe builder would throw P2002, so duplicates are summed into one line before insert.
    const recipe = mergeDuplicateIngredients(input.ingredients ?? [])

    const dish = await prisma.$transaction(async (tx) => {
      const newDish = await tx.dish.create({
        data: {
          name: input.name,
          price: input.price,
          servingSize: input.servingSize ?? 1,
        }
      })

      if (recipe.length > 0) {
        await tx.dishIngredient.createMany({
          data: recipe.map(line => ({
            dishId: newDish.id,
            inventoryItemId: line.inventoryItemId,
            quantityPerDish: line.quantityPerDish,
          }))
        })
      }

      if (input.media && input.media.length > 0) {
        await tx.dishMedia.createMany({
          data: input.media.map((m, index) => ({
            dishId: newDish.id,
            url: m.url,
            type: m.type,
            position: index
          }))
        })
      }

      return newDish
    })

    revalidatePath('/admin/menu')
    return okResult(dish)
  } catch (err) {
    return toErrorResult(err, 'Could not create this dish. Please try again.')
  }
}

/** Same migration as createDish above — see its header for why this file is mixed-convention. */
export async function updateDish(id: string, data: {
  name?: string
  price?: number
  servingSize?: number
  ingredients?: { inventoryItemId: string; quantityPerDish: number }[]
}): Promise<ActionResult<Dish>> {
  await requireAdmin()

  try {
    const input = updateDishSchema.parse({ id, ...data })

    const dish = await prisma.$transaction(async (tx) => {
      // Only replace the recipe when a new one is supplied — a name/price-only edit leaves the
      // existing DishIngredient rows untouched.
      if (input.ingredients) {
        const recipe = mergeDuplicateIngredients(input.ingredients)

        await tx.dishIngredient.deleteMany({
          where: { dishId: input.id }
        })

        if (recipe.length > 0) {
          await tx.dishIngredient.createMany({
            data: recipe.map(line => ({
              dishId: input.id,
              inventoryItemId: line.inventoryItemId,
              quantityPerDish: line.quantityPerDish,
            }))
          })
        }
      }

      return await tx.dish.update({
        where: { id: input.id },
        data: {
          name: input.name,
          price: input.price,
          servingSize: input.servingSize,
        }
      })
    })

    revalidatePath('/admin/menu')
    return okResult(dish)
  } catch (err) {
    return toErrorResult(err, 'Could not update this dish. Please try again.')
  }
}

export async function deleteDish(id: string) {
  await requireAdmin()

  // A dish that past orders reference can never be hard-deleted — OrderDish rows are the order's
  // historical record, and the relation is RESTRICT. Archive it instead so history stays intact.
  const orderReferences = await prisma.orderDish.count({ where: { dishId: id } })

  if (orderReferences > 0) {
    await prisma.dish.update({
      where: { id },
      data: { isActive: false }
    })

    revalidatePath('/admin/menu')
    return { archived: true }
  }

  await prisma.$transaction(async (tx) => {
    await tx.dishIngredient.deleteMany({
      where: { dishId: id }
    })
    // Required, not optional. DishMedia.dish has no onDelete clause (RESTRICT, matching this
    // schema's convention), so a hard delete without this line throws an unhandled P2003 the
    // instant a dish with ANY attached media is deleted with zero order history.
    // The bucket objects these rows pointed at are deliberately NOT removed from MinIO — the same
    // permanent, uniform no-cleanup policy as everywhere else in this feature.
    await tx.dishMedia.deleteMany({
      where: { dishId: id }
    })
    await tx.dish.delete({
      where: { id }
    })
  })

  revalidatePath('/admin/menu')
  return { archived: false }
}

export async function toggleDishActive(id: string, isActive: boolean) {
  await requireAdmin()

  const dish = await prisma.dish.update({
    where: { id },
    data: { isActive }
  })

  revalidatePath('/admin/menu')
  return dish
}
