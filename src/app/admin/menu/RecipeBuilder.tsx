"use client"

import { Dish, DishIngredient, DishMedia, InventoryItem } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mergeDuplicateIngredients } from "@/lib/recipe"
import { X, Search, ChevronDown, Check } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"

/**
 * Extracted verbatim out of MenuClient.tsx — two screens need this now, not one: the gallery's
 * lightweight create modal (MenuClient) and the per-dish detail page's Details section
 * (./[id]/DishDetailsClient). Behavior is unchanged by the move; the only real difference is
 * buildIngredients' parameter list (see its own note).
 */

export type DishWithIngredients = Dish & {
  ingredients: (DishIngredient & { inventoryItem: InventoryItem })[]
}

/** What both menu screens actually render — getDishes() and the detail page both include media. */
export type DishWithMedia = DishWithIngredients & {
  media: DishMedia[]
}

// `internalId` keeps React keys stable while rows are added and removed, mirroring the
// ingredient-row pattern in OrderDetailsClient.
export type RecipeRow = { inventoryItemId: string; quantityPerDish: number; internalId: number }

type IngredientOption = { id: string; name: string; unit: string }

/**
 * getInventoryItems() returns active items only, so an archived ingredient is correctly absent
 * from the "add an ingredient" picker — but a recipe row that ALREADY references one would then
 * render an unmatched <select> value and a blank unit label. The dish's own `ingredients` join
 * carries that item's real name and unit independently of the inventory query, so the missing
 * option is reinjected from there, flagged as archived.
 *
 * Same pattern OrderDetailsClient's dish-focused optionsForRow already uses for archived dishes.
 * `dish` is null on the create form — a brand-new recipe cannot reference an already-archived
 * item, because the picker never offered one.
 */
export function optionsForRow(
  row: RecipeRow,
  inventory: InventoryItem[],
  dish: DishWithIngredients | null
): IngredientOption[] {
  const options: IngredientOption[] = inventory.map(inv => ({
    id: inv.id,
    name: inv.name,
    unit: inv.unit,
  }))

  if (row.inventoryItemId && !options.some(o => o.id === row.inventoryItemId)) {
    const fromRecipe = dish?.ingredients.find(i => i.inventoryItemId === row.inventoryItemId)?.inventoryItem
    if (fromRecipe) {
      options.unshift({
        id: fromRecipe.id,
        name: `${fromRecipe.name} (archived)`,
        unit: fromRecipe.unit,
      })
    }
  }

  return options
}

/**
 * Rebuilds the joined `ingredients` shape the UI renders from, so an optimistic row looks exactly
 * like one that came back from getDishes. Duplicate picks are summed the same way the server sums
 * them, so the screen never shows a recipe the database doesn't hold.
 *
 * `inventory` is active-only, so an edited dish whose recipe keeps an archived ingredient has no
 * match there — a non-null assertion would hand the caller an undefined `inventoryItem` and crash
 * the render on `.name`. Fall back to the dish's own join (the same source optionsForRow
 * reinjects from), and drop any line that resolves in neither: the server already persisted the
 * true recipe, and revalidatePath reconciles it.
 *
 * `inventory` is an explicit parameter rather than a closure over MenuClient's own prop — that is
 * the one signature change this extraction required, so both call sites can supply their own.
 */
export function buildIngredients(
  dishId: string,
  rows: RecipeRow[],
  fallbackDish: DishWithIngredients | null,
  inventory: InventoryItem[]
) {
  return mergeDuplicateIngredients(
    rows.filter(row => row.inventoryItemId && row.quantityPerDish > 0)
  ).flatMap(line => {
    const inventoryItem =
      inventory.find(inv => inv.id === line.inventoryItemId)
      ?? fallbackDish?.ingredients.find(i => i.inventoryItemId === line.inventoryItemId)?.inventoryItem

    if (!inventoryItem) return []

    return [{
      id: `${dishId}-${line.inventoryItemId}`,
      dishId,
      inventoryItemId: line.inventoryItemId,
      quantityPerDish: line.quantityPerDish,
      createdAt: new Date(),
      inventoryItem,
    }]
  })
}

export function recipePayload(rows: RecipeRow[]) {
  return rows
    .filter(row => row.inventoryItemId && row.quantityPerDish > 0)
    .map(row => ({ inventoryItemId: row.inventoryItemId, quantityPerDish: row.quantityPerDish }))
}

export function RecipeBuilder({
  rows,
  setRows,
  inventory,
  dish,
  onAddRow,
}: {
  rows: RecipeRow[]
  setRows: (rows: RecipeRow[]) => void
  inventory: InventoryItem[]
  dish: DishWithIngredients | null
  onAddRow: () => void
}) {
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center justify-between">
        <Label>Recipe (deducted from inventory per dish)</Label>
        <Button type="button" variant="outline" size="sm" onClick={onAddRow}>
          Add Ingredient
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No ingredients yet. A dish with no recipe still sells — it just won&apos;t deduct any stock.
        </p>
      ) : (
        rows.map((row, index) => {
          const options = optionsForRow(row, inventory, dish)
          const selected = options.find(option => option.id === row.inventoryItemId)
          return (
            <div key={row.internalId} className="flex gap-4 items-center">
              <SearchableSelect
                options={options}
                value={row.inventoryItemId}
                onChange={(val) => {
                  const newRows = [...rows]
                  newRows[index] = { ...newRows[index], inventoryItemId: val }
                  setRows(newRows)
                }}
              />
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="Qty"
                className="w-24"
                value={row.quantityPerDish || ''}
                onChange={(e) => {
                  const newRows = [...rows]
                  newRows[index] = { ...newRows[index], quantityPerDish: Number(e.target.value) }
                  setRows(newRows)
                }}
              />
              <span className="meta-text w-16">{selected?.unit ?? ''}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Remove ingredient"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )
        })
      )}
    </div>
  )
}

function SearchableSelect({ options, value, onChange }: { options: IngredientOption[], value: string, onChange: (val: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.id === value)
  const filteredOptions = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative flex-1" ref={containerRef}>
      <div
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors cursor-pointer hover:bg-muted/50",
          !selected && "text-muted-foreground"
        )}
        onClick={() => {
          setOpen(!open)
          if (!open) setSearch('')
        }}
      >
        <span className="truncate">
          {selected ? `${selected.name} (${selected.unit})` : "Select item..."}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[250px] max-w-[400px] z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              autoFocus
              className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search ingredient..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <p className="p-2 text-center text-sm text-muted-foreground">No items found.</p>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option.id}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 whitespace-nowrap overflow-hidden"
                  onClick={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selected?.id === option.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.name}</span>
                  <span className="ml-1 text-xs text-muted-foreground">({option.unit})</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

