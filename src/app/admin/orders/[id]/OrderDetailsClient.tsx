"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, User, InventoryItem, OrderStatus, OrderIngredientLog, OrderDish } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { computeDishSubtotal, type DishWithRecipe } from "@/lib/recipe"
import { updateOrderItems } from "./actions"
import { updateOrderStatus } from "../actions"

type FullOrder = Order & {
  customer: User,
  ingredientLogs: (OrderIngredientLog & { inventoryItem: InventoryItem })[],
  dishes: OrderDish[]
}

// `internalId` keeps React keys stable as rows are added and removed.
type DishRow = { dishId: string, quantity: number, internalId: number }

export function OrderDetailsClient({
  order,
  inventory,
  dishes
}: {
  order: FullOrder,
  inventory: InventoryItem[],
  dishes: DishWithRecipe[]
}) {
  const router = useRouter()

  // One edit mode drives both sections, because one action saves both.
  const [isEditing, setIsEditing] = useState(false)
  const [ingredients, setIngredients] = useState<{ id: string, quantity: number, internalId: number }[]>(
    order.ingredientLogs.map((log, i) => ({
      id: log.inventoryItemId,
      quantity: log.quantityUsed,
      internalId: i
    }))
  )
  const [counter, setCounter] = useState(order.ingredientLogs.length)
  const [dishSelections, setDishSelections] = useState<DishRow[]>(
    order.dishes.map((orderDish, i) => ({
      dishId: orderDish.dishId,
      quantity: orderDish.quantity,
      internalId: i
    }))
  )
  const [dishCounter, setDishCounter] = useState(order.dishes.length)
  const [totalPriceInput, setTotalPriceInput] = useState<number | ''>(order.totalPrice)
  const [isSaving, setIsSaving] = useState(false)

  const activeDishes = dishes.filter(d => d.isActive)

  // Same derived-with-override behaviour as the create form: the total re-derives inside each
  // dish-row handler, and typing in the field overrides it until the next dish-row change.
  function applyDishSelections(next: DishRow[]) {
    setDishSelections(next)
    setTotalPriceInput(computeDishSubtotal(next, dishes))
  }

  // A dish archived after this order was placed is no longer in the "add a dish" list, so the row
  // holding it would render blank. Offer it explicitly, falling back to the OrderDish snapshot.
  function optionsForRow(row: DishRow) {
    const options = activeDishes.map(dish => ({ id: dish.id, name: dish.name, price: dish.price }))
    if (row.dishId && !options.some(option => option.id === row.dishId)) {
      const catalogDish = dishes.find(d => d.id === row.dishId)
      const snapshot = order.dishes.find(od => od.dishId === row.dishId)
      options.unshift({
        id: row.dishId,
        name: `${catalogDish?.name ?? snapshot?.dishName ?? 'Unknown dish'} (archived)`,
        price: catalogDish?.price ?? snapshot?.unitPrice ?? 0,
      })
    }
    return options
  }

  function resetToDbState() {
    setIngredients(order.ingredientLogs.map((log, i) => ({
      id: log.inventoryItemId,
      quantity: log.quantityUsed,
      internalId: i
    })))
    setCounter(order.ingredientLogs.length)
    setDishSelections(order.dishes.map((orderDish, i) => ({
      dishId: orderDish.dishId,
      quantity: orderDish.quantity,
      internalId: i
    })))
    setDishCounter(order.dishes.length)
    setTotalPriceInput(order.totalPrice)
  }

  async function handleSave() {
    setIsSaving(true)

    try {
      const result = await updateOrderItems(order.id, {
        dishes: dishSelections
          .filter(row => row.dishId && row.quantity > 0)
          .map(row => ({ dishId: row.dishId, quantity: row.quantity })),
        extraIngredients: ingredients
          .filter(i => i.id && i.quantity > 0)
          .map(i => ({ inventoryItemId: i.id, quantityUsed: i.quantity })),
        totalPrice: totalPriceInput === '' ? 0 : totalPriceInput,
      })
      if (!result.ok) {
        alert(result.error)
        return
      }
      setIsEditing(false)
      // revalidatePath inside the action already re-renders this route in the same round trip,
      // so no explicit router.refresh() is needed here — matching existing behavior.
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not update this order's items.")
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
            <p><span className="font-medium text-slate-500">Description:</span> {order.description || "—"}</p>
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

      {/* Dishes Ordered — owns the single Edit/Save control set, since one action saves both
          this section and the ingredient section below it. */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold">Dishes Ordered</h3>
          {!isEditing ? (
            <Button variant="outline" onClick={() => setIsEditing(true)}>Edit Order Items</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => {
                setIsEditing(false)
                resetToDbState()
              }}>Cancel</Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </div>

        {!isEditing ? (
          <div className="space-y-3">
            {order.dishes.length === 0 ? (
              <p className="text-slate-500">
                No dishes recorded for this order — it was placed before the menu existed, or was
                entered as notes only.
              </p>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-2 rounded-l-md font-medium">Dish</th>
                    <th className="px-4 py-2 font-medium">Unit Price</th>
                    <th className="px-4 py-2 rounded-r-md font-medium">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.dishes.map((orderDish) => (
                    <tr key={orderDish.id} className="border-b last:border-0">
                      <td className="px-4 py-3">{orderDish.quantity}× {orderDish.dishName}</td>
                      <td className="px-4 py-3">${orderDish.unitPrice}</td>
                      <td className="px-4 py-3">${orderDish.unitPrice * orderDish.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {dishSelections.map((row, index) => (
              <div key={row.internalId} className="flex gap-4 items-center">
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={row.dishId}
                  onChange={(e) => {
                    const newArr = [...dishSelections]
                    newArr[index] = { ...newArr[index], dishId: e.target.value }
                    applyDishSelections(newArr)
                  }}
                >
                  <option value="" disabled>Select dish...</option>
                  {optionsForRow(row).map(option => (
                    <option key={option.id} value={option.id}>{option.name} (${option.price})</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Qty"
                  className="w-32"
                  value={row.quantity || ''}
                  onChange={(e) => {
                    const newArr = [...dishSelections]
                    newArr[index] = { ...newArr[index], quantity: Number(e.target.value) }
                    applyDishSelections(newArr)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => applyDishSelections(dishSelections.filter((_, i) => i !== index))}
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
                applyDishSelections([...dishSelections, { dishId: '', quantity: 1, internalId: dishCounter }])
                setDishCounter(c => c + 1)
              }}
            >
              + Add Dish
            </Button>

            <div className="space-y-2 max-w-xs pt-2">
              <Label htmlFor="totalPrice">Total Price ($)</Label>
              <Input
                id="totalPrice"
                type="number"
                step="any"
                value={totalPriceInput}
                onChange={(e) => setTotalPriceInput(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Recalculated from the dishes above whenever a dish row changes. Type over it to
                charge something different.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold">{isEditing ? "Extra Ingredients" : "Ingredients Used"}</h3>
          {!isEditing && (
            <Button variant="outline" onClick={() => setIsEditing(true)}>Edit Order Items</Button>
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
            <p className="text-xs text-muted-foreground">
              Anything the dishes above don&apos;t cover. These are added on top of the ingredients
              each selected dish already deducts.
            </p>
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
