"use client"

import { useState } from "react"
import { Dish, DishIngredient, InventoryItem } from "@prisma/client"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { formatCurrency, getCurrencySymbol } from "@/lib/currency"
import { mergeDuplicateIngredients } from "@/lib/recipe"
import { createDish, updateDish, deleteDish, toggleDishActive } from "./actions"
import { Plus } from "lucide-react"

type DishWithIngredients = Dish & {
  ingredients: (DishIngredient & { inventoryItem: InventoryItem })[]
}

// `internalId` keeps React keys stable while rows are added and removed, mirroring the
// ingredient-row pattern in OrderDetailsClient.
type RecipeRow = { inventoryItemId: string; quantityPerDish: number; internalId: number }

const statusColors: Record<string, string> = {
  ACTIVE:   'oklch(0.60 0.14 150)',
  ARCHIVED: 'oklch(0.50 0.01 65)',
}

const columnHelper = createColumnHelper<DishWithIngredients>()

const RECIPE_SUMMARY_LIMIT = 3

function RecipeBuilder({
  rows,
  setRows,
  inventory,
  onAddRow,
}: {
  rows: RecipeRow[]
  setRows: (rows: RecipeRow[]) => void
  inventory: InventoryItem[]
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
        <p className="text-xs" style={{ color: 'oklch(0.45 0.008 65)' }}>
          No ingredients yet. A dish with no recipe still sells — it just won&apos;t deduct any stock.
        </p>
      ) : (
        rows.map((row, index) => {
          const selected = inventory.find(inv => inv.id === row.inventoryItemId)
          return (
            <div key={row.internalId} className="flex gap-4 items-center">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={row.inventoryItemId}
                onChange={(e) => {
                  const newRows = [...rows]
                  newRows[index] = { ...newRows[index], inventoryItemId: e.target.value }
                  setRows(newRows)
                }}
              >
                <option value="" disabled>Select item...</option>
                {inventory.map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.name} ({inv.unit})</option>
                ))}
              </select>
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
              <span className="w-16 text-xs" style={{ color: 'oklch(0.45 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
                {selected?.unit ?? ''}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                X
              </Button>
            </div>
          )
        })
      )}
    </div>
  )
}

