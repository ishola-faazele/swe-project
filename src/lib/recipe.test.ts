/**
 * Unit tests for src/lib/recipe.ts — the pure recipe/pricing math at the core of the Menu &
 * Recipe System feature. Zero Prisma, zero Next.js runtime, zero I/O: every case here is
 * constructed from plain fixture objects, matching the module's own stated design goal of being
 * exercisable with no database and no Next.js runtime.
 */
import { describe, expect, it } from 'vitest'
import {
  computeDishSubtotal,
  expandDishesToIngredients,
  mergeDuplicateIngredients,
  type DishWithRecipe,
} from './recipe'

// Minimal DishIngredient fixture builder — only the fields expandDishesToIngredients reads.
function ingredient(inventoryItemId: string, quantityPerDish: number) {
  return {
    id: `di-${inventoryItemId}-${quantityPerDish}`,
    dishId: 'unused',
    inventoryItemId,
    quantityPerDish,
    createdAt: new Date('2026-01-01'),
  }
}

// Minimal Dish fixture builder — only the fields expandDishesToIngredients/computeDishSubtotal read.
function dish(id: string, price: number, ingredients: ReturnType<typeof ingredient>[]): DishWithRecipe {
  return {
    id,
    shortId: 1,
    name: `Dish ${id}`,
    price,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ingredients,
  }
}

const RICE = 'inv-rice'
const TOMATOES = 'inv-tomatoes'
const CHICKEN = 'inv-chicken'

describe('expandDishesToIngredients', () => {
  it('returns an empty array for an empty selection', () => {
    expect(expandDishesToIngredients([], [])).toEqual([])
  })

  it('expands a single dish selection into quantityPerDish × quantity per ingredient', () => {
    const jollof = dish('jollof', 1200, [ingredient(RICE, 0.25), ingredient(TOMATOES, 0.15)])

    const result = expandDishesToIngredients([{ dishId: 'jollof', quantity: 4 }], [jollof])

    expect(result).toEqual(
      expect.arrayContaining([
        { inventoryItemId: RICE, quantityUsed: 1 }, // 0.25 * 4
        { inventoryItemId: TOMATOES, quantityUsed: 0.6 }, // 0.15 * 4
      ])
    )
    expect(result).toHaveLength(2)
  })

  it('merges two dishes that share an ingredient into ONE line with the summed quantity', () => {
    const jollof = dish('jollof', 1200, [ingredient(RICE, 0.25)])
    const friedRice = dish('fried-rice', 1300, [ingredient(RICE, 0.25), ingredient(CHICKEN, 0.1)])

    const result = expandDishesToIngredients(
      [
        { dishId: 'jollof', quantity: 2 }, // 0.5 rice
        { dishId: 'fried-rice', quantity: 3 }, // 0.75 rice, 0.3 chicken
      ],
      [jollof, friedRice]
    )

    const riceLine = result.find((l) => l.inventoryItemId === RICE)
    const chickenLine = result.find((l) => l.inventoryItemId === CHICKEN)
    expect(result).toHaveLength(2) // one row per InventoryItem, not one per dish
    expect(riceLine?.quantityUsed).toBeCloseTo(1.25)
    expect(chickenLine?.quantityUsed).toBeCloseTo(0.3)
  })

  it('skips a dishId not present in the supplied dishes array without throwing', () => {
    const jollof = dish('jollof', 1200, [ingredient(RICE, 0.25)])

    const result = expandDishesToIngredients(
      [
        { dishId: 'jollof', quantity: 2 },
        { dishId: 'archived-mid-submit', quantity: 5 },
      ],
      [jollof]
    )

    expect(result).toEqual([{ inventoryItemId: RICE, quantityUsed: 0.5 }])
  })

  it('skips a selection with non-positive quantity', () => {
    const jollof = dish('jollof', 1200, [ingredient(RICE, 0.25)])

    expect(expandDishesToIngredients([{ dishId: 'jollof', quantity: 0 }], [jollof])).toEqual([])
    expect(expandDishesToIngredients([{ dishId: 'jollof', quantity: -3 }], [jollof])).toEqual([])
  })

  it('merges extraLines into the same per-item totals as dish-derived lines', () => {
    const jollof = dish('jollof', 1200, [ingredient(RICE, 0.25)])

    const result = expandDishesToIngredients(
      [{ dishId: 'jollof', quantity: 2 }], // 0.5 rice
      [jollof],
      [{ inventoryItemId: RICE, quantityUsed: 1.5 }, { inventoryItemId: CHICKEN, quantityUsed: 2 }]
    )

    expect(result).toEqual(
      expect.arrayContaining([
        { inventoryItemId: RICE, quantityUsed: 2 }, // 0.5 dish-derived + 1.5 extra
        { inventoryItemId: CHICKEN, quantityUsed: 2 }, // extra-only line
      ])
    )
    expect(result).toHaveLength(2)
  })

  it('drops an extra line with a blank inventoryItemId', () => {
    const jollof = dish('jollof', 1200, [ingredient(RICE, 0.25)])

    const result = expandDishesToIngredients(
      [{ dishId: 'jollof', quantity: 2 }],
      [jollof],
      [{ inventoryItemId: '', quantityUsed: 5 }]
    )

    expect(result).toEqual([{ inventoryItemId: RICE, quantityUsed: 0.5 }])
  })

  it('orders output as first-appearance: dish-derived lines before extra-only lines', () => {
    const friedRice = dish('fried-rice', 1300, [ingredient(CHICKEN, 0.1)])

    const result = expandDishesToIngredients(
      [{ dishId: 'fried-rice', quantity: 1 }],
      [friedRice],
      [{ inventoryItemId: TOMATOES, quantityUsed: 2 }, { inventoryItemId: RICE, quantityUsed: 1 }]
    )

    expect(result.map((l) => l.inventoryItemId)).toEqual([CHICKEN, TOMATOES, RICE])
  })
})

