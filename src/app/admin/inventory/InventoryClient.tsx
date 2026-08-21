"use client"

import { useMemo, useState } from "react"
import { InventoryItem, Category } from "@prisma/client"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { createInventoryItem, deleteInventoryItem, toggleInventoryItemActive, updateInventoryItem, submitStockCount } from "./actions"
import { Plus, AlertTriangle, PackageOpen, Archive, ArrowUpDown, ArrowUp, ArrowDown, Pencil, Trash2, RotateCcw, ShoppingCart, Copy, Printer, ClipboardCheck, Save } from "lucide-react"
import { cn } from "@/lib/utils"
import { HighlightText } from "@/components/ui/highlight"
import { TablePagination } from "@/components/ui/table-pagination"
import { toast } from "@/components/ui/toast"

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
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null)
  
  const [isShoppingListOpen, setIsShoppingListOpen] = useState(false)
  const [shoppingMultiplier, setShoppingMultiplier] = useState<number>(2)
  const [customShoppingItems, setCustomShoppingItems] = useState<{id: string, name: string, quantity: string, isCustom: boolean}[]>([])
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([])
  const [newCustomItemId, setNewCustomItemId] = useState('')
  const [newCustomItemQty, setNewCustomItemQty] = useState('')
  
  const [isCountMode, setIsCountMode] = useState(false)
  const [stockCounts, setStockCounts] = useState<Record<string, number>>({})
  const [isSubmittingCount, setIsSubmittingCount] = useState(false)

  // Client-side filter over the full array the page already fetched — no second query.
  //
  // useMemo is load-bearing, not a micro-optimization: useReactTable requires a referentially
  // stable `data`. A fresh `data.filter(...)` array on every render makes the table rebuild its
  // row model each pass and re-render continuously, which remounts every row's DOM — buttons
  // lose clicks because the node they were pressed on is replaced mid-interaction. The sibling
  // tables get this for free by passing their raw state array; this one filters, so it must
  // memoize explicitly.
  const visibleData = useMemo(
    () => data.filter(i => showArchived || i.isActive),
    [data, showArchived]
  )
  const archivedCount = data.filter(i => !i.isActive).length

  // handleDelete is now handled by the AlertDialog
  async function performDelete(item: InventoryItem) {
    try {
      const result = await deleteInventoryItem(item.id)
      if (!result.ok) {
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }

      if (result.data.archived) {
        setData(prev => prev.map(i => i.id === item.id ? { ...i, isActive: false } : i))
        toast.add({ title: 'Item archived', description: `"${item.name}" is still referenced by a recipe or a past order, so it was archived instead of deleted. Use "Show Archived" to restore it.`, type: 'info' })
      } else {
        setData(prev => prev.filter(i => i.id !== item.id))
        toast.add({ title: 'Item deleted', description: `"${item.name}" was deleted.`, type: 'success' })
      }
      setDeletingItem(null)
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not delete this inventory item.', type: 'error' })
    }
  }

  async function handleToggleActive(item: InventoryItem) {
    const nextIsActive = !item.isActive

    try {
      const result = await toggleInventoryItemActive(item.id, nextIsActive)
      if (!result.ok) {
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }
      setData(prev => prev.map(i => i.id === item.id ? { ...i, isActive: nextIsActive } : i))
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update this inventory item.', type: 'error' })
    }
  }

  const handleSaveStockCount = async () => {
    const adjustments = Object.entries(stockCounts).map(([id, newStock]) => {
      const item = data.find(i => i.id === id)
      return { id, previousStock: item?.currentStock ?? 0, newStock }
    }).filter(adj => adj.previousStock !== adj.newStock)

    if (adjustments.length === 0) {
      setIsCountMode(false)
      return
    }

    setIsSubmittingCount(true)
    try {
      const result = await submitStockCount(adjustments)
      if (!result.ok) {
        toast.add({ title: 'Error', description: result.error, type: 'error' })
      } else {
        toast.add({ title: 'Counts saved', description: `Updated ${adjustments.length} item${adjustments.length === 1 ? '' : 's'}.`, type: 'success' })
        setData(prev => prev.map(item => {
          const adj = adjustments.find(a => a.id === item.id)
          return adj ? { ...item, currentStock: adj.newStock } : item
        }))
        setIsCountMode(false)
        setStockCounts({})
      }
    } catch (err) {
      toast.add({ title: 'Error', description: 'Failed to save counts.', type: 'error' })
    } finally {
      setIsSubmittingCount(false)
    }
  }

  const columns = [
    columnHelper.accessor("name", {
      header: "ITEM NAME",
      cell: (info) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {info.getValue() ? <HighlightText text={info.getValue()} query={globalFilter} /> : null}
          </span>
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
      meta: { className: "hidden md:table-cell" },
      cell: (info) => {
        const cat = info.getValue()
        return (
          <span
            className={cn(
              'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium font-mono-data',
              categoryBadgeClass[cat]
            )}
          >
            <HighlightText text={cat} query={globalFilter} />
          </span>
        )
      },
    }),
    columnHelper.accessor("currentStock", {
      header: "STOCK LEVEL",
      cell: (info) => isCountMode ? (
        <div className="flex items-center gap-3">
          <Input 
            type="number" 
            step="any"
            className="w-24 font-mono-data" 
            value={stockCounts[info.row.original.id] ?? info.getValue()}
            onChange={(e) => setStockCounts(prev => ({ ...prev, [info.row.original.id]: Number(e.target.value) }))}
            onClick={(e) => e.stopPropagation()}
          />
          {(() => {
             const current = info.getValue()
             const count = stockCounts[info.row.original.id]
             if (count !== undefined && count !== current) {
                const diff = count - current
                const isPositive = diff > 0
                return (
                  <span className={cn("text-xs font-mono-data whitespace-nowrap", isPositive ? "text-green-500" : "text-destructive")}>
                    {isPositive ? '+' : ''}{Number(diff.toFixed(2))}
                  </span>
                )
             }
             return null
          })()}
        </div>
      ) : (
        <StockBadge
          current={info.getValue()}
          min={info.row.original.minimumThreshold}
        />
      ),
    }),
    columnHelper.accessor("unit", {
      header: "UNIT",
      meta: { className: "hidden md:table-cell" },
      cell: (info) => (
        <span className="font-mono-data text-sm text-muted-foreground">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("minimumThreshold", {
      header: "ALERT AT",
      meta: { className: "hidden md:table-cell" },
      cell: (info) => (
        <span className="font-mono-data tabular-nums text-sm text-muted-foreground">
          {info.getValue() || '—'}
        </span>
      ),
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Edit item"
            onClick={() => setEditingItem(info.row.original)}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={info.row.original.isActive ? "Archive item" : "Restore item"}
            onClick={() => handleToggleActive(info.row.original)}
          >
            {info.row.original.isActive ? (
              <Archive className="h-4 w-4" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">{info.row.original.isActive ? 'Archive' : 'Restore'}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete item"
            onClick={() => setDeletingItem(info.row.original)}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      ),
    })
  ]

  const table = useReactTable({
    data: visibleData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  // Active-only, for the same reason admin/page.tsx's low-stock query filters on isActive: a
  // retired item sits at or near zero stock permanently and must not nag the restock banner.
  // This count is independent of the dashboard's — the page now feeds archived rows into `data`
  // for the reveal toggle, so without this filter archiving an item would not clear its warning.
  const lowStockItems = data.filter(i => i.isActive && i.minimumThreshold > 0 && i.currentStock <= i.minimumThreshold)
  const lowStockCount = lowStockItems.length

  const combinedShoppingItems = useMemo(() => {
    const generated = lowStockItems.map(item => {
      const target = item.minimumThreshold * shoppingMultiplier
      const needed = Math.max(0, target - item.currentStock)
      const formattedNeeded = Number(needed.toFixed(1))
      return {
        id: item.id,
        name: item.name,
        quantity: `${formattedNeeded} ${item.unit}`,
        isCustom: false
      }
    })
    return [...generated, ...customShoppingItems].filter(item => !removedItemIds.includes(item.id))
  }, [lowStockItems, shoppingMultiplier, customShoppingItems, removedItemIds])

  const availableInventoryItems = useMemo(() => {
    return data.filter(item => item.isActive && !combinedShoppingItems.some(shoppingItem => shoppingItem.id === item.id))
  }, [data, combinedShoppingItems])

  const getShoppingListText = () => {
    if (combinedShoppingItems.length === 0) return "No items are currently below their minimum threshold."
    
    const targetLabel = shoppingMultiplier === 1 
      ? 'Just enough (Minimum)' 
      : shoppingMultiplier === 1.5 
      ? 'A bit extra' 
      : shoppingMultiplier === 2 
      ? 'Double stock' 
      : 'Heavy restock'

    const header = `📋 Chop with Rostty - Shopping List\nRestock Target: ${targetLabel}\n\n`
    const items = combinedShoppingItems.map(item => {
      return `[ ] ${item.name.padEnd(25)} ${item.quantity.padStart(10)}`
    }).join("\n")
    return header + items
  }

  const handleCopyShoppingList = () => {
    navigator.clipboard.writeText(getShoppingListText())
    toast.add({ title: 'Copied!', description: 'Shopping list copied to clipboard.', type: 'success' })
  }

  const handlePrintShoppingList = () => {
    const printWindow = window.open('', '', 'height=600,width=800')
    if (printWindow) {
      printWindow.document.write('<html><head><title>Shopping List - Chop with Rostty</title>')
      printWindow.document.write('<style>body { font-family: system-ui, sans-serif; padding: 40px; color: #111; max-width: 800px; margin: 0 auto; } h1 { font-size: 24px; border-bottom: 2px solid #ea580c; padding-bottom: 10px; margin-bottom: 20px; } table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; } th { font-weight: 600; color: #555; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; } td.qty { font-family: monospace; font-size: 14px; font-weight: 600; } .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 20px; }</style>')
      printWindow.document.write('</head><body>')
      printWindow.document.write('<h1>Shopping List</h1>')
      
      if (combinedShoppingItems.length === 0) {
        printWindow.document.write('<p>No items to restock.</p>')
      } else {
        printWindow.document.write('<style>@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } } body::before { content: ""; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-image: url("/rosty-logo.jpeg"); background-repeat: no-repeat; background-position: center; background-size: 50%; opacity: 0.05; z-index: -1; pointer-events: none; } .checkbox { width: 16px; height: 16px; border: 1px solid #999; border-radius: 3px; display: inline-block; vertical-align: middle; }</style>')
        printWindow.document.write('<table><thead><tr><th style="width: 40px"></th><th>Item Name</th><th>Quantity to Buy</th></tr></thead><tbody>')
        combinedShoppingItems.forEach(item => {
          printWindow.document.write(`<tr><td><div class="checkbox"></div></td><td>${item.name}</td><td class="qty">${item.quantity}</td></tr>`)
        })
        printWindow.document.write('</tbody></table>')
      }
      
      printWindow.document.write(`<div class="footer">Generated on ${new Date().toLocaleDateString()} &bull; Chop with Rostty</div>`)
      printWindow.document.write('<script>window.onload = function() { window.print(); }</script>')
      printWindow.document.write('</body></html>')
      printWindow.document.close()
      printWindow.focus()
      printWindow.focus()
    }
  }

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
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }
      setData([...data, result.data])
      setIsOpen(false)
      toast.add({ title: 'Item created', description: `"${name}" was added to the inventory.`, type: 'success' })
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not create this inventory item.', type: 'error' })
    }
  }

  async function handleEdit(formData: FormData) {
    if (!editingItem) return
    const name = formData.get("name") as string
    const category = formData.get("category") as Category
    const currentStock = Number(formData.get("currentStock"))
    const unit = formData.get("unit") as string
    const thresholdStr = formData.get("minimumThreshold") as string
    const minimumThreshold = thresholdStr ? Number(thresholdStr) : undefined

    try {
      const result = await updateInventoryItem(editingItem.id, { name, currentStock, unit, minimumThreshold, category })
      if (!result.ok) {
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }
      setData(prev => prev.map(i => i.id === editingItem.id ? result.data : i))
      setEditingItem(null)
      toast.add({ title: 'Item updated', description: `"${name}" was updated.`, type: 'success' })
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update this inventory item.', type: 'error' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search inventory..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(String(e.target.value))}
            className="w-full sm:w-64 bg-card"
          />
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

          {isCountMode ? (
            <Button variant="default" onClick={handleSaveStockCount} disabled={isSubmittingCount}>
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" /> Save Counts
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setIsCountMode(true)}>
              <ClipboardCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> Count Stock
            </Button>
          )}

          <Button variant="secondary" onClick={() => setIsShoppingListOpen(true)}>
            <ShoppingCart className="mr-1.5 h-4 w-4" aria-hidden="true" /> Shopping List
          </Button>
        </div>

        <Dialog open={isShoppingListOpen} onOpenChange={setIsShoppingListOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Quick Reorder Shopping List</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 bg-muted/30 p-3 rounded-lg border border-border">
                <Label htmlFor="multiplier" className="font-medium text-sm text-foreground m-0">Restock Target:</Label>
                <select 
                  id="multiplier" 
                  className="select-field h-8 py-1 px-2 text-sm w-auto bg-card" 
                  value={shoppingMultiplier} 
                  onChange={(e) => setShoppingMultiplier(Number(e.target.value))}
                >
                  <option value={1}>Minimum (Just enough)</option>
                  <option value={1.5}>Medium (A bit extra)</option>
                  <option value={2}>Double (Recommended)</option>
                  <option value={3}>Heavy (Stock up)</option>
                </select>
              </div>
              <div className="rounded-xl bg-card p-4 max-h-[350px] overflow-y-auto border border-border shadow-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4" />
                  Shopping List
                </h4>
                {combinedShoppingItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    <ShoppingCart className="h-8 w-8 mx-auto mb-3 opacity-20" />
                    No items in shopping list.
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {combinedShoppingItems.map(item => (
                      <li key={item.id} className="flex justify-between items-center text-sm group">
                        <span className="font-medium text-foreground flex items-center gap-2 group-hover:text-primary transition-colors">
                          {item.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono-data text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                            {item.quantity}
                          </span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (item.isCustom) {
                                setCustomShoppingItems(prev => prev.filter(i => i.id !== item.id))
                              } else {
                                setRemovedItemIds(prev => [...prev, item.id])
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 pt-4 border-t border-border flex gap-2">
                  <select 
                    className="select-field h-8 text-sm flex-1 bg-card border-input"
                    value={newCustomItemId}
                    onChange={(e) => setNewCustomItemId(e.target.value)}
                  >
                    <option value="" disabled>Select item from inventory...</option>
                    {availableInventoryItems.map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <Input 
                    placeholder="Qty" 
                    value={newCustomItemQty}
                    onChange={(e) => setNewCustomItemQty(e.target.value)}
                    className="h-8 text-sm w-20"
                  />
                  <Button 
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    disabled={!newCustomItemId}
                    onClick={() => {
                      if (newCustomItemId) {
                        const selectedItem = data.find(i => i.id === newCustomItemId)
                        if (selectedItem) {
                          setCustomShoppingItems(prev => [...prev, {
                            id: `custom-${Date.now()}`,
                            name: selectedItem.name,
                            quantity: `${newCustomItemQty.trim() || '1'} ${selectedItem.unit}`,
                            isCustom: true
                          }])
                          setNewCustomItemId('')
                          setNewCustomItemQty('')
                        }
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button variant="outline" onClick={handlePrintShoppingList} disabled={combinedShoppingItems.length === 0}>
                  <Printer className="mr-2 h-4 w-4" aria-hidden="true" /> Print PDF
                </Button>
                <Button onClick={handleCopyShoppingList} disabled={combinedShoppingItems.length === 0}>
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" /> Copy List
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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

        <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Inventory Item</DialogTitle>
            </DialogHeader>
            {editingItem && (
              <form action={handleEdit} className="space-y-4">
                <div>
                  <Label htmlFor="edit-name">Item Name</Label>
                  <Input id="edit-name" name="name" defaultValue={editingItem.name} required />
                </div>
                <div>
                  <Label htmlFor="edit-category">Category</Label>
                  <select id="edit-category" name="category" className="select-field" defaultValue={editingItem.category} required>
                    <option value="INGREDIENT">Ingredient</option>
                    <option value="DRINK">Drink</option>
                    <option value="PACKAGING">Packaging</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="edit-currentStock">Current Stock</Label>
                    <Input id="edit-currentStock" name="currentStock" type="number" step="any" defaultValue={editingItem.currentStock} required />
                  </div>
                  <div>
                    <Label htmlFor="edit-unit">Unit</Label>
                    <Input id="edit-unit" name="unit" placeholder="kg, pieces…" defaultValue={editingItem.unit} required />
                  </div>
                </div>
                <div>
                  <Label htmlFor="edit-minimumThreshold">Alert Threshold (Optional)</Label>
                  <Input id="edit-minimumThreshold" name="minimumThreshold" type="number" step="any" defaultValue={editingItem.minimumThreshold ?? ''} />
                </div>
                <Button type="submit" className="w-full">Save Changes</Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-popover">
              {table.getHeaderGroups().map(hg => hg.headers.map(header => (
                <th 
                  key={header.id} 
                  className={cn(
                    "table-head-cell", 
                    header.column.getCanSort() && "cursor-pointer select-none hover:text-foreground", 
                    header.column.getIsSorted() && "text-primary hover:text-primary/80",
                    header.column.columnDef.meta?.className
                  )}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <div className="flex items-center gap-2">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      header.column.getIsSorted() === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      ) : header.column.getIsSorted() === 'desc' ? (
                        <ArrowDown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
                      )
                    )}
                  </div>
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
                    'table-row cursor-pointer transition-colors hover:bg-muted/50 animate-fade-in-up',
                    idx % 2 === 0 && 'bg-card/40',
                    !row.original.isActive && 'opacity-60'
                  )}
                  style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
                  onClick={() => setEditingItem(row.original)}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={cn("px-4 py-3", cell.column.columnDef.meta?.className)}>
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
      <TablePagination table={table} />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the inventory item &quot;{deletingItem?.name}&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingItem && performDelete(deletingItem)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