export function MenuClient({
  initialData,
  inventory
}: {
  initialData: DishWithIngredients[],
  inventory: InventoryItem[]
}) {
  const [data, setData] = useState<DishWithIngredients[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [editingDish, setEditingDish] = useState<DishWithIngredients | null>(null)
  const [newRecipe, setNewRecipe] = useState<RecipeRow[]>([])
  const [editRecipe, setEditRecipe] = useState<RecipeRow[]>([])
  const [counter, setCounter] = useState(0)

  function addRow(rows: RecipeRow[], setRows: (rows: RecipeRow[]) => void) {
    setRows([...rows, { inventoryItemId: '', quantityPerDish: 0, internalId: counter }])
    setCounter(c => c + 1)
  }

  // Rebuilds the joined `ingredients` shape the table renders from, so an optimistic row looks
  // exactly like one that came back from getDishes. Duplicate picks are summed the same way the
  // server sums them, so the table never shows a recipe the database doesn't hold.
  function buildIngredients(dishId: string, rows: RecipeRow[]) {
    return mergeDuplicateIngredients(
      rows.filter(row => row.inventoryItemId && row.quantityPerDish > 0)
    ).map(line => ({
      id: `${dishId}-${line.inventoryItemId}`,
      dishId,
      inventoryItemId: line.inventoryItemId,
      quantityPerDish: line.quantityPerDish,
      createdAt: new Date(),
      inventoryItem: inventory.find(inv => inv.id === line.inventoryItemId)!,
    }))
  }

  function recipePayload(rows: RecipeRow[]) {
    return rows
      .filter(row => row.inventoryItemId && row.quantityPerDish > 0)
      .map(row => ({ inventoryItemId: row.inventoryItemId, quantityPerDish: row.quantityPerDish }))
  }

  async function handleAdd(formData: FormData) {
    const name = formData.get("name") as string
    const price = Number(formData.get("price"))

    const newDish = await createDish({ name, price, ingredients: recipePayload(newRecipe) })

    setData([...data, { ...newDish, ingredients: buildIngredients(newDish.id, newRecipe) }])
    setIsOpen(false)
    setNewRecipe([])
    toast.add({ title: 'Dish created', description: `"${name}" was added to the menu.`, type: 'success' })
  }

  async function handleEdit(formData: FormData) {
    if (!editingDish) return
    const name = formData.get("name") as string
    const price = Number(formData.get("price"))

    const updated = await updateDish(editingDish.id, {
      name,
      price,
      ingredients: recipePayload(editRecipe),
    })

    setData(prev => prev.map(d => d.id === updated.id
      ? { ...d, ...updated, ingredients: buildIngredients(updated.id, editRecipe) }
      : d
    ))
    setEditingDish(null)
    toast.add({ title: 'Dish updated', description: `"${name}" was saved.`, type: 'success' })
  }

  function openEdit(dish: DishWithIngredients) {
    setEditRecipe(dish.ingredients.map((ingredient, index) => ({
      inventoryItemId: ingredient.inventoryItemId,
      quantityPerDish: ingredient.quantityPerDish,
      internalId: counter + index,
    })))
    setCounter(c => c + dish.ingredients.length)
    setEditingDish(dish)
  }

  async function handleToggleActive(dish: DishWithIngredients) {
    const nextIsActive = !dish.isActive
    await toggleDishActive(dish.id, nextIsActive)
    setData(prev => prev.map(d => d.id === dish.id ? { ...d, isActive: nextIsActive } : d))
    toast.add({
      title: nextIsActive ? 'Dish restored' : 'Dish archived',
      description: nextIsActive
        ? `"${dish.name}" is available on new orders again.`
        : `"${dish.name}" is hidden from new orders.`,
      type: 'info',
    })
  }

  async function handleDelete(dish: DishWithIngredients) {
    if (!confirm(`Delete "${dish.name}"? A dish used by past orders is archived instead, so order history stays intact.`)) {
      return
    }

    const result = await deleteDish(dish.id)

    if (result.archived) {
      setData(prev => prev.map(d => d.id === dish.id ? { ...d, isActive: false } : d))
      toast.add({
        title: 'Dish archived',
        description: `"${dish.name}" is referenced by past orders, so it was archived instead of deleted.`,
        type: 'info',
      })
    } else {
      setData(prev => prev.filter(d => d.id !== dish.id))
      toast.add({ title: 'Dish deleted', description: `"${dish.name}" was removed from the menu.`, type: 'success' })
    }
  }

  const columns = [
    columnHelper.accessor("shortId", {
      header: "ID",
      cell: (info) => (
        <span className="font-mono-data font-bold" style={{ color: 'oklch(0.72 0.15 65)' }}>
          #{info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("name", {
      header: "DISH",
      cell: (info) => (
        <span className="font-medium" style={{ color: 'oklch(0.85 0.008 65)' }}>
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("price", {
      header: "PRICE",
      cell: (info) => (
        <span className="font-mono-data table-cell-num text-sm text-foreground">
          {formatCurrency(info.getValue())}
        </span>
      ),
    }),
    columnHelper.display({
      id: "recipe",
      header: "RECIPE",
      cell: (info) => {
        const ingredients = info.row.original.ingredients
        if (ingredients.length === 0) {
          return <span className="text-xs" style={{ color: 'oklch(0.38 0.006 65)' }}>No recipe</span>
        }
        const shown = ingredients.slice(0, RECIPE_SUMMARY_LIMIT)
        const remaining = ingredients.length - shown.length
        return (
          <span className="text-xs" style={{ color: 'oklch(0.55 0.008 65)' }}>
            {shown.map(i => `${i.inventoryItem.name} ${i.quantityPerDish}${i.inventoryItem.unit}`).join(', ')}
            {remaining > 0 ? ` +${remaining} more` : ''}
          </span>
        )
      },
    }),
    columnHelper.accessor("isActive", {
      header: "STATUS",
      cell: (info) => {
        const status = info.getValue() ? 'ACTIVE' : 'ARCHIVED'
        return (
          <span
            className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium font-mono-data"
            style={{
              background: `${statusColors[status]}20`,
              color: statusColors[status],
              border: `1px solid ${statusColors[status]}40`,
            }}
          >
            {status}
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(info.row.original)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleToggleActive(info.row.original)}>
            {info.row.original.isActive ? 'Archive' : 'Restore'}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => handleDelete(info.row.original)}>
            Delete
          </Button>
        </div>
      ),
    })
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
          {data.filter(d => d.isActive).length} active dish{data.filter(d => d.isActive).length !== 1 ? 'es' : ''}
        </p>
        {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
        <Button onClick={() => setIsOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Dish
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Dish</DialogTitle>
          </DialogHeader>
          <form action={handleAdd} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Dish Name</Label>
                <Input id="name" name="name" placeholder="e.g. Jollof Rice" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Price ({getCurrencySymbol()})</Label>
                <Input id="price" name="price" type="number" step="any" min="0" required />
              </div>
            </div>

            <RecipeBuilder
              rows={newRecipe}
              setRows={setNewRecipe}
              inventory={inventory}
              onAddRow={() => addRow(newRecipe, setNewRecipe)}
            />

            <Button type="submit" className="w-full">Save Dish</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editingDish} onOpenChange={(open) => !open && setEditingDish(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Dish #{editingDish?.shortId}</DialogTitle>
          </DialogHeader>
          <form action={handleEdit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Dish Name</Label>
                <Input id="edit-name" name="name" defaultValue={editingDish?.name ?? ''} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-price">Price ({getCurrencySymbol()})</Label>
                <Input id="edit-price" name="price" type="number" step="any" min="0" defaultValue={editingDish?.price ?? 0} required />
              </div>
            </div>

            <RecipeBuilder
              rows={editRecipe}
              setRows={setEditRecipe}
              inventory={inventory}
              onAddRow={() => addRow(editRecipe, setEditRecipe)}
            />

            <p className="text-xs" style={{ color: 'oklch(0.45 0.008 65)' }}>
              Recipe changes only affect future orders — past orders keep the ingredients they were
              placed with.
            </p>

            <Button type="submit" className="w-full">Update Dish</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid oklch(0.20 0.008 65)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'oklch(0.13 0.005 65)', borderBottom: '1px solid oklch(0.20 0.008 65)' }}>
              {table.getHeaderGroups().map(hg => hg.headers.map(header => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.10em' }}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  style={{
                    background: idx % 2 === 0 ? 'oklch(0.10 0.004 65)' : 'transparent',
                    borderBottom: '1px solid oklch(0.16 0.005 65)',
                    opacity: row.original.isActive ? 1 : 0.6,
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'oklch(0.40 0.008 65)' }}
                >
                  No dishes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
