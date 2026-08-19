"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, User, InventoryItem, OrderStatus, OrderIngredientLog, OrderDish } from "@prisma/client"
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
import { ORDER_STATUS_CONFIG } from "@/lib/orderStatus"

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
import { toast } from "@/components/ui/toast"
import { createOrder, updateOrderStatus, deleteOrder } from "./actions"
import { computeDishSubtotal, expandDishesToIngredients, type DishSelection, type DishWithRecipe } from "@/lib/recipe"
import { BUSINESS_LOCALE, formatCurrency, getCurrencySymbol } from "@/lib/currency"
import { getDueUrgency, isActiveOrderStatus } from "@/lib/dueDate"
import { cn } from "@/lib/utils"
import { HighlightText } from "@/components/ui/highlight"
import { TablePagination } from "@/components/ui/table-pagination"
import { AlertTriangle, Clock, ClipboardList, X, Trash2, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, CalendarDays } from "lucide-react"

type OrderWithRelations = Order & {
  customer: User,
  ingredientLogs: (OrderIngredientLog & { inventoryItem: InventoryItem })[],
  dishes: OrderDish[]
}

const columnHelper = createColumnHelper<OrderWithRelations>()

export function OrderClient({
  initialData,
  customers,
  inventory,
  dishes
}: {
  initialData: OrderWithRelations[],
  customers: User[],
  inventory: InventoryItem[],
  dishes: DishWithRecipe[]
}) {
  const [data, setData] = useState<OrderWithRelations[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [selectedDishes, setSelectedDishes] = useState<DishSelection[]>([])
  const [totalPriceInput, setTotalPriceInput] = useState<number | ''>('')
  const [deletingOrder, setDeletingOrder] = useState<OrderWithRelations | null>(null)
  const [cancellingOrder, setCancellingOrder] = useState<OrderWithRelations | null>(null)
  // Ingredient override state for the create-order dialog
  const [showIngredientPreview, setShowIngredientPreview] = useState(false)
  const [ingredientOverrides, setIngredientOverrides] = useState<
    { inventoryItemId: string; quantityUsed: number; internalId: number }[]
  >([])
  const [overrideCounter, setOverrideCounter] = useState(0)

  const activeDishes = dishes.filter(d => d.isActive)

  // no useEffect, matching the rest of this codebase. Typing in the total field overrides the
  // derived value until the next dish-row change.
  function applyDishSelections(next: DishSelection[]) {
    setSelectedDishes(next)
    setTotalPriceInput(computeDishSubtotal(next, dishes))

    // Auto-populate ingredient preview from dish recipes as a starting suggestion
    const expanded = expandDishesToIngredients(next, dishes)
    setIngredientOverrides(
      expanded.map((line, i) => ({ ...line, internalId: i }))
    )
    setOverrideCounter(expanded.length)
  }

  // Calculate grouped orders for Calendar View
  const groupedOrders = React.useMemo(() => {
    const groups: Record<string, OrderWithRelations[]> = {}
    data.forEach(order => {
      if (!order.dueDate) return
      // Use YYYY-MM-DD string to group safely by UTC midnight date
      const key = order.dueDate.toISOString().split('T')[0]
      if (!groups[key]) groups[key] = []
      groups[key].push(order)
    })
    const sortedKeys = Object.keys(groups).sort()
    return sortedKeys.map(key => {
      // Re-parse as local midnight to format nicely for UI
      // Replacing hyphens with slashes ensures Date parses it as local timezone in some browsers,
      // but providing YYYY-MM-DD parse it as UTC. We append T00:00:00 to specify time.
      const dateObj = new Date(`${key}T00:00:00`)
      return {
        dateStr: key,
        displayDate: dateObj.toLocaleDateString(BUSINESS_LOCALE, { weekday: 'long', month: 'short', day: 'numeric' }),
        orders: groups[key].sort((a, b) => a.shortId - b.shortId)
      }
    })
  }, [data])

  const columns = [
    columnHelper.accessor("shortId", {
      header: "ID",
      cell: (info) => `#${info.getValue()}`,
    }),
    columnHelper.accessor("description", {
      header: "Order",
      cell: (info) => <HighlightText text={info.getValue()} query={globalFilter} />,
    }),
    columnHelper.accessor("customer", {
      header: "Customer",
      meta: { className: "hidden md:table-cell" },
      cell: (info) => {
        const c = info.getValue()
        const text = c.name || c.email || c.phone || "Unknown"
        return <HighlightText text={text} query={globalFilter} />
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => (
        <select
          value={info.getValue()}
          disabled={info.row.original.status === 'CANCELLED'}
          onChange={async (e) => {
            const val = e.target.value as OrderStatus
            // Cancellation is terminal — there is no un-cancel, a mistake means
            // re-creating the order from scratch. The <select> is already
            // disabled once CANCELLED, so this can only fire on the way IN.
            // Declining reverts the controlled <select> on its own, the same
            // way the !result.ok path below does.
            if (val === 'CANCELLED') {
              setCancellingOrder(info.row.original)
              return
            }
            try {
              const result = await updateOrderStatus(info.row.original.id, val)
              if (!result.ok) {
                toast.add({ title: 'Error', description: result.error, type: 'error' })
                return // controlled <select> reverts on its own — data state is simply left unchanged
              }
              setData(data.map(d => d.id === info.row.original.id ? { ...d, status: val } : d))
              toast.add({ title: 'Status updated', description: `Order #${info.row.original.shortId} marked as ${val}.`, type: 'success' })
            } catch (err) {
              toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update this order.', type: 'error' })
            }
          }}
          className="select-field h-8 w-auto px-2 py-1"
        >
          {Object.values(OrderStatus).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ),
    }),
    columnHelper.accessor("dueDate", {
      header: "Due",
      meta: { className: "hidden md:table-cell" },
      cell: (info) => {
        const dueDate = info.getValue()
        if (!dueDate) return <span className="meta-text">—</span>
        // Only orders still in the kitchen queue can be "late" — a COMPLETED
        // order with a long-past due date was delivered, not missed.
        const urgency = isActiveOrderStatus(info.row.original.status)
          ? getDueUrgency(dueDate)
          : "none"
        const label = dueDate.toLocaleDateString(BUSINESS_LOCALE, { month: 'short', day: 'numeric' })

        // Badges always pair an icon with a text label — never color alone.
        if (urgency === 'overdue') {
          return (
            <span className="due-overdue">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overdue · {label}
            </span>
          )
        }
        if (urgency === 'due-today') {
          return (
            <span className="due-today">
              <Clock className="h-3 w-3" aria-hidden="true" /> Due Today
            </span>
          )
        }
        return <span className="meta-text">{label}</span>
      },
    }),
    columnHelper.accessor("totalPrice", {
      header: "Total",
      meta: { className: "hidden md:table-cell" },
      cell: (info) => <span className="table-cell-num">{formatCurrency(info.getValue())}</span>,
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Delete order"
          onClick={(e) => {
            e.stopPropagation();
            setDeletingOrder(info.row.original);
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Delete</span>
        </Button>
      ),
    })
  ]

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })
  
  const router = useRouter()

  async function handleAdd(formData: FormData) {
    const customerId = formData.get("customerId") as string
    const description = formData.get("description") as string
    const totalPrice = Number(formData.get("totalPrice"))

    // A bare "YYYY-MM-DD" parses as UTC midnight per spec. Lagos is UTC+1, so
    // that instant is still the SAME calendar day locally, and getDueUrgency
    // compares Lagos calendar days. Deliberately not "fixed" to local-time
    // parsing — the two behaviors only agree because of that interaction.
    const dueDateStr = formData.get("dueDate") as string
    const dueDate = dueDateStr ? new Date(dueDateStr) : null

    // Only pass rows that actually have a dish selected and a positive quantity
    const orderedDishes = selectedDishes.filter(d => d.dishId && d.quantity > 0)

    // If the admin opened and potentially edited the ingredient preview, send their
    // final list as overrides. Otherwise let the server auto-calculate from recipes.
    const overrides = showIngredientPreview
      ? ingredientOverrides.filter(o => o.inventoryItemId && o.quantityUsed > 0)
      : undefined

    try {
      const result = await createOrder({
        customerId, description, totalPrice, dueDate,
        dishes: orderedDishes,
        ingredientOverrides: overrides,
      })
      if (!result.ok) {
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }

      // Quick optimistic update hack to add it to UI without full reload
      const c = customers.find(c => c.id === customerId)!
      setData([{ ...result.data, customer: c, ingredientLogs: [], dishes: [] }, ...data])
      setIsOpen(false)
      setSelectedDishes([])
      setTotalPriceInput('')
      setShowIngredientPreview(false)
      setIngredientOverrides([])
      toast.add({ title: 'Order created', description: `Order #${result.data.shortId} added to the queue.`, type: 'success' })
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not create this order.', type: 'error' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <h2 className="page-title">Orders</h2>
        <div className="flex flex-1 sm:flex-none flex-wrap items-center gap-4">
          <div className="flex bg-muted/50 p-1 rounded-md border border-border shrink-0">
            <button 
              onClick={() => setViewMode('list')} 
              className={cn("px-3 py-1 text-sm font-medium rounded-sm transition-colors", viewMode === 'list' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              List
            </button>
            <button 
              onClick={() => setViewMode('calendar')} 
              className={cn("px-3 py-1 text-sm font-medium rounded-sm transition-colors", viewMode === 'calendar' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Calendar
            </button>
          </div>
          <Input
            placeholder="Search orders..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(String(e.target.value))}
            className="max-w-[180px] bg-card shrink-0"
          />
          <Button onClick={() => setIsOpen(true)} className="shrink-0">Create Order</Button>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Order</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customerId">Customer</Label>
                  <select id="customerId" name="customerId" className="select-field" required defaultValue="">
                    <option value="" disabled>Select customer</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.email || c.phone || `#${c.shortId}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totalPrice">Total Price ({getCurrencySymbol()})</Label>
                  <Input
                    id="totalPrice"
                    name="totalPrice"
                    type="number"
                    step="any"
                    required
                    value={totalPriceInput}
                    onChange={(e) => setTotalPriceInput(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date (Optional)</Label>
                <Input id="dueDate" name="dueDate" type="date" autoComplete="off" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input id="description" name="description" placeholder="Short description (e.g. Birthday party, 40 pies)" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes (optional)</Label>
                <textarea 
                  id="notes" 
                  name="notes" 
                  placeholder="Dietary requirements, delivery instructions...&#10;Press Enter for bullet points."
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label>Dishes (Ingredients Auto-deducted from Inventory)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => applyDishSelections([...selectedDishes, { dishId: '', quantity: 1 }])}>
                    Add Dish
                  </Button>
                </div>
                {activeDishes.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No dishes on the menu yet — add one under Menu to build orders from dishes.
                  </p>
                )}
                {selectedDishes.map((selection, index) => (
                  <div key={index} className="flex gap-4 items-center">
                    <select
                      className="select-field"
                      value={selection.dishId}
                      onChange={(e) => {
                        const newArr = [...selectedDishes]
                        newArr[index] = { ...newArr[index], dishId: e.target.value }
                        applyDishSelections(newArr)
                      }}
                    >
                      <option value="" disabled>Select dish...</option>
                      {activeDishes.map(dish => (
                        <option key={dish.id} value={dish.id}>{dish.name} ({formatCurrency(dish.price)})</option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Qty"
                      className="w-24"
                      value={selection.quantity || ''}
                      onChange={(e) => {
                        const newArr = [...selectedDishes]
                        newArr[index] = { ...newArr[index], quantity: Number(e.target.value) }
                        applyDishSelections(newArr)
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove dish"
                      onClick={() => applyDishSelections(selectedDishes.filter((_, i) => i !== index))}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Collapsible ingredient preview — collapsed by default, expand for bulk order tweaks */}
              {selectedDishes.some(d => d.dishId && d.quantity > 0) && (
                <div className="border-t pt-4 space-y-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowIngredientPreview(!showIngredientPreview)}
                  >
                    <span>Review &amp; Adjust Ingredients ({ingredientOverrides.filter(o => o.inventoryItemId).length} items)</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showIngredientPreview && "rotate-180")} aria-hidden="true" />
                  </button>

                  {showIngredientPreview && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">
                        These ingredients will be deducted from inventory. Adjust quantities for bulk orders, or add extras not covered by dish recipes.
                      </p>
                      {ingredientOverrides.map((override, index) => (
                        <div key={override.internalId} className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-start sm:items-center">
                          <select
                            className="select-field flex-1"
                            value={override.inventoryItemId}
                            onChange={(e) => {
                              const newArr = [...ingredientOverrides]
                              newArr[index] = { ...newArr[index], inventoryItemId: e.target.value }
                              setIngredientOverrides(newArr)
                            }}
                          >
                            <option value="" disabled>Select item…</option>
                            {inventory.map(inv => (
                              <option key={inv.id} value={inv.id}>
                                {inv.name} (Stock: {inv.currentStock} {inv.unit})
                              </option>
                            ))}
                          </select>
                          <Input
                            type="number"
                            step="any"
                            placeholder="Qty"
                            className="w-24"
                            value={override.quantityUsed || ''}
                            onChange={(e) => {
                              const newArr = [...ingredientOverrides]
                              newArr[index] = { ...newArr[index], quantityUsed: Number(e.target.value) }
                              setIngredientOverrides(newArr)
                            }}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Remove ingredient"
                            onClick={() => setIngredientOverrides(ingredientOverrides.filter((_, i) => i !== index))}
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIngredientOverrides([...ingredientOverrides, { inventoryItemId: '', quantityUsed: 0, internalId: overrideCounter }])
                          setOverrideCounter(c => c + 1)
                        }}
                      >
                        + Add Ingredient
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" className="w-full">Create Order & Deduct Inventory</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {viewMode === 'calendar' ? (
        <div className="space-y-8 animate-in fade-in duration-300">
          {groupedOrders.length === 0 ? (
            <div className="empty-state py-12 rounded-lg border border-border">
              <div className="empty-state-icon">
                <CalendarDays className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="empty-state-title">No scheduled orders</p>
              <p className="empty-state-hint">Orders with due dates will appear here.</p>
            </div>
          ) : (
            groupedOrders.map(group => (
              <div key={group.dateStr} className="space-y-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-border/50 pb-2">
                   <CalendarDays className="h-5 w-5 text-primary" /> {group.displayDate}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.orders.map(order => {
                    const cfg = ORDER_STATUS_CONFIG[order.status] || { className: 'badge-neutral', label: order.status, icon: Clock }
                    const StatusIcon = cfg.icon
                    const isOverdue = isActiveOrderStatus(order.status) && getDueUrgency(order.dueDate) === 'overdue'
                    return (
                      <div 
                        key={order.id} 
                        className={cn(
                          "border rounded-lg p-4 bg-card cursor-pointer hover:shadow-md transition-all",
                          isOverdue ? "border-destructive/30 bg-destructive/5" : "border-border hover:border-primary/40"
                        )}
                        onClick={() => router.push(`/admin/orders/${order.id}`)}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <span className="font-bold text-primary font-mono-data tracking-tight text-lg">#{order.shortId}</span>
                          <span className={cn(cfg.className, "text-[10px] px-2 py-0.5 rounded-full")}>
                            <StatusIcon className="h-3 w-3 mr-1 inline" aria-hidden="true" />
                            {cfg.label}
                          </span>
                        </div>
                        <p className="font-medium text-foreground/90 leading-tight mb-1">
                          {order.customer.name || order.customer.email || `#${order.customer.shortId}`}
                        </p>
                        <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                          {order.description || <span className="italic opacity-50">No description</span>}
                        </p>
                        <div className="mt-4 pt-3 border-t border-border/50 flex justify-between items-center">
                           <div className="text-xs text-muted-foreground">
                             {order.dishes?.length > 0 ? `${order.dishes.length} items` : 'No dishes'}
                           </div>
                           <div className="font-mono-data font-bold text-foreground">
                             {formatCurrency(order.totalPrice)}
                           </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border animate-in fade-in duration-300">
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
                  table.getRowModel().rows.map((row, idx) => {
                    // Row tint REINFORCES the Due column's badge; it never carries
                    // the urgency on its own. Expressed as classes rather than an
                    // inline style object specifically so the hover: variants below
                    // are possible at all — inline styles cannot express :hover.
                    const urgency = isActiveOrderStatus(row.original.status)
                      ? getDueUrgency(row.original.dueDate)
                      : "none"
                    return (
                    <tr
                      key={row.id}
                      className={cn(
                        "table-row cursor-pointer",
                        urgency === 'overdue' && 'bg-destructive/8 hover:bg-destructive/12',
                        urgency === 'due-today' && 'bg-primary/6 hover:bg-primary/10',
                        urgency !== 'overdue' && urgency !== 'due-today' && (idx % 2 === 0 ? 'bg-card/40' : ''),
                      )}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
                          router.push(`/admin/orders/${row.original.id}`)
                        }
                      }}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className={cn("px-4 py-3", cell.column.columnDef.meta?.className)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={columns.length}>
                      <div className="empty-state">
                        <div className="empty-state-icon">
                          <ClipboardList className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <p className="empty-state-title">No orders found</p>
                        <p className="empty-state-hint">
                          Create an order to start tracking it through the kitchen queue.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination table={table} />
        </>
      )}

      <AlertDialog open={!!deletingOrder} onOpenChange={(open) => !open && setDeletingOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete order #{deletingOrder?.shortId}.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Order</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deletingOrder) return
                try {
                  const result = await deleteOrder(deletingOrder.id)
                  if (!result.ok) {
                    toast.add({ title: 'Error', description: result.error, type: 'error' })
                    return
                  }
                  setData(data.filter(i => i.id !== deletingOrder.id))
                  toast.add({ title: 'Order deleted', description: `Order #${deletingOrder.shortId} was permanently deleted.`, type: 'success' })
                } catch (err) {
                  toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not delete this order.', type: 'error' })
                } finally {
                  setDeletingOrder(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cancellingOrder} onOpenChange={(open) => !open && setCancellingOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancel order #{cancellingOrder?.shortId}? This cannot be undone — a new order must be created if this was a mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Active</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!cancellingOrder) return
                try {
                  const result = await updateOrderStatus(cancellingOrder.id, 'CANCELLED')
                  if (!result.ok) {
                    toast.add({ title: 'Error', description: result.error, type: 'error' })
                    return
                  }
                  setData(data.map(d => d.id === cancellingOrder.id ? { ...d, status: 'CANCELLED' as OrderStatus } : d))
                  toast.add({ title: 'Order cancelled', description: `Order #${cancellingOrder.shortId} was cancelled.`, type: 'success' })
                } catch (err) {
                  toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not cancel this order.', type: 'error' })
                } finally {
                  setCancellingOrder(null)
                }
              }}
            >
              Cancel Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
