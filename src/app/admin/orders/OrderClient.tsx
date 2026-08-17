"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, User, InventoryItem, OrderStatus, OrderIngredientLog } from "@prisma/client"
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

type OrderWithRelations = Order & { 
  customer: User, 
  ingredientLogs: (OrderIngredientLog & { inventoryItem: InventoryItem })[] 
}

const columnHelper = createColumnHelper<OrderWithRelations>()

export function OrderClient({ 
  initialData, 
  customers, 
  inventory 
}: { 
  initialData: OrderWithRelations[],
  customers: User[],
  inventory: InventoryItem[]
}) {
  const [data, setData] = useState<OrderWithRelations[]>(initialData)
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIngredients, setSelectedIngredients] = useState<{ id: string, quantity: number }[]>([])

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
    
    // Only pass ingredients that actually have a selected ID and quantity > 0
    const ingredients = selectedIngredients
      .filter(i => i.id && i.quantity > 0)
      .map(i => ({ inventoryItemId: i.id, quantityUsed: i.quantity }))

    const newOrder = await createOrder({ customerId, description, totalPrice, ingredients })
    
    // Quick optimistic update hack to add it to UI without full reload
    const c = customers.find(c => c.id === customerId)!
    setData([{ ...newOrder, customer: c, ingredientLogs: [] }, ...data])
    setIsOpen(false)
    setSelectedIngredients([])
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
                  <Input id="totalPrice" name="totalPrice" type="number" step="any" required />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Order Details (e.g. 40 meat pies, 20 drinks)</Label>
                <Input id="description" name="description" required />
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label>Ingredients Used (Auto-deducted from Inventory)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedIngredients([...selectedIngredients, { id: '', quantity: 0 }])}>
                    Add Ingredient
                  </Button>
                </div>
                {selectedIngredients.map((ingredient, index) => (
                  <div key={index} className="flex gap-4 items-center">
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={ingredient.id}
                      onChange={(e) => {
                        const newArr = [...selectedIngredients]
                        newArr[index].id = e.target.value
                        setSelectedIngredients(newArr)
                      }}
                    >
                      <option value="" disabled>Select item...</option>
                      {inventory.map(inv => (
                        <option key={inv.id} value={inv.id}>{inv.name} (Stock: {inv.currentStock} {inv.unit})</option>
                      ))}
                    </select>
                    <Input 
                      type="number" 
                      step="any"
                      placeholder="Qty" 
                      className="w-24"
                      value={ingredient.quantity || ''}
                      onChange={(e) => {
                        const newArr = [...selectedIngredients]
                        newArr[index].quantity = Number(e.target.value)
                        setSelectedIngredients(newArr)
                      }}
                    />
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setSelectedIngredients(selectedIngredients.filter((_, i) => i !== index))}
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
