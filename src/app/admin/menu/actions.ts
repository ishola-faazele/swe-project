"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { mergeDuplicateIngredients } from '@/lib/recipe'
import { requireAdmin } from '@/lib/auth'

export async function getDishes() {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return await prisma.dish.findMany({
    include: {
      ingredients: {
        include: {
          inventoryItem: true
        }
      }
    },
    orderBy: {
      name: 'asc'
    }
  })
}

export async function createDish(data: {
  name: string
  price: number
  ingredients: { inventoryItemId: string; quantityPerDish: number }[]
}) {
  await requireAdmin()

  // DishIngredient is unique on (dishId, inventoryItemId) — picking the same ingredient twice in
  // the recipe builder would throw P2002, so duplicates are summed into one line before insert.
  const recipe = mergeDuplicateIngredients(data.ingredients)

  const dish = await prisma.$transaction(async (tx) => {
    const newDish = await tx.dish.create({
      data: {
        name: data.name,
        price: data.price,
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

    return newDish
  })

  revalidatePath('/admin/menu')
  return dish
}

export async function updateDish(id: string, data: {
  name?: string
  price?: number
  ingredients?: { inventoryItemId: string; quantityPerDish: number }[]
}) {
  await requireAdmin()

  const dish = await prisma.$transaction(async (tx) => {
    // Only replace the recipe when a new one is supplied — a name/price-only edit leaves the
    // existing DishIngredient rows untouched.
    if (data.ingredients) {
      const recipe = mergeDuplicateIngredients(data.ingredients)

      await tx.dishIngredient.deleteMany({
        where: { dishId: id }
      })

      if (recipe.length > 0) {
        await tx.dishIngredient.createMany({
          data: recipe.map(line => ({
            dishId: id,
            inventoryItemId: line.inventoryItemId,
            quantityPerDish: line.quantityPerDish,
          }))
        })
      }
    }

    return await tx.dish.update({
      where: { id },
      data: {
        name: data.name,
        price: data.price,
      }
    })
  })

  revalidatePath('/admin/menu')
  return dish
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
