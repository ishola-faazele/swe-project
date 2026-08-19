/**
 * Component tests for MenuClient — the dish catalog table, create/edit dialogs, and the recipe
 * builder. `createDish`/`updateDish`/`deleteDish`/`toggleDishActive` are mocked (this is the
 * component layer, not integration — the real Server Actions are covered by actions.test.ts).
 *
 * The "+ Add Dish" trigger uses the codebase's correct `onClick={() => setIsOpen(true)}` pattern
 * (see AGENTS.md's Dialog Triggers section), not the broken `DialogTrigger render={<Button />}`
 * pattern used elsewhere — this suite's dialog-opens assertions double as a permanent regression
 * check that the correct pattern keeps working.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Dish, DishIngredient, InventoryItem } from '@prisma/client'
import { MenuClient } from './MenuClient'
import { createDish, updateDish, deleteDish, toggleDishActive } from './actions'

vi.mock('./actions', () => ({
  createDish: vi.fn(),
  updateDish: vi.fn(),
  deleteDish: vi.fn(),
  toggleDishActive: vi.fn(),
}))

const mockCreateDish = vi.mocked(createDish)
const mockUpdateDish = vi.mocked(updateDish)
const mockDeleteDish = vi.mocked(deleteDish)
const mockToggleDishActive = vi.mocked(toggleDishActive)

type DishWithIngredients = Dish & { ingredients: (DishIngredient & { inventoryItem: InventoryItem })[] }

const rice: InventoryItem = {
  id: 'inv-rice',
  name: 'Long Grain Rice',
  category: 'INGREDIENT',
  unit: 'kg',
  currentStock: 80,
  minimumThreshold: 15,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const chicken: InventoryItem = {
  id: 'inv-chicken',
  name: 'Chicken',
  category: 'INGREDIENT',
  unit: 'kg',
  currentStock: 40,
  minimumThreshold: 10,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

function makeDish(overrides: Partial<DishWithIngredients> & { id: string; shortId: number }): DishWithIngredients {
  return {
    name: 'Jollof Rice',
    price: 1200,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ingredients: [],
    ...overrides,
  }
}

const activeDish = makeDish({
  id: 'dish-active',
  shortId: 1,
  name: 'Jollof Rice',
  price: 1200,
  ingredients: [
    { id: 'di-1', dishId: 'dish-active', inventoryItemId: rice.id, quantityPerDish: 0.25, createdAt: new Date('2026-01-01'), inventoryItem: rice },
  ],
})

const archivedDish = makeDish({
  id: 'dish-archived',
  shortId: 2,
  name: 'Discontinued Special',
  price: 800,
  isActive: false,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MenuClient — table', () => {
  it('renders a row per dish with shortId, name, price, recipe summary, and status badge', () => {
    render(<MenuClient initialData={[activeDish, archivedDish]} inventory={[rice, chicken]} />)

    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('Jollof Rice')).toBeInTheDocument()
    expect(screen.getByText('GH₵1,200.00')).toBeInTheDocument()
    expect(screen.getByText(/Long Grain Rice 0.25kg/)).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()

    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('Discontinued Special')).toBeInTheDocument()
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
    expect(screen.getByText('No recipe')).toBeInTheDocument()
  })

  it('renders the empty state when initialData is empty', () => {
    render(<MenuClient initialData={[]} inventory={[]} />)
    expect(screen.getByText('No dishes yet')).toBeInTheDocument()
  })
})

describe('MenuClient — create dialog', () => {
  it('is closed until "+ Add Dish" is clicked, via onClick={() => setIsOpen(true)}', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[]} inventory={[rice]} />)

    expect(screen.queryByRole('heading', { name: 'Add Dish' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add dish/i }))

    expect(screen.getByRole('heading', { name: 'Add Dish' })).toBeInTheDocument()
  })

  it('recipe builder: "Add Ingredient" adds a row, remove button removes it', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[]} inventory={[rice, chicken]} />)
    await user.click(screen.getByRole('button', { name: /add dish/i }))

    expect(screen.getByText(/No ingredients yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Ingredient' }))
    expect(screen.getAllByPlaceholderText('Qty')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Add Ingredient' }))
    expect(screen.getAllByPlaceholderText('Qty')).toHaveLength(2)

    await user.click(screen.getAllByRole('button', { name: 'Remove ingredient' })[0])
    expect(screen.getAllByPlaceholderText('Qty')).toHaveLength(1)
  })

  it('submitting calls createDish with deduped ingredients and optimistically appends the result', async () => {
    const user = userEvent.setup()
    mockCreateDish.mockResolvedValue({
      id: 'dish-new',
      shortId: 3,
      name: 'Fried Rice',
      price: 1300,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    })

    render(<MenuClient initialData={[]} inventory={[rice]} />)
    await user.click(screen.getByRole('button', { name: /add dish/i }))

    await user.type(screen.getByLabelText('Dish Name'), 'Fried Rice')
    await user.type(screen.getByLabelText('Price (GH₵)'), '1300')
    await user.click(screen.getByRole('button', { name: 'Add Ingredient' }))
    await user.selectOptions(screen.getByRole('combobox'), rice.id)
    await user.type(screen.getByPlaceholderText('Qty'), '0.25')

    await user.click(screen.getByRole('button', { name: 'Save Dish' }))

    expect(mockCreateDish).toHaveBeenCalledWith({
      name: 'Fried Rice',
      price: 1300,
      ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }],
    })
    // Dialog closes and the new row appears optimistically.
    expect(screen.queryByRole('heading', { name: 'Add Dish' })).not.toBeInTheDocument()
    expect(await screen.findByText('Fried Rice')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
  })
})

describe('MenuClient — edit dialog', () => {
  it('opens pre-filled with the selected dish\'s current name/price/recipe', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice, chicken]} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('heading', { name: 'Edit Dish #1' })).toBeInTheDocument()
    expect(screen.getByLabelText('Dish Name')).toHaveValue('Jollof Rice')
    expect(screen.getByLabelText('Price (GH₵)')).toHaveValue(1200)
    expect(screen.getByRole('combobox')).toHaveValue(rice.id)
    expect(screen.getByPlaceholderText('Qty')).toHaveValue(0.25)
  })

  it('saving calls updateDish and updates the row in local table state without a full reload', async () => {
    const user = userEvent.setup()
    mockUpdateDish.mockResolvedValue({ ...activeDish, name: 'Jollof Rice (Large)', price: 1500 })
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const nameInput = screen.getByLabelText('Dish Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Jollof Rice (Large)')
    const priceInput = screen.getByLabelText('Price (GH₵)')
    await user.clear(priceInput)
    await user.type(priceInput, '1500')

    await user.click(screen.getByRole('button', { name: 'Update Dish' }))

    expect(mockUpdateDish).toHaveBeenCalledWith(
      'dish-active',
      expect.objectContaining({ name: 'Jollof Rice (Large)', price: 1500 })
    )
    expect(await screen.findByText('Jollof Rice (Large)')).toBeInTheDocument()
    expect(screen.getByText('GH₵1,500.00')).toBeInTheDocument()
  })
})

/**
 * FE-022. getInventoryItems() is active-only by default, so an archived ingredient is absent
 * from the `inventory` prop. A recipe row that already references one must still resolve its
 * real name and unit — reinjected from the dish's own ingredients join.
 */
