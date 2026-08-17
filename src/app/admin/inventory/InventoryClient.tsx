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
  DialogTrigger,
} from "@/components/ui/dialog"
import { createInventoryItem, deleteInventoryItem } from "./actions"
import { Plus, AlertTriangle } from "lucide-react"

const columnHelper = createColumnHelper<InventoryItem>()

function StockBadge({ current, min }: { current: number; min: number }) {
  const pct = min > 0 ? Math.min((current / (min * 3)) * 100, 100) : 100
  const isCritical = current <= min
  const isWarning = current <= min * 1.5 && !isCritical

  const color = isCritical
    ? 'oklch(0.62 0.22 25)'
    : isWarning
    ? 'oklch(0.72 0.15 65)'
    : 'oklch(0.65 0.12 150)'

  const badgeClass = isCritical ? 'stock-critical' : isWarning ? 'stock-warning' : 'stock-ok'
  const badgeLabel = isCritical ? 'CRITICAL' : isWarning ? 'LOW' : 'OK'

  return (
    <div className="space-y-1.5 min-w-[120px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-data text-sm font-medium" style={{ color: 'oklch(0.85 0.008 65)' }}>
          {current}
        </span>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>
      <div
        className="h-1 w-full rounded-full"
        style={{ background: 'oklch(0.20 0.006 65)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

const categoryColors: Record<string, string> = {
  INGREDIENT: 'oklch(0.60 0.14 150)',
  DRINK:      'oklch(0.60 0.14 240)',
  PACKAGING:  'oklch(0.60 0.12 65)',
  OTHER:      'oklch(0.50 0.01 65)',
}

export function InventoryClient({ initialData }: { initialData: InventoryItem[] }) {
  const [data, setData] = useState<InventoryItem[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)

  const columns = [
    columnHelper.accessor("name", {
      header: "ITEM NAME",
      cell: (info) => (
        <span className="font-medium" style={{ color: 'oklch(0.85 0.008 65)' }}>
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("category", {
      header: "CATEGORY",
      cell: (info) => {
        const cat = info.getValue()
        return (
          <span
            className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium font-mono-data"
            style={{
              background: `${categoryColors[cat]}20`,
              color: categoryColors[cat],
              border: `1px solid ${categoryColors[cat]}40`,
            }}
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
        <span className="font-mono-data text-sm" style={{ color: 'oklch(0.52 0.01 65)' }}>
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("minimumThreshold", {
      header: "ALERT AT",
      cell: (info) => (
        <span className="font-mono-data text-sm" style={{ color: 'oklch(0.45 0.008 65)' }}>
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {lowStockCount > 0 && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
              style={{
                background: 'oklch(0.62 0.22 25 / 0.10)',
                border: '1px solid oklch(0.62 0.22 25 / 0.30)',
                color: 'oklch(0.75 0.20 25)',
                fontFamily: 'var(--font-dm-mono)',
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} need restocking
            </div>
          )}
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Item
          </DialogTrigger>
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
                <select
                  id="category"
                  name="category"
                  className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  required
                >
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
                  No inventory items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
