"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, InventoryItem, OrderStatus, OrderIngredientLog, OrderDish } from "@prisma/client"
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
import { createOrder, updateOrderStatus, deleteOrder } from "./actions"
import { computeDishSubtotal, type DishSelection, type DishWithRecipe } from "@/lib/recipe"
import { BUSINESS_LOCALE, formatCurrency, getCurrencySymbol } from "@/lib/currency"
import { getDueUrgency, isActiveOrderStatus } from "@/lib/dueDate"
import { cn } from "@/lib/utils"
import type { ClientSafeUser } from "@/lib/user"
import { AlertTriangle, Clock, ClipboardList } from "lucide-react"

type OrderWithRelations = Order & {
  customer: ClientSafeUser,
  ingredientLogs: (OrderIngredientLog & { inventoryItem: InventoryItem })[],
  dishes: OrderDish[]
}

const columnHelper = createColumnHelper<OrderWithRelations>()

export function OrderClient({
  initialData,
  customers,
  dishes
}: {
  initialData: OrderWithRelations[],
  customers: ClientSafeUser[],
  // Still fetched and passed by OrdersPage — kept on the props so the page's fetch shape stays
  // aligned with the order-detail flow, which does read it.
  inventory: InventoryItem[],
  dishes: DishWithRecipe[]
}) {
  const [data, setData] = useState<OrderWithRelations[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [selectedDishes, setSelectedDishes] = useState<DishSelection[]>([])
  const [totalPriceInput, setTotalPriceInput] = useState<number | ''>('')

  const activeDishes = dishes.filter(d => d.isActive)

  // Every dish-row mutation goes through here so the total re-derives in the same event handler —
  // no useEffect, matching the rest of this codebase. Typing in the total field overrides the
  // derived value until the next dish-row change.
  function applyDishSelections(next: DishSelection[]) {
    setSelectedDishes(next)
    setTotalPriceInput(computeDishSubtotal(next, dishes))
  }

  const columns = [
    columnHelper.accessor("shortId", {
      header: "ID",
      cell: (info) => `#${info.getValue()}`,
    }),
    columnHelper.accessor("description", {
      header: "Order",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("customer", {
      header: "Customer",
      cell: (info) => {
        const c = info.getValue()
        return c.name || c.email || c.phone || "Unknown"
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
              const confirmed = confirm(
                `Cancel order #${info.row.original.shortId}? This cannot be undone — a new order must be created if this was a mistake.`
              )
              if (!confirmed) return
            }
            try {
              const result = await updateOrderStatus(info.row.original.id, val)
              if (!result.ok) {
                alert(result.error)
                return // controlled <select> reverts on its own — data state is simply left unchanged
              }
              setData(data.map(d => d.id === info.row.original.id ? { ...d, status: val } : d))
            } catch (err) {
              alert(err instanceof Error ? err.message : 'Could not update this order.')
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
      cell: (info) => <span className="table-cell-num">{formatCurrency(info.getValue())}</span>,
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <Button 
          variant="destructive" 
          size="sm"
          onClick={async () => {
            try {
              const result = await deleteOrder(info.row.original.id)
              if (!result.ok) {
                alert(result.error)
                return
              }
              setData(data.filter(i => i.id !== info.row.original.id))
            } catch (err) {
              alert(err instanceof Error ? err.message : 'Could not delete this order.')
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

    try {
      const result = await createOrder({ customerId, description, totalPrice, dueDate, dishes: orderedDishes })
      if (!result.ok) {
        alert(result.error)
        return
      }

      // Quick optimistic update hack to add it to UI without full reload
      const c = customers.find(c => c.id === customerId)!
      setData([{ ...result.data, customer: c, ingredientLogs: [], dishes: [] }, ...data])
      setIsOpen(false)
      setSelectedDishes([])
      setTotalPriceInput('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create this order.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Direct onClick, not DialogTrigger render — see AGENTS.md. */}
        <Button onClick={() => setIsOpen(true)}>Create Order</Button>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Order</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customerId">Customer</Label>
                  <select id="customerId" name="customerId" className="select-field" required>
                    <option value="" disabled selected>Select customer</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.email || c.phone}</option>
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
                <Label htmlFor="description">Notes (optional)</Label>
                <Input id="description" name="description" placeholder="Notes (e.g. no pepper, extra meat pies, delivery instructions)" />
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
                      onClick={() => applyDishSelections(selectedDishes.filter((_, i) => i !== index))}
                    >
                      X
                    </Button>
                  </div>
                ))}
              </div>

              <Button type="submit" className="w-full">Create Order & Deduct Inventory</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
                    <td key={cell.id} className="px-4 py-3">
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
    </div>
  )
}