describe('MenuClient — archived ingredient reinjection (recipe builder)', () => {
  // Rice is deliberately NOT in the `inventory` prop below, standing in for an item archived
  // after this dish's recipe was written.
  const dishWithArchivedIngredient = makeDish({
    id: 'dish-legacy',
    shortId: 7,
    name: 'Legacy Jollof',
    price: 1000,
    ingredients: [
      {
        id: 'di-legacy',
        dishId: 'dish-legacy',
        inventoryItemId: rice.id,
        quantityPerDish: 0.3,
        createdAt: new Date('2026-01-01'),
        inventoryItem: { ...rice, isActive: false },
      },
    ],
  })

  it('keeps the archived ingredient selectable, named, and unit-labelled when editing', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[dishWithArchivedIngredient]} inventory={[chicken]} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    const select = screen.getByRole('combobox')
    // Without reinjection the <select> would hold an unmatched value and fall back to the
    // first option (chicken), silently rewriting the recipe on the next save.
    expect(select).toHaveValue(rice.id)
    expect(screen.getByRole('option', { name: 'Long Grain Rice (archived) (kg)' })).toBeInTheDocument()
    // The unit label beside the row reads through the same reinjected option.
    expect(screen.getByText('kg')).toBeInTheDocument()
  })

  it('does not offer archived items on a brand-new recipe row', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[dishWithArchivedIngredient]} inventory={[chicken]} />)

    await user.click(screen.getByRole('button', { name: /add dish/i }))
    await user.click(screen.getByRole('button', { name: 'Add Ingredient' }))

    expect(screen.getByRole('option', { name: 'Chicken (kg)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /archived/ })).not.toBeInTheDocument()
  })

  it('does not crash the recipe column when saving a dish that keeps an archived ingredient', async () => {
    const user = userEvent.setup()
    mockUpdateDish.mockResolvedValue({ ...dishWithArchivedIngredient, name: 'Legacy Jollof II' })
    render(<MenuClient initialData={[dishWithArchivedIngredient]} inventory={[chicken]} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const nameInput = screen.getByLabelText('Dish Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Legacy Jollof II')

    await user.click(screen.getByRole('button', { name: 'Update Dish' }))

    // buildIngredients used to resolve this row via `inventory.find(...)!` and hand the RECIPE
    // column an undefined inventoryItem, throwing on `.name` during the optimistic re-render.
    expect(await screen.findByText('Legacy Jollof II')).toBeInTheDocument()
    expect(screen.getByText(/Long Grain Rice 0.3kg/)).toBeInTheDocument()
  })
})

