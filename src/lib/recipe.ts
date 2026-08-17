import type { Dish, DishIngredient } from '@prisma/client'

/**
 * Recipe & pricing math for the Menu system.
 *
 * Everything in this file is a PURE function: plain data in, plain data out, no I/O.
 * There are deliberately no imports from `@/lib/prisma` or `next/*` here — only erased
 * type-only imports — so the same functions can run:
 *   - server-side inside a `prisma.$transaction` (fed DB-fresh dish records), and
 *   - client-side in a `*Client.tsx` (fed the dish list already on the page) for live preview.
 */

export type DishWithRecipe = Dish & { ingredients: DishIngredient[] }

export type DishSelection = { dishId: string; quantity: number }

export type RawIngredientLine = { inventoryItemId: string; quantityUsed: number }

/**
 * Expands dish selections into merged, per-InventoryItem deduction totals, optionally merging
 * in raw ingredient lines that don't come from any dish (the edit screen's "Extra Ingredients").
 *
 * Two selected dishes sharing an ingredient produce ONE output line with the summed quantity,
 * so an order gets one `OrderIngredientLog` row per `InventoryItem` (TDD Decision #4).
 *
 * Selections whose `dishId` is absent from `dishes` are skipped rather than throwing: a dish can
 * be archived or deleted by another session between page load and submit, and losing one line is
 * preferable to failing the whole order. Non-positive quantities are skipped for the same reason
 * the write paths skip them — they must not silently subtract from the merged totals.
 *
 * Output order is first-appearance order (dish-derived lines first, then any extra-only items),
 * which keeps results deterministic for callers and tests.
 */
export function expandDishesToIngredients(
  selections: DishSelection[],
  dishes: DishWithRecipe[],
  extraLines: RawIngredientLine[] = []
): RawIngredientLine[] {
  const totals = new Map<string, number>()

  for (const selection of selections) {
    const dish = dishes.find((d) => d.id === selection.dishId)
    if (!dish || selection.quantity <= 0) continue

    for (const ingredient of dish.ingredients) {
      const previous = totals.get(ingredient.inventoryItemId) ?? 0
      totals.set(
        ingredient.inventoryItemId,
        previous + ingredient.quantityPerDish * selection.quantity
      )
    }
  }

  for (const line of extraLines) {
    if (!line.inventoryItemId) continue
    const previous = totals.get(line.inventoryItemId) ?? 0
    totals.set(line.inventoryItemId, previous + line.quantityUsed)
  }

  return Array.from(totals, ([inventoryItemId, quantityUsed]) => ({
    inventoryItemId,
    quantityUsed,
  }))
}

/**
 * Sums `quantity × price` across a dish selection.
 *
 * The caller supplies the price data: server code passes DB-fresh prices, client code passes the
 * same in-memory dish list already rendered on the page. Unresolvable `dishId`s are skipped
 * rather than throwing, matching `expandDishesToIngredients`.
 */
export function computeDishSubtotal(
  selections: DishSelection[],
  dishes: { id: string; price: number }[]
): number {
  let subtotal = 0

  for (const selection of selections) {
    const dish = dishes.find((d) => d.id === selection.dishId)
    if (!dish || selection.quantity <= 0) continue
    subtotal += dish.price * selection.quantity
  }

  return subtotal
}

/**
 * Collapses duplicate `inventoryItemId` entries in a single dish's proposed recipe, summing their
 * `quantityPerDish`.
 *
 * `DishIngredient` carries `@@unique([dishId, inventoryItemId])`, so writing an admin's accidental
 * double-selection of the same ingredient straight through would throw a Prisma `P2002` and fail
 * the whole save. Summing instead is the defensive behaviour the TDD specifies for
 * `createDish`/`updateDish`. Entries with a blank `inventoryItemId` are dropped — they represent
 * a recipe row the admin added but never picked an ingredient for.
 */
export function mergeDuplicateIngredients<T extends { inventoryItemId: string; quantityPerDish: number }>(
  ingredients: T[]
): { inventoryItemId: string; quantityPerDish: number }[] {
  const totals = new Map<string, number>()

  for (const ingredient of ingredients) {
    if (!ingredient.inventoryItemId) continue
    const previous = totals.get(ingredient.inventoryItemId) ?? 0
    totals.set(ingredient.inventoryItemId, previous + ingredient.quantityPerDish)
  }

  return Array.from(totals, ([inventoryItemId, quantityPerDish]) => ({
    inventoryItemId,
    quantityPerDish,
  }))
}
