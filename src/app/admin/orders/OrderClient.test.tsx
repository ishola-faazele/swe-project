/**
 * Component tests for OrderClient's create-order dialog: dish-row add/remove, total-price
 * auto-recompute via computeDishSubtotal (no useEffect), and archived dishes being excluded from
 * the picker. `createOrder`/`updateOrderStatus`/`deleteOrder` are mocked — the real Server
 * Actions are covered by actions.test.ts.
 *
 * NOTE: the "Create Order" trigger now uses the direct `<Button onClick={...}>` pattern that
 * AGENTS.md prescribes, rather than `<DialogTrigger render={<Button />}>`, which AGENTS.md
 * documents as silently swallowing clicks in a real browser. RTL locates the button by role and
 * accessible name either way, so these tests' behavior is unchanged by that fix.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClientSafeUser } from '@/lib/user'
import type { DishWithRecipe } from '@/lib/recipe'
import { OrderClient } from './OrderClient'
import { createOrder } from './actions'

vi.mock('./actions', () => ({
  createOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  deleteOrder: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const mockCreateOrder = vi.mocked(createOrder)

const customer: ClientSafeUser = {
  id: 'cust-1',
  shortId: 1,
  name: 'Ada',
  email: 'ada@example.com',
  phone: null,
  isActive: true,
  preferredLoginMethod: 'EMAIL',
  notifyByEmail: true,
  alertEmail: null,
  notifyBySms: true,
  alertPhone: null,
  notifyByWhatsapp: true,
  alertWhatsapp: null,
  imageUrl: null,
  notes: null,
  role: 'CUSTOMER',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const jollof: DishWithRecipe = {
  id: 'dish-jollof',
  shortId: 1,
  name: 'Jollof Rice',
  price: 1200,
  servingSize: 1,
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
  servingSize: 1,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ingredients: [],
}

const archivedSpecial: DishWithRecipe = {
  id: 'dish-archived',
  shortId: 3,
  name: 'Retired Special',
  price: 999,
  servingSize: 1,
  isActive: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ingredients: [],
}

const dishes = [jollof, meatPie, archivedSpecial]

function dialogContent() {
  return within(document.querySelector('[data-slot="dialog-content"]') as HTMLElement)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrderClient — create dialog', () => {
  it('is closed until "Create Order" is clicked (open state genuinely toggles)', async () => {
    const user = userEvent.setup()
    render(<OrderClient initialData={[]} customers={[customer]} inventory={[]} dishes={dishes} />)

    expect(screen.queryByText('Create New Order')).not.toBeInTheDocument()

    await user.click(screen.getByText('Create Order'))

    expect(screen.getByText('Create New Order')).toBeInTheDocument()
  })

  it('archived dishes never appear in the dish picker dropdown', async () => {
    const user = userEvent.setup()
    render(<OrderClient initialData={[]} customers={[customer]} inventory={[]} dishes={dishes} />)
    await user.click(screen.getByText('Create Order'))

    await user.click(dialogContent().getByRole('button', { name: 'Add Dish' }))

    const dishSelect = dialogContent().getAllByRole('combobox')[1] // [0] is the customer select
    const optionLabels = within(dishSelect).getAllByRole('option').map((o) => o.textContent)
    expect(optionLabels).toEqual(
      expect.arrayContaining(['Jollof Rice (GH₵1,200.00)', 'Meat Pie (GH₵350.00)'])
    )
    expect(optionLabels.join(' ')).not.toContain('Retired Special')
  })

  it('adds and removes dish rows', async () => {
    const user = userEvent.setup()
    render(<OrderClient initialData={[]} customers={[customer]} inventory={[]} dishes={dishes} />)
    await user.click(screen.getByText('Create Order'))
    const dialog = dialogContent()

    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    expect(dialog.getAllByPlaceholderText('Qty')).toHaveLength(1)

    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    expect(dialog.getAllByPlaceholderText('Qty')).toHaveLength(2)

    await user.click(dialog.getAllByRole('button', { name: 'Remove dish' })[0])
    expect(dialog.getAllByPlaceholderText('Qty')).toHaveLength(1)
  })

  it('recomputes totalPrice via computeDishSubtotal whenever a dish row or quantity changes, in the same handler', async () => {
    const user = userEvent.setup()
    render(<OrderClient initialData={[]} customers={[customer]} inventory={[]} dishes={dishes} />)
    await user.click(screen.getByText('Create Order'))
    const dialog = dialogContent()
    const totalPriceInput = dialog.getByLabelText('Total Price (GH₵)') as HTMLInputElement

    expect(totalPriceInput.value).toBe('')

    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    const dishSelect = dialog.getAllByRole('combobox')[1]
    await user.selectOptions(dishSelect, jollof.id)
    // Default quantity on a freshly-added row is 1 -> subtotal = 1200 * 1.
    expect(totalPriceInput.value).toBe('1200')

    await user.clear(dialog.getByPlaceholderText('Qty'))
    await user.type(dialog.getByPlaceholderText('Qty'), '3')
    expect(totalPriceInput.value).toBe('3600')

    // Adding a second dish recomputes the combined subtotal.
    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    const secondDishSelect = dialog.getAllByRole('combobox')[2]
    await user.selectOptions(secondDishSelect, meatPie.id)
    expect(totalPriceInput.value).toBe(String(3600 + 350))
  })

  it('typing directly into totalPrice overrides the derived value until the next dish-row change', async () => {
    const user = userEvent.setup()
    render(<OrderClient initialData={[]} customers={[customer]} inventory={[]} dishes={dishes} />)
    await user.click(screen.getByText('Create Order'))
    const dialog = dialogContent()

    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    await user.selectOptions(dialog.getAllByRole('combobox')[1], jollof.id)
    const totalPriceInput = dialog.getByLabelText('Total Price (GH₵)') as HTMLInputElement
    expect(totalPriceInput.value).toBe('1200')

    await user.clear(totalPriceInput)
    await user.type(totalPriceInput, '5000')
    expect(totalPriceInput.value).toBe('5000') // manual override sticks

    // Next dish-row change resets it to the derived value again.
    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    await user.selectOptions(dialog.getAllByRole('combobox')[2], meatPie.id)
    expect(totalPriceInput.value).toBe(String(1200 + 350))
  })

  it('submitting calls createOrder with only rows that have a dish selected and a positive quantity', async () => {
    const user = userEvent.setup()
    // createOrder returns ActionResult<Order>, not a bare Order. Mocking the
    // bare row left `result.ok` undefined, so the component took its error
    // branch and the optimistic-update path was never actually exercised.
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: {
        id: 'order-new',
        shortId: 9,
        customerId: customer.id,
        description: '',
        notes: null,
        status: 'PENDING',
        totalPrice: 1200,
        dueDate: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    })
    render(<OrderClient initialData={[]} customers={[customer]} inventory={[]} dishes={dishes} />)
    await user.click(screen.getByText('Create Order'))
    const dialog = dialogContent()

    await user.selectOptions(dialog.getAllByRole('combobox')[0], customer.id)
    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))
    await user.selectOptions(dialog.getAllByRole('combobox')[1], jollof.id)
    // A second, never-selected row should be filtered out of the submitted payload.
    await user.click(dialog.getByRole('button', { name: 'Add Dish' }))

    await user.click(dialog.getByRole('button', { name: /create order & deduct inventory/i }))

    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: customer.id,
        dishes: [{ dishId: jollof.id, quantity: 1 }],
      })
    )
  })
})
