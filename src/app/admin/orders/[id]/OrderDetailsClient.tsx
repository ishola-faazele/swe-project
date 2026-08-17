"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, User, InventoryItem, OrderStatus, OrderIngredientLog } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateOrderIngredients } from "./actions"
import { updateOrderStatus } from "../actions"

type FullOrder = Order & { 
  customer: User, 
  ingredientLogs: (OrderIngredientLog & { inventoryItem: InventoryItem })[] 
}

export function OrderDetailsClient({ 
  order, 
  inventory 
}: { 
  order: FullOrder,
  inventory: InventoryItem[]
}) {
  const router = useRouter()
  
  // State for editable ingredients
  const [isEditing, setIsEditing] = useState(false)
  const [ingredients, setIngredients] = useState<{ id: string, quantity: number, internalId: number }[]>(
    order.ingredientLogs.map((log, i) => ({
      id: log.inventoryItemId,
      quantity: log.quantityUsed,
      internalId: i
    }))
  )
  const [counter, setCounter] = useState(order.ingredientLogs.length)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSaveIngredients() {
    setIsSaving(true)
    const payload = ingredients
      .filter(i => i.id && i.quantity > 0)
      .map(i => ({ inventoryItemId: i.id, quantityUsed: i.quantity }))
      
    try {
      const result = await updateOrderIngredients(order.id, payload)
      if (!result.ok) {
        alert(result.error)
        return
      }
      setIsEditing(false)
      // revalidatePath inside the action already re-renders this route in the same round trip,
      // so no explicit router.refresh() is needed here — matching existing behavior.
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not update this order's ingredients.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push('/admin/orders')}>
          &larr; Back to Orders
        </Button>
        <h2 className="text-3xl font-bold tracking-tight">Order #{order.shortId}</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-xl font-semibold mb-4">Customer Details</h3>
          <div className="space-y-2">
            <p><span className="font-medium text-slate-500">Name:</span> {order.customer.name || "N/A"}</p>
            <p><span className="font-medium text-slate-500">Email:</span> {order.customer.email || "N/A"}</p>
            <p><span className="font-medium text-slate-500">Phone:</span> {order.customer.phone || "N/A"}</p>
          </div>
        </div>
        
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-xl font-semibold mb-4">Order Details</h3>
          <div className="space-y-2">
            <p><span className="font-medium text-slate-500">Description:</span> {order.description}</p>
            <p><span className="font-medium text-slate-500">Total Price:</span> ${order.totalPrice}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="font-medium text-slate-500">Status:</span>
              <select
                value={order.status}
                disabled={order.status === 'CANCELLED'}
                onChange={async (e) => {
                  const val = e.target.value as OrderStatus
                  try {
                    const result = await updateOrderStatus(order.id, val)
                    if (!result.ok) {
                      alert(result.error)
                      return
                    }
                    router.refresh()
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Could not update this order.')
                  }
                }}
                className="bg-slate-100 dark:bg-slate-800 border rounded text-sm px-2 py-1 disabled:opacity-60"
              >
                {Object.values(OrderStatus).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>
      
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold">Ingredients Used</h3>
          {!isEditing ? (
            <Button variant="outline" onClick={() => setIsEditing(true)}>Edit Ingredients</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => {
                setIsEditing(false)
                // Reset to DB state
                setIngredients(order.ingredientLogs.map((log, i) => ({
                  id: log.inventoryItemId,
                  quantity: log.quantityUsed,
                  internalId: i
                })))
              }}>Cancel</Button>
              <Button onClick={handleSaveIngredients} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </div>
        
        {!isEditing ? (
          <div className="space-y-3">
            {order.ingredientLogs.length === 0 ? (
              <p className="text-slate-500">No ingredients logged for this order.</p>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-2 rounded-l-md font-medium">Item Name</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 rounded-r-md font-medium">Quantity Used</th>
                  </tr>
                </thead>
                <tbody>
                  {order.ingredientLogs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="px-4 py-3">{log.inventoryItem.name}</td>
                      <td className="px-4 py-3">{log.inventoryItem.category}</td>
                      <td className="px-4 py-3">{log.quantityUsed} {log.inventoryItem.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {ingredients.map((ingredient, index) => (
              <div key={ingredient.internalId} className="flex gap-4 items-center">
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={ingredient.id}
                  onChange={(e) => {
                    const newArr = [...ingredients]
                    newArr[index].id = e.target.value
                    setIngredients(newArr)
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
                  className="w-32"
                  value={ingredient.quantity || ''}
                  onChange={(e) => {
                    const newArr = [...ingredients]
                    newArr[index].quantity = Number(e.target.value)
                    setIngredients(newArr)
                  }}
                />
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setIngredients(ingredients.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              onClick={() => {
                setIngredients([...ingredients, { id: '', quantity: 0, internalId: counter }])
                setCounter(c => c + 1)
              }}
            >
              + Add Ingredient
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Note: Saving these changes will automatically revert the previous inventory deductions and apply the new ones.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
