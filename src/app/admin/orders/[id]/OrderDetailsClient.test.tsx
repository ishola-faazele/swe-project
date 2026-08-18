/**
 * Component tests for OrderDetailsClient's "Dishes Ordered" section — the inline (non-Dialog)
 * edit UX for an order's dish line items. `updateOrderItems`/`updateOrderStatus` are mocked (the
 * real Server Action is covered by [id]/actions.test.ts).
 *
 * This file is where INFRA-002 checklist items 6 and 7 — verified only by code inspection during
 * the manual verification pass, never click-tested — get asserted permanently:
 *   - item 6: a legacy order with order.dishes.length === 0 renders the graceful empty state.
 *   - item 7: an OrderDish row whose dish was archived after the order was placed still renders a
 *     valid, non-blank, already-selected option in that row's dropdown (optionsForRow()).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Order, User, InventoryItem, OrderIngredientLog, OrderDish } from '@prisma/client'
import type { DishWithRecipe } from '@/lib/recipe'
import { OrderDetailsClient } from './OrderDetailsClient'
import { updateOrderItems } from './actions'

vi.mock('./actions', () => ({ updateOrderItems: vi.fn(), updateOrderDueDate: vi.fn() }))
vi.mock('../actions', () => ({ updateOrderStatus: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const mockUpdateOrderItems = vi.mocked(updateOrderItems)

const customer: User = {
  id: 'cust-1',
  shortId: 1,
  name: 'Ada',
  email: 'ada@example.com',
  phone: null,
  role: 'CUSTOMER',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const rice: InventoryItem = {
  id: 'inv-rice',
  name: 'Long Grain Rice',
  category: 'INGREDIENT',
  unit: 'kg',
  currentStock: 80,
  minimumThreshold: 15,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const jollof: DishWithRecipe = {
  id: 'dish-jollof',
  shortId: 1,
  name: 'Jollof Rice',
  price: 1200,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ingredients: [],
}

const meatPie: DishWithRecipe = {
  id: 'dish-meatpie',
  shortId: 2,
  name: 'Meat Pie',
  price: 350,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ingredients: [],
}

function baseOrder(overrides: Partial<Order & { dishes: OrderDish[]; ingredientLogs: (OrderIngredientLog & { inventoryItem: InventoryItem })[] }> = {}) {
  return {
    id: 'order-1',
    shortId: 42,
    customerId: customer.id,
    customer,
    description: 'test order',
    status: 'PENDING' as const,
    totalPrice: 1200,
    dueDate: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ingredientLogs: [],
    dishes: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrderDetailsClient — read-only "Dishes Ordered" section', () => {
  it('item 6: a legacy order with dishes.length === 0 renders the graceful empty state, not a blank/crashing section', () => {
    const order = baseOrder({ dishes: [] })
    render(<OrderDetailsClient order={order} inventory={[]} dishes={[jollof, meatPie]} />)

    expect(
      screen.getByText(/No dishes recorded for this order — it was placed before the menu existed/)
    ).toBeInTheDocument()
  })

  it('renders "{quantity}× {dishName}" rows sourced from order.dishes', () => {
    const order = baseOrder({
      dishes: [
        { id: 'od-1', orderId: 'order-1', dishId: jollof.id, dishName: jollof.name, unitPrice: jollof.price, quantity: 2, createdAt: new Date('2026-01-01') },
      ],
    })
    render(<OrderDetailsClient order={order} inventory={[]} dishes={[jollof, meatPie]} />)

    expect(screen.getByText('2× Jollof Rice')).toBeInTheDocument()
  })
})

describe('OrderDetailsClient — edit mode', () => {
  it('item 7: an OrderDish row referencing a dish archived after the order was placed still renders a valid, non-blank, selected option', async () => {
    const user = userEvent.setup()
    // "archived-after-order" is NOT in the `dishes` catalog prop (simulating archival — the
    // active-dish list no longer contains it), but the order's own OrderDish snapshot does.
    const order = baseOrder({
      dishes: [
        {
          id: 'od-1',
          orderId: 'order-1',
          dishId: 'dish-retired',
          dishName: 'Retired Special',
          unitPrice: 999,
          quantity: 1,
          createdAt: new Date('2026-01-01'),
        },
      ],
    })
    render(<OrderDetailsClient order={order} inventory={[]} dishes={[jollof, meatPie]} />)

    await user.click(screen.getAllByRole('button', { name: 'Edit Order Items' })[0])

    // [0] is the order-status select; the dish-row select is the second combobox on the page.
    const rowSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement
    // Selected value is preserved (not blank/reset).
    expect(rowSelect.value).toBe('dish-retired')
    // A synthetic, clearly-labeled option exists for it — catalog -> snapshot -> "Unknown dish"
    // fallback; here the snapshot's dishName ("Retired Special") is used since the dish is gone
    // from the `dishes` catalog prop entirely.
    const selectedOption = within(rowSelect).getByRole('option', { name: /Retired Special \(archived\)/ })
    expect(selectedOption).toBeInTheDocument()
    expect((selectedOption as HTMLOptionElement).value).toBe('dish-retired')
  })

  it('add/remove dish rows in edit mode', async () => {
    const user = userEvent.setup()
    const order = baseOrder({ dishes: [] })
    render(<OrderDetailsClient order={order} inventory={[]} dishes={[jollof, meatPie]} />)
    await user.click(screen.getAllByRole('button', { name: 'Edit Order Items' })[0])

    expect(screen.queryAllByPlaceholderText('Qty')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '+ Add Dish' }))
    expect(screen.getAllByPlaceholderText('Qty')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryAllByPlaceholderText('Qty')).toHaveLength(0)
  })

  it('recomputes total price via computeDishSubtotal when a dish row changes', async () => {
    const user = userEvent.setup()
    const order = baseOrder({ dishes: [], totalPrice: 0 })
    render(<OrderDetailsClient order={order} inventory={[]} dishes={[jollof, meatPie]} />)
    await user.click(screen.getAllByRole('button', { name: 'Edit Order Items' })[0])

    await user.click(screen.getByRole('button', { name: '+ Add Dish' }))
    // [0] is the order-status select; the dish-row select is the second combobox on the page.
    const select = screen.getAllByRole('combobox')[1]
    await user.selectOptions(select, jollof.id)

    const totalPriceInput = screen.getByLabelText('Total Price (₦)') as HTMLInputElement
    expect(totalPriceInput.value).toBe('1200') // default qty 1 * price 1200
  })

  it('Save calls updateOrderItems with merged dishes + extraIngredients + totalPrice', async () => {
    const user = userEvent.setup()
    const order = baseOrder({
      dishes: [
        { id: 'od-1', orderId: 'order-1', dishId: jollof.id, dishName: jollof.name, unitPrice: jollof.price, quantity: 1, createdAt: new Date('2026-01-01') },
      ],
      totalPrice: 1200,
    })
    render(<OrderDetailsClient order={order} inventory={[rice]} dishes={[jollof, meatPie]} />)
    await user.click(screen.getAllByRole('button', { name: 'Edit Order Items' })[0])

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(mockUpdateOrderItems).toHaveBeenCalledWith('order-1', {
      dishes: [{ dishId: jollof.id, quantity: 1 }],
      extraIngredients: [],
      totalPrice: 1200,
    })
  })

  it('Cancel resets to the original DB state without calling updateOrderItems', async () => {
    const user = userEvent.setup()
    const order = baseOrder({ dishes: [] })
    render(<OrderDetailsClient order={order} inventory={[]} dishes={[jollof, meatPie]} />)
    await user.click(screen.getAllByRole('button', { name: 'Edit Order Items' })[0])
    await user.click(screen.getByRole('button', { name: '+ Add Dish' }))
    expect(screen.getAllByPlaceholderText('Qty')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockUpdateOrderItems).not.toHaveBeenCalled()
    // Back to read-only view showing the (empty) DB state.
    expect(
      screen.getByText(/No dishes recorded for this order/)
    ).toBeInTheDocument()
  })
})