describe('computeDishSubtotal', () => {
  it('returns 0 for an empty selection', () => {
    expect(computeDishSubtotal([], [])).toBe(0)
  })

  it('sums price × quantity across the selection', () => {
    const dishes = [
      { id: 'jollof', price: 1200 },
      { id: 'meat-pie', price: 350 },
    ]

    const total = computeDishSubtotal(
      [
        { dishId: 'jollof', quantity: 2 },
        { dishId: 'meat-pie', quantity: 5 },
      ],
      dishes
    )

    expect(total).toBe(1200 * 2 + 350 * 5)
  })

  it('skips a dishId not present in the supplied dishes array without throwing', () => {
    const dishes = [{ id: 'jollof', price: 1200 }]

    const total = computeDishSubtotal(
      [
        { dishId: 'jollof', quantity: 1 },
        { dishId: 'deleted-dish', quantity: 10 },
      ],
      dishes
    )

    expect(total).toBe(1200)
  })

  it('skips a selection with non-positive quantity', () => {
    const dishes = [{ id: 'jollof', price: 1200 }]
    expect(computeDishSubtotal([{ dishId: 'jollof', quantity: 0 }], dishes)).toBe(0)
  })
})

describe('mergeDuplicateIngredients', () => {
  it('collapses two entries with the same inventoryItemId into one, summing quantityPerDish', () => {
    const result = mergeDuplicateIngredients([
      { inventoryItemId: RICE, quantityPerDish: 0.2 },
      { inventoryItemId: RICE, quantityPerDish: 0.3 },
    ])

    expect(result).toEqual([{ inventoryItemId: RICE, quantityPerDish: 0.5 }])
  })

  it('passes input with no duplicates through with no data loss', () => {
    const input = [
      { inventoryItemId: RICE, quantityPerDish: 0.2 },
      { inventoryItemId: TOMATOES, quantityPerDish: 0.1 },
      { inventoryItemId: CHICKEN, quantityPerDish: 0.05 },
    ]

    expect(mergeDuplicateIngredients(input)).toEqual(input)
  })

  it('drops an entry with a blank inventoryItemId', () => {
    const result = mergeDuplicateIngredients([
      { inventoryItemId: '', quantityPerDish: 0.2 },
      { inventoryItemId: RICE, quantityPerDish: 0.1 },
    ])

    expect(result).toEqual([{ inventoryItemId: RICE, quantityPerDish: 0.1 }])
  })

  it('returns an empty array for an empty input', () => {
    expect(mergeDuplicateIngredients([])).toEqual([])
  })
})
