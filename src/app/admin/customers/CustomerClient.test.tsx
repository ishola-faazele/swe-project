/**
 * Component tests for CustomerClient — the customer table and its Add/Edit dialogs.
 * `createCustomer`/`updateCustomer`/`deleteCustomer`/`toggleCustomerActive` are mocked (this is the
 * component layer, not integration — the real Server Actions are covered by
 * tests/integration/customers-actions.integration.test.ts).
 *
 * This file is net-new — no test file existed for CustomerClient before TEST-008, unlike
 * MenuClient which already had one. Scope here focuses on what TEST-008 requires: the table's
 * columns (including the new FE-005 thumbnail/avatar column) render correctly and don't regress.
 * It intentionally does not attempt the same dialog-interaction depth as MenuClient.test.tsx —
 * flagged in the test-engineer report as a pre-existing gap this feature's scope didn't require
 * closing, not silently left uncovered.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@prisma/client'
import { CustomerClient } from './CustomerClient'
import { createCustomer, updateCustomer, deleteCustomer, toggleCustomerActive } from './actions'

vi.mock('./actions', () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  toggleCustomerActive: vi.fn(),
}))

const mockCreateCustomer = vi.mocked(createCustomer)
const mockUpdateCustomer = vi.mocked(updateCustomer)
const mockDeleteCustomer = vi.mocked(deleteCustomer)
const mockToggleCustomerActive = vi.mocked(toggleCustomerActive)

type ClientSafeUser = Omit<User, 'authEmail'>
type CustomerWithCount = ClientSafeUser & { _count: { orders: number } }

function makeCustomer(overrides: Partial<CustomerWithCount> & { id: string; shortId: number }): CustomerWithCount {
  return {
    name: 'Ama Boateng',
    email: 'ama@example.com',
    phone: null,
    isActive: true,
    preferredLoginMethod: 'EMAIL',
    notifyByEmail: true,
    notifyBySms: true,
    notifyByWhatsapp: true,
    alertEmail: null,
    alertPhone: null,
    alertWhatsapp: null,
    imageUrl: null,
    role: 'CUSTOMER',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    _count: { orders: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CustomerClient — table', () => {
  it('renders a row per customer with shortId, name, email, and phone', () => {
    const customer = makeCustomer({
      id: 'cust-1',
      shortId: 4,
      name: 'Ama Boateng',
      email: 'ama@example.com',
      phone: '0241234567',
    })
    render(<CustomerClient initialData={[customer]} />)

    expect(screen.getByText('#4')).toBeInTheDocument()
    expect(screen.getByText('Ama Boateng')).toBeInTheDocument()
    expect(screen.getByText('ama@example.com')).toBeInTheDocument()
    expect(screen.getByText('0241234567')).toBeInTheDocument()
  })

  it('renders em-dash placeholders for a customer with no email/phone on file', () => {
    const customer = makeCustomer({ id: 'cust-2', shortId: 5, name: 'Kojo Mensah', email: null, phone: null })
    render(<CustomerClient initialData={[customer]} />)

    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2) // one for email, one for phone
  })

  it('renders the empty state when initialData is empty', () => {
    render(<CustomerClient initialData={[]} />)
    expect(screen.getByText('No customers yet')).toBeInTheDocument()
  })

  it('does not show archived customers by default, but does via "Show Archived"', async () => {
    const user = userEvent.setup()
    const active = makeCustomer({ id: 'cust-active', shortId: 1, name: 'Active Customer', isActive: true })
    const archived = makeCustomer({ id: 'cust-archived', shortId: 2, name: 'Archived Customer', isActive: false })
    render(<CustomerClient initialData={[active, archived]} />)

    expect(screen.getByText('Active Customer')).toBeInTheDocument()
    expect(screen.queryByText('Archived Customer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show archived/i }))

    expect(screen.getByText('Archived Customer')).toBeInTheDocument()
  })
})

// FE-005/TEST-008.
describe('CustomerClient — thumbnail/avatar column (FE-005)', () => {
  it('renders an <img> with the customer\'s imageUrl as src when imageUrl is set', () => {
    const withPhoto = makeCustomer({
      id: 'cust-photo',
      shortId: 6,
      name: 'Photographed Customer',
      imageUrl: 'https://cdn.example.com/customers/photo.jpg',
    })
    const { container } = render(<CustomerClient initialData={[withPhoto]} />)

    // alt="" is deliberate (decorative; the name column already labels the row) — this removes the
    // image from the accessibility tree, so querySelector is used rather than getByRole('img').
    const img = container.querySelector('img[src="https://cdn.example.com/customers/photo.jpg"]')
    expect(img).not.toBeNull()
  })

  it('renders an initials-avatar (first letter of name, uppercased) when imageUrl is null and a name is set', () => {
    const noPhoto = makeCustomer({ id: 'cust-no-photo', shortId: 7, name: 'zainab yusuf', imageUrl: null })
    const { container } = render(<CustomerClient initialData={[noPhoto]} />)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    // The avatar badge is the row's only element whose entire text content is the bare initial.
    const avatar = screen.getByText('Z')
    expect(avatar).toBeInTheDocument()
  })

  it('falls back to a generic person icon (not a broken <img>, not an empty badge) when both imageUrl and name are empty', () => {
    // name is non-nullable on User, but the column reads `customer.name?.trim().charAt(0)` — an
    // empty string is the closest realistic "no name" case (matches the "No name" fallback the
    // NAME column itself already renders for a blank name).
    const blank = makeCustomer({ id: 'cust-blank', shortId: 8, name: '', imageUrl: null })
    const { container } = render(<CustomerClient initialData={[blank]} />)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    // lucide-react's User icon — the last-resort fallback inside the avatar badge.
    expect(container.querySelector('.lucide-user')).not.toBeNull()
  })

  it('does not regress the existing shortId/name/email/phone columns when a photo is present', () => {
    const withPhoto = makeCustomer({
      id: 'cust-photo-2',
      shortId: 9,
      name: 'Both Photo And Data',
      email: 'both@example.com',
      phone: '0201234567',
      imageUrl: 'https://cdn.example.com/customers/photo2.jpg',
    })
    render(<CustomerClient initialData={[withPhoto]} />)

    expect(screen.getByText('#9')).toBeInTheDocument()
    expect(screen.getByText('Both Photo And Data')).toBeInTheDocument()
    expect(screen.getByText('both@example.com')).toBeInTheDocument()
    expect(screen.getByText('0201234567')).toBeInTheDocument()
  })
})

describe('CustomerClient — create dialog', () => {
  it('is closed until "Add Customer" is clicked, via onClick={() => setIsOpen(true)}', async () => {
    const user = userEvent.setup()
    render(<CustomerClient initialData={[]} />)

    expect(screen.queryByRole('heading', { name: 'Add New Customer' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add customer/i }))

    expect(screen.getByRole('heading', { name: 'Add New Customer' })).toBeInTheDocument()
  })

  it('submitting a name-only customer calls createCustomer and optimistically appends the result', async () => {
    const user = userEvent.setup()
    mockCreateCustomer.mockResolvedValue({
      ok: true,
      data: makeCustomer({ id: 'cust-new', shortId: 12, name: 'New Customer', email: null, phone: null }),
    })

    render(<CustomerClient initialData={[]} />)
    await user.click(screen.getByRole('button', { name: /add customer/i }))
    await user.type(screen.getByLabelText('Name'), 'New Customer')
    await user.click(screen.getByRole('button', { name: 'Save Customer' }))

    expect(mockCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Customer' })
    )
    // A customer's photo is self-service only (see ProfilePhoto.tsx) — the admin's create form
    // must never send an imageUrl at all, not even null.
    expect(mockCreateCustomer).toHaveBeenCalledWith(
      expect.not.objectContaining({ imageUrl: expect.anything() })
    )
    expect(await screen.findByText('New Customer')).toBeInTheDocument()
  })
})

describe('CustomerClient — archive/restore', () => {
  it('archive toggle calls toggleCustomerActive(id, false) and flips the row to archived styling', async () => {
    const user = userEvent.setup()
    const customer = makeCustomer({ id: 'cust-active', shortId: 1, name: 'Active Customer', isActive: true })
    mockToggleCustomerActive.mockResolvedValue({ ok: true, data: { ...customer, isActive: false } })
    render(<CustomerClient initialData={[customer]} />)

    await user.click(screen.getByRole('button', { name: /archive customer/i }))

    expect(mockToggleCustomerActive).toHaveBeenCalledWith('cust-active', false)
    // Archived rows disappear from the default (non-"Show Archived") view.
    expect(await screen.findByText('No customers yet')).toBeInTheDocument()
  })
})

describe('CustomerClient — delete', () => {
  it('is gated behind confirmation: declining leaves deleteCustomer uncalled', async () => {
    const user = userEvent.setup()
    const customer = makeCustomer({ id: 'cust-1', shortId: 1, name: 'Ama Boateng' })
    render(<CustomerClient initialData={[customer]} />)

    await user.click(screen.getByRole('button', { name: /delete customer/i }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockDeleteCustomer).not.toHaveBeenCalled()
    expect(screen.getByText('Ama Boateng')).toBeInTheDocument()
  })

  it('a successful, non-archived delete removes the row from the table entirely', async () => {
    const customer = makeCustomer({ id: 'cust-1', shortId: 1, name: 'Ama Boateng' })
    mockDeleteCustomer.mockResolvedValue({ ok: true, data: { archived: false } })
    const user = userEvent.setup()
    render(<CustomerClient initialData={[customer]} />)

    await user.click(screen.getByRole('button', { name: /delete customer/i }))
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByText('No customers yet')).toBeInTheDocument()
  })
})
