"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, User, InventoryItem, OrderStatus, OrderIngredientLog, OrderDish } from "@prisma/client"
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
import { createOrder, updateOrderStatus, deleteOrder } from "./actions"
import { computeDishSubtotal, type DishSelection, type DishWithRecipe } from "@/lib/recipe"

type OrderWithRelations = Order & {
  customer: User,
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
  customers: User[],
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
          onChange={async (e) => {
            const val = e.target.value as OrderStatus
            await updateOrderStatus(info.row.original.id, val)
            setData(data.map(d => d.id === info.row.original.id ? { ...d, status: val } : d))
          }}
          className="bg-transparent border rounded text-sm px-1 py-1"
        >
          {Object.values(OrderStatus).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ),
    }),
    columnHelper.accessor("totalPrice", {
      header: "Total",
      cell: (info) => `$${info.getValue()}`,
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => (
        <Button 
          variant="destructive" 
          size="sm"
          onClick={async () => {
            await deleteOrder(info.row.original.id)
            setData(data.filter(i => i.id !== info.row.original.id))
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

    // Only pass rows that actually have a dish selected and a positive quantity
    const orderedDishes = selectedDishes.filter(d => d.dishId && d.quantity > 0)

    const newOrder = await createOrder({ customerId, description, totalPrice, dishes: orderedDishes })

    // Quick optimistic update hack to add it to UI without full reload
    const c = customers.find(c => c.id === customerId)!
    setData([{ ...newOrder, customer: c, ingredientLogs: [], dishes: [] }, ...data])
    setIsOpen(false)
    setSelectedDishes([])
    setTotalPriceInput('')
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger render={<Button />}>
            Create Order
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Order</DialogTitle>
            </DialogHeader>
            <form action={handleAdd} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customerId">Customer</Label>
                  <select id="customerId" name="customerId" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" required>
                    <option value="" disabled selected>Select customer</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.email || c.phone}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totalPrice">Total Price ($)</Label>
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
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={selection.dishId}
                      onChange={(e) => {
                        const newArr = [...selectedDishes]
                        newArr[index] = { ...newArr[index], dishId: e.target.value }
                        applyDishSelections(newArr)
                      }}
                    >
                      <option value="" disabled>Select dish...</option>
                      {activeDishes.map(dish => (
                        <option key={dish.id} value={dish.id}>{dish.name} (${dish.price})</option>
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
                  className="cursor-pointer transition-colors"
                  style={{
                    background: idx % 2 === 0 ? 'oklch(0.10 0.004 65)' : 'transparent',
                    borderBottom: '1px solid oklch(0.16 0.005 65)',
                  }}
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
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm"
                  style={{ color: 'oklch(0.40 0.008 65)' }}
                >
                  No orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
