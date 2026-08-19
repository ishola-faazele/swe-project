"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Order, InventoryItem, OrderStatus, OrderIngredientLog, OrderDish } from "@prisma/client"
import type { ClientSafeUser } from "@/lib/user"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { computeDishSubtotal, type DishWithRecipe } from "@/lib/recipe"
import { updateOrderItems, updateOrderDueDate, updateOrderInfo } from "./actions"
import { updateOrderStatus } from "../actions"
import { formatCurrency, getCurrencySymbol, BUSINESS_LOCALE } from "@/lib/currency"
import { Share2 } from "lucide-react"
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

type FullOrder = Order & {
  customer: ClientSafeUser,
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
  const [isEditingInfo, setIsEditingInfo] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState(order.description)
  const [notesInput, setNotesInput] = useState(order.notes || '')
  const [isSavingInfo, setIsSavingInfo] = useState(false)
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [isSavingNotes, setIsSavingNotes] = useState(false)
  const [cancellingOrder, setCancellingOrder] = useState<FullOrder | null>(null)
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

  // Ingredient-focused counterpart to the dish-focused optionsForRow above — deliberately named
  // apart from it, since the two resolve different entities from different fallback sources.
  //
  // The `inventory` prop is active-only (getInventoryItems' default), so an ingredient archived
  // after this order was logged is absent from the picker, and the row holding it would render an
  // unmatched <select> value. This order's own ingredientLogs join already carries the full
  // InventoryItem row, so the missing option is reinjected from there. Archived options are
  // marked from their own isActive field rather than a mangled name.
  function ingredientOptionsForRow(row: { id: string }): InventoryItem[] {
    if (!row.id || inventory.some(inv => inv.id === row.id)) return inventory

    const fromLog = order.ingredientLogs.find(log => log.inventoryItemId === row.id)?.inventoryItem
    return fromLog ? [fromLog, ...inventory] : inventory
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
    if (!navigator.onLine) {
      toast.add({ title: 'Offline', description: 'You are offline. Please reconnect to save changes.', type: 'error' })
      return
    }
    
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
        toast.add({ title: 'Error', description: result.error, type: 'error' })
        return
      }
      setIsEditing(false)
      // revalidatePath inside the action already re-renders this route in the same round trip,
      // so no explicit router.refresh() is needed here — matching existing behavior.
    } catch (err) {
      toast.add({ title: 'Error', description: err instanceof Error ? err.message : "Could not update this order's items.", type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleShareReceipt = () => {
    if (!order.customer.phone) {
      toast.add({ title: 'No Phone Number', description: 'This customer has no phone number recorded.', type: 'error' })
      return
    }

    const lines = [
      `*Receipt for Order #${order.shortId}*`,
      `Customer: ${order.customer.name || 'N/A'}`,
      `Status: ${order.status}`,
      ``,
      `*Items:*`,
      ...order.dishes.map(d => `- ${d.quantity}x ${d.dishName} (${formatCurrency(d.unitPrice)})`),
      ``,
      `*Total: ${formatCurrency(order.totalPrice)}*`,
    ]

    if (order.dueDate) {
      lines.push(`Due Date: ${order.dueDate.toLocaleDateString(BUSINESS_LOCALE)}`)
    }

    const text = encodeURIComponent(lines.join('\n'))
    const phone = order.customer.phone.replace(/[^\d]/g, '')
    
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push('/admin/orders')}>
            &larr; Back to Orders
          </Button>
          <h2 className="page-title">Order #{order.shortId}</h2>
        </div>
        
        <Button variant="outline" onClick={handleShareReceipt} disabled={!order.customer.phone} className={!order.customer.phone ? 'opacity-50' : ''} title={!order.customer.phone ? 'Customer must have a phone number to share receipt' : 'Share on WhatsApp'}>
          <Share2 className="mr-1.5 h-4 w-4 text-green-600" aria-hidden="true" /> Share Receipt
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-xl font-semibold mb-4">Customer Details</h3>
          <div className="space-y-2">
            <p><span className="font-medium text-muted-foreground">Name:</span> {order.customer.name || "N/A"}</p>
            <p><span className="font-medium text-muted-foreground">Email:</span> {order.customer.email || "N/A"}</p>
            <p><span className="font-medium text-muted-foreground">Phone:</span> {order.customer.phone || "N/A"}</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <h3 className="text-xl font-semibold">Order Details</h3>
            {!isEditingInfo ? (
              <Button variant="ghost" size="sm" onClick={() => setIsEditingInfo(true)}>
                Edit Details
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => {
                  setIsEditingInfo(false)
                  setDescriptionInput(order.description)
                }}>Cancel</Button>
                <Button size="sm" disabled={isSavingInfo} onClick={async () => {
                  if (!navigator.onLine) {
                    toast.add({ title: 'Offline', description: 'You are offline. Please reconnect to save details.', type: 'error' })
                    return
                  }
                  setIsSavingInfo(true)
                  const res = await updateOrderInfo(order.id, descriptionInput, order.notes || '')
                  if (!res.ok) toast.add({ title: 'Error', description: res.error, type: 'error' })
                  else {
                    setIsEditingInfo(false)
                    toast.add({ title: 'Success', description: 'Order details saved.', type: 'success' })
                  }
                  setIsSavingInfo(false)
                }}>
                  {isSavingInfo ? "Saving..." : "Save Details"}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-4">
            {!isEditingInfo ? (
              <>
                <div>
                  <span className="font-medium text-muted-foreground">Description:</span>
                  <p className="mt-1">{order.description || "—"}</p>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-desc">Description</Label>
                  <Input 
                    id="edit-desc" 
                    value={descriptionInput} 
                    onChange={e => setDescriptionInput(e.target.value)} 
                  />
                </div>
              </div>
            )}
            
            <p className="pt-2"><span className="font-medium text-muted-foreground">Total Price:</span> <span className="table-cell-num">{formatCurrency(order.totalPrice)}</span></p>
            <div className="flex items-center gap-2 mt-2">
              <Label htmlFor="orderStatus" className="font-medium text-muted-foreground">Status:</Label>
              <select
                id="orderStatus"
                value={order.status}
                disabled={order.status === 'CANCELLED'}
                onChange={async (e) => {
                  if (!navigator.onLine) {
                    toast.add({ title: 'Offline', description: 'You are offline. Please reconnect to update status.', type: 'error' })
                    e.preventDefault()
                    return
                  }
                  const val = e.target.value as OrderStatus
                  // Same terminal-action guard as the orders table. The <select>
                  // is already disabled once CANCELLED, so this only ever fires
                  // on the way IN to cancellation.
                  if (val === 'CANCELLED') {
                    setCancellingOrder(order)
                    return
                  }
                  try {
                    const result = await updateOrderStatus(order.id, val)
                    if (!result.ok) {
                      toast.add({ title: 'Error', description: result.error, type: 'error' })
                      return
                    }
                    router.refresh()
                    toast.add({ title: 'Success', description: `Order status updated to ${val}.`, type: 'success' })
                  } catch (err) {
                    toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update this order.', type: 'error' })
                  }
                }}
                className="select-field w-auto"
              >
                {Object.values(OrderStatus).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Label htmlFor="dueDate" className="font-medium text-muted-foreground">Due Date:</Label>
              <input
                id="dueDate"
                type="date"
                autoComplete="off"
                defaultValue={order.dueDate ? order.dueDate.toISOString().slice(0, 10) : ''}
                onChange={async (e) => {
                  if (!navigator.onLine) {
                    toast.add({ title: 'Offline', description: 'You are offline. Please reconnect to update due date.', type: 'error' })
                    e.preventDefault()
                    return
                  }
                  // Clearing the field is a real edit — it sets dueDate back to NULL.
                  const val = e.target.value ? new Date(e.target.value) : null
                  try {
                    const result = await updateOrderDueDate(order.id, val)
                    if (!result.ok) {
                      toast.add({ title: 'Error', description: result.error, type: 'error' })
                      return
                    }
                    router.refresh()
                    toast.add({ title: 'Success', description: 'Due date updated.', type: 'success' })
                  } catch (err) {
                    toast.add({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update this due date.', type: 'error' })
                  }
                }}
                className="select-field w-auto"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Dishes Ordered — owns the single Edit/Save control set, since one action saves both
          this section and the ingredient section below it. */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
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
              <p className="text-muted-foreground">
                No dishes recorded for this order.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted text-muted-foreground">
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
                        <td className="px-4 py-3 table-cell-num">{formatCurrency(orderDish.unitPrice)}</td>
                        <td className="px-4 py-3 table-cell-num">{formatCurrency(orderDish.unitPrice * orderDish.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {dishSelections.map((row, index) => (
              <div key={row.internalId} className="flex flex-col sm:flex-row gap-2 sm:gap-4 items-start sm:items-center">
                <select
                  className="select-field"
                  value={row.dishId}
                  onChange={(e) => {
                    const newArr = [...dishSelections]
                    newArr[index] = { ...newArr[index], dishId: e.target.value }
                    applyDishSelections(newArr)
                  }}
                >
                  <option value="" disabled>Select dish...</option>
                  {optionsForRow(row).map(option => (
                    <option key={option.id} value={option.id}>{option.name} ({formatCurrency(option.price)})</option>
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
              <Label htmlFor="totalPrice">Total Price ({getCurrencySymbol()})</Label>
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <h3 className="text-xl font-semibold">{isEditing ? "Extra Ingredients" : "Ingredients Used"}</h3>
          {!isEditing && (
            <Button variant="outline" onClick={() => setIsEditing(true)}>Edit Order Items</Button>
          )}
        </div>

        {!isEditing ? (
          <div className="space-y-3">
            {order.ingredientLogs.length === 0 ? (
              <p className="text-muted-foreground">No ingredients logged for this order.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted text-muted-foreground">
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
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Anything the dishes above don&apos;t cover. These are added on top of the ingredients
              each selected dish already deducts.
            </p>
            {ingredients.map((ingredient, index) => (
              <div key={ingredient.internalId} className="flex flex-col sm:flex-row gap-2 sm:gap-4 items-start sm:items-center">
                <select
                  className="select-field"
                  value={ingredient.id}
                  onChange={(e) => {
                    const newArr = [...ingredients]
                    newArr[index].id = e.target.value
                    setIngredients(newArr)
                  }}
                >
                  <option value="" disabled>Select item…</option>
                  {ingredientOptionsForRow(ingredient).map(inv => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name}{inv.isActive ? '' : ' (archived)'} (Stock: {inv.currentStock} {inv.unit})
                    </option>
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

      {/* Additional Notes Card */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Additional Notes</h3>
          {!isEditingNotes ? (
            <Button variant="ghost" size="sm" onClick={() => setIsEditingNotes(true)}>
              Edit Notes
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => {
                setIsEditingNotes(false)
                setNotesInput(order.notes || '')
              }}>Cancel</Button>
              <Button size="sm" disabled={isSavingNotes} onClick={async () => {
                if (!navigator.onLine) {
                  toast.add({ title: 'Offline', description: 'You are offline. Please reconnect to save notes.', type: 'error' })
                  return
                }
                setIsSavingNotes(true)
                const res = await updateOrderInfo(order.id, order.description, notesInput)
                if (!res.ok) toast.add({ title: 'Error', description: res.error, type: 'error' })
                else {
                  setIsEditingNotes(false)
                  toast.add({ title: 'Success', description: 'Notes saved.', type: 'success' })
                }
                setIsSavingNotes(false)
              }}>
                {isSavingNotes ? "Saving..." : "Save Notes"}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          {!isEditingNotes ? (
            <div>
              {order.notes ? (
                <ul className="list-disc list-inside mt-1 space-y-1">
                  {order.notes.split('\n').filter(line => line.trim() !== '').map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <textarea 
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={notesInput}
                onChange={e => setNotesInput(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

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
                if (!navigator.onLine) {
                  toast.add({ title: 'Offline', description: 'You are offline. Please reconnect to cancel order.', type: 'error' })
                  setCancellingOrder(null)
                  return
                }
                if (!cancellingOrder) return
                try {
                  const result = await updateOrderStatus(cancellingOrder.id, 'CANCELLED')
                  if (!result.ok) {
                    toast.add({ title: 'Error', description: result.error, type: 'error' })
                    return
                  }
                  toast.add({ title: 'Order cancelled', description: `Order #${cancellingOrder.shortId} was cancelled.`, type: 'success' })
                  router.refresh()
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
