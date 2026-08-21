/**
 * Component tests for MenuClient — the dish card gallery and its create modal.
 *
 * Editing (name/price/recipe) and media management (photos/video) both moved to the dedicated
 * `/admin/menu/[id]` detail page (see DishDetailsClient.tsx) — this file no longer covers an edit
 * dialog at all, only the gallery + create flow. `createDish`/`deleteDish`/`toggleDishActive` are
 * mocked (component layer, not integration — the real Server Actions are covered by actions.test.ts).
 *
 * The "+ Add Dish" trigger uses the codebase's correct `onClick={() => setIsOpen(true)}` pattern
 * (see AGENTS.md's Dialog Triggers section), not the broken `DialogTrigger render={<Button />}`
 * pattern used elsewhere — this suite's dialog-opens assertion doubles as a permanent regression
 * check that the correct pattern keeps working.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Dish, DishIngredient, DishMedia, InventoryItem } from '@prisma/client'
import { MenuClient } from './MenuClient'
import { createDish, deleteDish, toggleDishActive } from './actions'
import type { DishWithMedia } from './RecipeBuilder'

vi.mock('./actions', () => ({
  createDish: vi.fn(),
  deleteDish: vi.fn(),
  toggleDishActive: vi.fn(),
}))

const mockCreateDish = vi.mocked(createDish)
const mockDeleteDish = vi.mocked(deleteDish)
const mockToggleDishActive = vi.mocked(toggleDishActive)

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

function media(overrides: Partial<DishMedia> & { id: string; dishId: string }): DishMedia {
  return {
    url: 'https://cdn.example.com/x.jpg',
    type: 'IMAGE',
    position: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function makeDish(overrides: Partial<DishWithMedia> & { id: string; shortId: number }): DishWithMedia {
  return {
    name: 'Jollof Rice',
    price: 1200,
    servingSize: 1,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ingredients: [],
    media: [],
    ...overrides,
  }
}

const activeDish = makeDish({
  id: 'dish-active',
  shortId: 1,
  name: 'Jollof Rice',
  price: 1200,
  servingSize: 2,
  ingredients: [
    { id: 'di-1', dishId: 'dish-active', inventoryItemId: rice.id, quantityPerDish: 0.25, createdAt: new Date('2026-01-01'), inventoryItem: rice } as DishIngredient & { inventoryItem: InventoryItem },
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

describe('MenuClient — card gallery', () => {
  it('renders a card per dish with shortId, name, price, serving size, and status badge', () => {
    render(<MenuClient initialData={[activeDish, archivedDish]} inventory={[rice, chicken]} />)

    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('Jollof Rice')).toBeInTheDocument()
    expect(screen.getByText('GH₵1,200.00')).toBeInTheDocument()
    expect(screen.getByText('Recipe serves 2')).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()

    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('Discontinued Special')).toBeInTheDocument()
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('renders the empty state when initialData is empty', () => {
    render(<MenuClient initialData={[]} inventory={[]} />)
    expect(screen.getByText('No dishes yet')).toBeInTheDocument()
  })

  it('renders the cover image when the dish has a media item of type IMAGE', () => {
    const withPhoto = makeDish({
      id: 'dish-photo',
      shortId: 9,
      name: 'Photographed Dish',
      media: [media({ id: 'm1', dishId: 'dish-photo', url: 'https://cdn.example.com/dishes/photo.jpg', type: 'IMAGE' })],
    })
    const { container } = render(<MenuClient initialData={[withPhoto]} inventory={[]} />)

    const img = container.querySelector('img[src="https://cdn.example.com/dishes/photo.jpg"]')
    expect(img).not.toBeNull()
  })

  it('renders the muted placeholder (not a broken <img>) when the dish has no media', () => {
    const noPhoto = makeDish({ id: 'dish-no-photo', shortId: 10, name: 'Plain Dish', media: [] })
    const { container } = render(<MenuClient initialData={[noPhoto]} inventory={[]} />)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(container.querySelector('.lucide-utensils-crossed')).not.toBeNull()
  })

  it('shows a video badge when the dish has a VIDEO media item, even with no IMAGE cover', () => {
    const videoOnly = makeDish({
      id: 'dish-video',
      shortId: 12,
      name: 'Video Only Dish',
      media: [media({ id: 'm2', dishId: 'dish-video', url: 'https://cdn.example.com/dishes/clip.mp4', type: 'VIDEO' })],
    })
    const { container } = render(<MenuClient initialData={[videoOnly]} inventory={[]} />)

    expect(screen.getByText('Video')).toBeInTheDocument()
    // No cover — a video has no poster frame here, so the placeholder still renders.
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('search filters the grid down to matching dish names', async () => {
    const user = userEvent.setup()
    const { container } = render(<MenuClient initialData={[activeDish, archivedDish]} inventory={[]} />)

    await user.type(screen.getByPlaceholderText('Search menu...'), 'Discontinued')

    // HighlightText splits the matched substring into its own <mark>, so the name is no longer a
    // single text node — assert on the container's full text content instead of a single getByText.
    expect(container.textContent).toContain('Discontinued Special')
    expect(container.textContent).not.toContain('Jollof Rice')
  })

  it('links "Edit" to the dish detail page instead of opening a dialog', () => {
    render(<MenuClient initialData={[activeDish]} inventory={[]} />)

    const editLink = screen.getByTitle('Edit dish')
    expect(editLink.tagName).toBe('A')
    expect(editLink).toHaveAttribute('href', '/admin/menu/dish-active')
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

  it('has name/price/servingSize/recipe fields, and no media upload control — media is added from the dish\'s own page', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[]} inventory={[rice]} />)
    await user.click(screen.getByRole('button', { name: /add dish/i }))

    expect(screen.getByLabelText('Dish Name')).toBeInTheDocument()
    expect(screen.getByLabelText(/Price/)).toBeInTheDocument()
    expect(screen.getByLabelText('Recipe Serves')).toBeInTheDocument()
    expect(screen.queryByLabelText('Photo')).not.toBeInTheDocument()
    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument()
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

  it('does not offer an archived ingredient on a brand-new recipe row', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[]} inventory={[chicken]} />)

    await user.click(screen.getByRole('button', { name: /add dish/i }))
    await user.click(screen.getByRole('button', { name: 'Add Ingredient' }))

    expect(screen.getByRole('option', { name: 'Chicken (kg)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /archived/ })).not.toBeInTheDocument()
  })

  it('submitting calls createDish with deduped ingredients and NO imageUrl, then optimistically appends the result with an empty media array', async () => {
    const user = userEvent.setup()
    mockCreateDish.mockResolvedValue({
      ok: true,
      data: {
        id: 'dish-new',
        shortId: 3,
        name: 'Fried Rice',
        price: 1300,
        servingSize: 1,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      } as Dish,
    })

    render(<MenuClient initialData={[]} inventory={[rice]} />)
    await user.click(screen.getByRole('button', { name: /add dish/i }))

    await user.type(screen.getByLabelText('Dish Name'), 'Fried Rice')
    await user.type(screen.getByLabelText(/Price/), '1300')
    await user.click(screen.getByRole('button', { name: 'Add Ingredient' }))
    await user.selectOptions(screen.getByRole('combobox'), rice.id)
    await user.type(screen.getByPlaceholderText('Qty'), '0.25')

    await user.click(screen.getByRole('button', { name: 'Save Dish' }))

    expect(mockCreateDish).toHaveBeenCalledWith({
      name: 'Fried Rice',
      price: 1300,
      servingSize: 1,
      ingredients: [{ inventoryItemId: rice.id, quantityPerDish: 0.25 }],
    })
    expect(mockCreateDish.mock.calls[0][0]).not.toHaveProperty('imageUrl')
    expect(screen.queryByRole('heading', { name: 'Add Dish' })).not.toBeInTheDocument()
    expect(await screen.findByText('Fried Rice')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
  })
})

describe('MenuClient — archive/restore', () => {
  it('archive toggle calls toggleDishActive(id, false) and flips the badge to ARCHIVED', async () => {
    const user = userEvent.setup()
    mockToggleDishActive.mockResolvedValue({ ...activeDish, isActive: false })
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByTitle('Archive dish'))

    expect(mockToggleDishActive).toHaveBeenCalledWith('dish-active', false)
    expect(await screen.findByText('ARCHIVED')).toBeInTheDocument()
  })

  it('restore toggle calls toggleDishActive(id, true) and flips the badge back to ACTIVE', async () => {
    const user = userEvent.setup()
    mockToggleDishActive.mockResolvedValue({ ...archivedDish, isActive: true })
    render(<MenuClient initialData={[archivedDish]} inventory={[rice]} />)

    await user.click(screen.getByTitle('Restore dish'))

    expect(mockToggleDishActive).toHaveBeenCalledWith('dish-archived', true)
    expect(await screen.findByText('ACTIVE')).toBeInTheDocument()
  })
})

describe('MenuClient — delete', () => {
  it('is gated behind confirmation: declining leaves deleteDish uncalled', async () => {
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByTitle('Delete dish'))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockDeleteDish).not.toHaveBeenCalled()
    expect(screen.getByText('Jollof Rice')).toBeInTheDocument()
  })

  it('{ archived: false } removes the card from the gallery entirely', async () => {
    mockDeleteDish.mockResolvedValue({ archived: false })
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByTitle('Delete dish'))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByText('No dishes yet')).toBeInTheDocument()
  })

  it('{ archived: true } keeps the card but flips its badge to ARCHIVED, since it is referenced by past orders', async () => {
    mockDeleteDish.mockResolvedValue({ archived: true })
    const user = userEvent.setup()
    render(<MenuClient initialData={[activeDish]} inventory={[rice]} />)

    await user.click(screen.getByTitle('Delete dish'))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByText('ARCHIVED')).toBeInTheDocument()
    expect(screen.getByText('Jollof Rice')).toBeInTheDocument()
  })
})
