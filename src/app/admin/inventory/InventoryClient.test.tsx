/**
 * Component tests for InventoryClient's archive/restore behavior (item 7, FE-031).
 *
 * `deleteInventoryItem`/`toggleInventoryItemActive`/`createInventoryItem` are mocked — this is
 * the component layer. The real Server Actions, including the two-table FK check that decides
 * archive-vs-hard-delete, are covered by tests/integration/fk-guarded-deletes.integration.test.ts.
 *
 * jsdom implements neither window.confirm nor window.alert, and every destructive path here goes
 * through both, so both are stubbed in beforeEach.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InventoryItem } from '@prisma/client'
import { InventoryClient } from './InventoryClient'
import { deleteInventoryItem, toggleInventoryItemActive } from './actions'
import { toast } from '@/components/ui/toast'

vi.mock('@/components/ui/toast', () => ({
  toast: {
    add: vi.fn(),
  },
}))

vi.mock('./actions', () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  toggleInventoryItemActive: vi.fn(),
}))

const mockDeleteInventoryItem = vi.mocked(deleteInventoryItem)
const mockToggleInventoryItemActive = vi.mocked(toggleInventoryItemActive)
const mockToastAdd = vi.mocked(toast.add)

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'inv-rice',
    name: 'Long Grain Rice',
    category: 'INGREDIENT',
    unit: 'kg',
    currentStock: 80,
    minimumThreshold: 15,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

const rice = makeItem()
const retiredPalmOil = makeItem({
  id: 'inv-palm',
  name: 'Palm Oil',
  currentStock: 0,
  minimumThreshold: 5,
  isActive: false,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InventoryClient — archived visibility', () => {
  it('hides archived items behind the reveal toggle by default', () => {
    render(<InventoryClient initialData={[rice, retiredPalmOil]} />)

    expect(screen.getByText('Long Grain Rice')).toBeInTheDocument()
    expect(screen.queryByText('Palm Oil')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show archived \(1\)/i })).toBeInTheDocument()
  })

  it('reveals archived items, badged and labelled, when the toggle is pressed', async () => {
    const user = userEvent.setup()
    render(<InventoryClient initialData={[rice, retiredPalmOil]} />)

    await user.click(screen.getByRole('button', { name: /show archived \(1\)/i }))

    expect(screen.getByText('Palm Oil')).toBeInTheDocument()
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hide archived/i })).toBeInTheDocument()
  })

  it('omits the toggle entirely when nothing is archived', () => {
    render(<InventoryClient initialData={[rice]} />)
    expect(screen.queryByRole('button', { name: /show archived/i })).not.toBeInTheDocument()
  })

  it('excludes archived items from the low-stock restock banner', () => {
    // Palm Oil is at 0 against a threshold of 5 — it would qualify as low stock if the banner
    // counted archived rows, which the page now supplies for the reveal toggle.
    render(<InventoryClient initialData={[rice, retiredPalmOil]} />)
    expect(screen.queryByText(/needs? restocking/i)).not.toBeInTheDocument()
  })

  it('distinguishes "nothing yet" from "everything is archived"', () => {
    const { unmount } = render(<InventoryClient initialData={[]} />)
    expect(screen.getByText('No inventory items yet')).toBeInTheDocument()
    unmount()

    render(<InventoryClient initialData={[retiredPalmOil]} />)
    expect(screen.getByText('Every item is archived')).toBeInTheDocument()
  })
})

describe('InventoryClient — delete vs archive', () => {
  it('archives in place, and explains why, when the item is still referenced', async () => {
    const user = userEvent.setup()
    mockDeleteInventoryItem.mockResolvedValue({ ok: true, data: { archived: true } })
    render(<InventoryClient initialData={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(mockDeleteInventoryItem).toHaveBeenCalledWith(rice.id)
    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Item archived',
      description: expect.stringContaining('archived instead of deleted')
    }))

    // Still present in `data` — hidden by the default filter, not dropped from state.
    expect(screen.queryByText('Long Grain Rice')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show archived \(1\)/i }))
    expect(screen.getByText('Long Grain Rice')).toBeInTheDocument()
  })

  it('removes the row outright when the item was genuinely hard-deleted', async () => {
    const user = userEvent.setup()
    mockDeleteInventoryItem.mockResolvedValue({ ok: true, data: { archived: false } })
    render(<InventoryClient initialData={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(screen.queryByText('Long Grain Rice')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show archived/i })).not.toBeInTheDocument()
    expect(screen.getByText('No inventory items yet')).toBeInTheDocument()
  })

  it('surfaces a failed delete and leaves the row untouched', async () => {
    const user = userEvent.setup()
    mockDeleteInventoryItem.mockResolvedValue({ ok: false, error: 'Nope.', code: 'UNKNOWN' })
    render(<InventoryClient initialData={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ description: 'Nope.', type: 'error' }))
    expect(screen.getByText('Long Grain Rice')).toBeInTheDocument()
  })

  it('does not call the action at all when the confirm is dismissed', async () => {
    const user = userEvent.setup()
    render(<InventoryClient initialData={[rice]} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockDeleteInventoryItem).not.toHaveBeenCalled()
  })
})

describe('InventoryClient — manual archive/restore', () => {
  it('archives an active item, hiding it from the default view', async () => {
    const user = userEvent.setup()
    mockToggleInventoryItemActive.mockResolvedValue({
      ok: true,
      data: { ...rice, isActive: false },
    })
    render(<InventoryClient initialData={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(mockToggleInventoryItemActive).toHaveBeenCalledWith(rice.id, false)
    expect(screen.queryByText('Long Grain Rice')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show archived \(1\)/i })).toBeInTheDocument()
  })

  it('restores an archived item back into the default view', async () => {
    const user = userEvent.setup()
    mockToggleInventoryItemActive.mockResolvedValue({
      ok: true,
      data: { ...retiredPalmOil, isActive: true },
    })
    render(<InventoryClient initialData={[retiredPalmOil]} />)
    await user.click(screen.getByRole('button', { name: /show archived \(1\)/i }))

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(mockToggleInventoryItemActive).toHaveBeenCalledWith(retiredPalmOil.id, true)
    expect(screen.getByText('Palm Oil')).toBeInTheDocument()
    expect(screen.queryByText('ARCHIVED')).not.toBeInTheDocument()
  })

  it('surfaces a failed toggle and leaves the row in its original state', async () => {
    const user = userEvent.setup()
    mockToggleInventoryItemActive.mockResolvedValue({
      ok: false,
      error: 'Could not update this inventory item. Please try again.',
      code: 'UNKNOWN',
    })
    render(<InventoryClient initialData={[rice]} />)

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ description: 'Could not update this inventory item. Please try again.', type: 'error' }))
    expect(screen.getByText('Long Grain Rice')).toBeInTheDocument()
  })
})
