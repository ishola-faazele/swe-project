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
import { createInventoryItem, deleteInventoryItem } from "./actions"
import { Plus, AlertTriangle, PackageOpen } from "lucide-react"
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

export function InventoryClient({ initialData }: { initialData: InventoryItem[] }) {
  const [data, setData] = useState<InventoryItem[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)

  const columns = [
    columnHelper.accessor("name", {
      header: "ITEM NAME",
      cell: (info) => (
        <span className="font-medium text-foreground">{info.getValue()}</span>
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
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            if (!confirm(`Delete "${info.row.original.name}"?`)) return
            try {
              const result = await deleteInventoryItem(info.row.original.id)
              if (!result.ok) {
                alert(result.error)
                return
              }
              setData(data.filter(i => i.id !== info.row.original.id))
            } catch (err) {
              alert(err instanceof Error ? err.message : 'Could not delete this inventory item.')
            }
          }}
        >
          Delete
        </Button>
      ),
    })
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const lowStockCount = data.filter(i => i.currentStock <= i.minimumThreshold).length

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

        {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
        <Button onClick={() => setIsOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add Item
        </Button>
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
                <tr key={row.id} className={cn('table-row', idx % 2 === 0 && 'bg-card/40')}>
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
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <PackageOpen className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="empty-state-title">No inventory items yet</p>
                    <p className="empty-state-hint">
                      Add your ingredients, drinks, and packaging to start tracking stock levels.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
