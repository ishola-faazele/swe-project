"use client"

import { useState } from "react"
import { InventoryItem, Category } from "@prisma/client"
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
import { createInventoryItem, deleteInventoryItem, toggleInventoryItemActive } from "./actions"
import { Plus, AlertTriangle, PackageOpen, Archive } from "lucide-react"
import { cn } from "@/lib/utils"

const columnHelper = createColumnHelper<InventoryItem>()

function StockBadge({ current, min }: { current: number; min: number }) {
  const pct = min > 0 ? Math.min((current / (min * 3)) * 100, 100) : 100
  const isCritical = current <= min
  const isWarning = current <= min * 1.5 && !isCritical

  // Static class map rather than an inline conditional oklch object — same
  // three colors, but now expressible in a stylesheet.
  const fillClass = isCritical ? 'bg-destructive' : isWarning ? 'bg-primary' : 'bg-chart-3'
  const badgeClass = isCritical ? 'stock-critical' : isWarning ? 'stock-warning' : 'stock-ok'
  const badgeLabel = isCritical ? 'CRITICAL' : isWarning ? 'LOW' : 'OK'

  return (
    <div className="min-w-[120px] space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-data tabular-nums text-sm font-medium text-foreground">
          {current}
        </span>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', fillClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Replaces the old runtime `${color}20`/`${color}40` string concatenation,
 * which could silently produce an invalid color from a typo'd alpha suffix.
 * Same color intent as before, sourced from the existing chart tokens.
 */
const categoryBadgeClass: Record<Category, string> = {
  INGREDIENT: 'bg-chart-3/15 text-chart-3 border-chart-3/40',
  DRINK: 'bg-chart-4/15 text-chart-4 border-chart-4/40',
  PACKAGING: 'bg-primary/15 text-primary border-primary/40',
  OTHER: 'bg-muted text-muted-foreground border-border',
}

/**
 * Local rather than a globals.css utility on purpose: it would be a byte-for-byte duplicate of
 * `.dish-archived`, and a second global class with a near-identical name is worse than a local
 * constant. Deliberately the same zinc treatment MenuClient's ARCHIVED badge uses, so "archived"
 * reads identically on both screens.
 */
const ARCHIVED_BADGE_CLASS =
  'inline-flex items-center rounded border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-xs font-medium font-mono-data text-zinc-500'

export function InventoryClient({ initialData }: { initialData: InventoryItem[] }) {
  const [data, setData] = useState<InventoryItem[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  // Archived items are hidden behind a reveal toggle rather than shown inline dimmed the way
  // MenuClient shows archived dishes. Deliberate divergence: this list gets scanned for
  // stock-taking far more often than the menu gets edited, so retired items are noise by default.
  const [showArchived, setShowArchived] = useState(false)

  // Client-side filter over the full array the page already fetched — no second query.
  const visibleData = data.filter(i => showArchived || i.isActive)
  const archivedCount = data.filter(i => !i.isActive).length

  async function handleDelete(item: InventoryItem) {
    if (!confirm(`Delete "${item.name}"?`)) return

    try {
      const result = await deleteInventoryItem(item.id)
      if (!result.ok) {
        alert(result.error)
        return
      }

      if (result.data.archived) {
        setData(prev => prev.map(i => i.id === item.id ? { ...i, isActive: false } : i))
        alert(`"${item.name}" is still referenced by a recipe or a past order, so it was archived instead of deleted. Use "Show Archived" to restore it.`)
      } else {
        setData(prev => prev.filter(i => i.id !== item.id))
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete this inventory item.')
    }
  }

  async function handleToggleActive(item: InventoryItem) {
    const nextIsActive = !item.isActive

    try {
      const result = await toggleInventoryItemActive(item.id, nextIsActive)
      if (!result.ok) {
        alert(result.error)
        return
      }
      setData(prev => prev.map(i => i.id === item.id ? { ...i, isActive: nextIsActive } : i))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update this inventory item.')
    }
  }

  const columns = [
    columnHelper.accessor("name", {
      header: "ITEM NAME",
      cell: (info) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{info.getValue()}</span>
          {/* Inline on the row rather than a dedicated STATUS column: archived rows are hidden
              by default, so a whole column would sit empty on every normal day. */}
          {!info.row.original.isActive && (
            <span className={ARCHIVED_BADGE_CLASS}>ARCHIVED</span>
          )}
        </div>
      ),
    }),
    columnHelper.accessor("category", {
      header: "CATEGORY",
      cell: (info) => {
        const cat = info.getValue()
        return (
          <span
            className={cn(
              'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium font-mono-data',
              categoryBadgeClass[cat]
            )}
          >
            {cat}
          </span>
        )
      },
    }),
    columnHelper.accessor("currentStock", {
      header: "STOCK LEVEL",
      cell: (info) => (
        <StockBadge
          current={info.getValue()}
          min={info.row.original.minimumThreshold}
        />
      ),
    }),
    columnHelper.accessor("unit", {
      header: "UNIT",
      cell: (info) => (
        <span className="font-mono-data text-sm text-muted-foreground">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("minimumThreshold", {
      header: "ALERT AT",
      cell: (info) => (
        <span className="font-mono-data tabular-nums text-sm text-muted-foreground">
          {info.getValue() || '—'}
        </span>
      ),
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleToggleActive(info.row.original)}
          >
            {info.row.original.isActive ? 'Archive' : 'Restore'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDelete(info.row.original)}
          >
            Delete
          </Button>
        </div>
      ),
    })
  ]

  const table = useReactTable({
    data: visibleData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  // Active-only, for the same reason admin/page.tsx's low-stock query filters on isActive: a
  // retired item sits at or near zero stock permanently and must not nag the restock banner.
  // This count is independent of the dashboard's — the page now feeds archived rows into `data`
  // for the reveal toggle, so without this filter archiving an item would not clear its warning.
  const lowStockCount = data.filter(i => i.isActive && i.currentStock <= i.minimumThreshold).length

  async function handleAdd(formData: FormData) {
    const name = formData.get("name") as string
    const category = formData.get("category") as Category
    const currentStock = Number(formData.get("currentStock"))
    const unit = formData.get("unit") as string
    const thresholdStr = formData.get("minimumThreshold") as string
    const minimumThreshold = thresholdStr ? Number(thresholdStr) : null

    try {
      const result = await createInventoryItem({ name, currentStock, unit, minimumThreshold, category })
      if (!result.ok) {
        alert(result.error)
        return
      }
      setData([...data, result.data])
      setIsOpen(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create this inventory item.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {lowStockCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono-data text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} need restocking
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Kept mounted while revealed so it can't vanish out from under the admin who just
              restored the last archived item. */}
          {(archivedCount > 0 || showArchived) && (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showArchived}
              onClick={() => setShowArchived(s => !s)}
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {showArchived ? 'Hide Archived' : `Show Archived (${archivedCount})`}
            </Button>
          )}

          {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
          <Button onClick={() => setIsOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add Item
          </Button>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Inventory Item</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-4">
              <div>
                <Label htmlFor="name">Item Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <select id="category" name="category" className="select-field" required>
                  <option value="INGREDIENT">Ingredient</option>
                  <option value="DRINK">Drink</option>
                  <option value="PACKAGING">Packaging</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="currentStock">Current Stock</Label>
                  <Input id="currentStock" name="currentStock" type="number" step="any" required />
                </div>
                <div>
                  <Label htmlFor="unit">Unit</Label>
                  <Input id="unit" name="unit" placeholder="kg, pieces…" required />
                </div>
              </div>
              <div>
                <Label htmlFor="minimumThreshold">Alert Threshold (Optional)</Label>
                <Input id="minimumThreshold" name="minimumThreshold" type="number" step="any" />
              </div>
              <Button type="submit" className="w-full">Save Item</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-popover">
              {table.getHeaderGroups().map(hg => hg.headers.map(header => (
                <th key={header.id} className="table-head-cell">
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
                  className={cn(
                    'table-row',
                    idx % 2 === 0 && 'bg-card/40',
                    !row.original.isActive && 'opacity-60'
                  )}
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
                <td colSpan={columns.length}>
                  {/* Two genuinely different empty states. "Nothing here yet" and "everything you
                      have is archived" call for opposite next actions, so they can't share copy. */}
                  {data.length > 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <Archive className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <p className="empty-state-title">Every item is archived</p>
                      <p className="empty-state-hint">
                        Nothing is actively tracked right now. Use “Show Archived” to review or
                        restore a retired item.
                      </p>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <PackageOpen className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <p className="empty-state-title">No inventory items yet</p>
                      <p className="empty-state-hint">
                        Add your ingredients, drinks, and packaging to start tracking stock levels.
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