describe('MenuClient — archive/restore', () => {
  it('archive toggle calls toggleDishActive(id, false) and flips the badge to ARCHIVED', async () => {
    const user = userEvent.setup()
    mockToggleDishActive.mockResolvedValue({ ...activeDish, isActive: false })
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(mockToggleDishActive).toHaveBeenCalledWith('dish-active', false)
    expect(await screen.findByText('ARCHIVED')).toBeInTheDocument()
  })

  it('restore toggle calls toggleDishActive(id, true) and flips the badge back to ACTIVE', async () => {
    const user = userEvent.setup()
    mockToggleDishActive.mockResolvedValue({ ...archivedDish, isActive: true })
    render(<MenuClient initialData={[archivedDish]} inventory={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(mockToggleDishActive).toHaveBeenCalledWith('dish-archived', true)
    expect(await screen.findByText('ACTIVE')).toBeInTheDocument()
  })
})

describe('MenuClient — delete', () => {
  it('is gated behind confirmation: declining leaves deleteDish uncalled', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockDeleteDish).not.toHaveBeenCalled()
    expect(screen.getByText('Jollof Rice')).toBeInTheDocument()
  })

  it('{ archived: false } removes the row from the table entirely', async () => {
    mockDeleteDish.mockResolvedValue({ archived: false })
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByRole('button', { name: /delete/i }))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByText('No dishes yet')).toBeInTheDocument()
  })

  it('{ archived: true } keeps the row but flips its badge to ARCHIVED', async () => {
    mockDeleteDish.mockResolvedValue({ archived: true })
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByRole('button', { name: /delete/i }))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByText('ARCHIVED')).toBeInTheDocument()
    expect(screen.getByText('Jollof Rice')).toBeInTheDocument()
  })
})
