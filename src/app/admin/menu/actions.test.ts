/**
 * Unit tests for createDish/updateDish's new zod-validation layer (BE-005/TEST-003). Before this
 * migration these two actions had ZERO input validation — a negative price or empty name reached
 * Prisma unchecked. This file covers exactly the paths that migration added: rejection with a
 * VALIDATION ActionResult before Prisma is ever touched, and a still-working happy path against a
 * mocked prisma.$transaction. Full behavioral coverage of createDish/updateDish (recipe merging,
 * dedup, imageUrl round-tripping) already lives in the integration suite
 * (tests/integration/menu-dish-actions.integration.test.ts) against a real database — this file
 * is deliberately narrow: it exists to test the validation gate this feature added, not to
 * duplicate that coverage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn() },
}))

import { requireAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createDish, updateDish } from './actions'

const requireAdminMock = vi.mocked(requireAdmin)
const transactionMock = vi.mocked(prisma.$transaction)

// updateDishSchema's `id` field is z.uuid() — a non-UUID string like 'dish-1' would itself fail
// validation and mask whichever field a given test is actually trying to isolate. Use a real UUID
// for every updateDish() call below except the one test that deliberately exercises a bad id.
const TEST_DISH_ID = '2b5fa58c-5a62-4e16-a5a2-735f8b454920'

/** A minimal stub of the `tx` object the $transaction callback is handed. */
function txStub(overrides: { create?: unknown; update?: unknown } = {}) {
  return {
    dish: {
      create: vi.fn().mockResolvedValue(overrides.create ?? {
        id: 'dish-1',
        shortId: 1,
        name: 'Jollof Rice',
        price: 1200,
        servingSize: 1,
        isActive: true,
        imageUrl: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      }),
    },
    dishIngredient: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

function stubTransaction(tx: ReturnType<typeof txStub>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transactionMock.mockImplementation(((cb: any) => cb(tx)) as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAdminMock.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as any)
})

describe('createDish', () => {
  it('rejects a negative price with a VALIDATION ActionResult, never reaching Prisma', async () => {
    const result = await createDish({ name: 'Bad Dish', price: -100, ingredients: [] })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects an empty (whitespace-only) name with a VALIDATION ActionResult, never reaching Prisma', async () => {
    const result = await createDish({ name: '   ', price: 500, ingredients: [] })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('calls requireAdmin() before validating input', async () => {
    class AuthErrorStub extends Error {}
    requireAdminMock.mockRejectedValue(new AuthErrorStub('You must be signed in to do that.'))

    await expect(createDish({ name: 'Jollof', price: 1200, ingredients: [] })).rejects.toThrow(AuthErrorStub)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('a valid payload returns ActionResult<Dish> with ok: true (mocked Prisma)', async () => {
    stubTransaction(txStub())

    const result = await createDish({ name: 'Jollof Rice', price: 1200, ingredients: [] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.name).toBe('Jollof Rice')
    expect(result.data.price).toBe(1200)
  })
})

describe('updateDish', () => {
  it('rejects a negative price with a VALIDATION ActionResult, never reaching Prisma', async () => {
    const result = await updateDish(TEST_DISH_ID, { price: -50 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects an empty (whitespace-only) name with a VALIDATION ActionResult, never reaching Prisma', async () => {
    const result = await updateDish(TEST_DISH_ID, { name: '   ' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid id (not a UUID) with a VALIDATION ActionResult', async () => {
    const result = await updateDish('not-a-uuid', { price: 500 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('calls requireAdmin() before validating input', async () => {
    class AuthErrorStub extends Error {}
    requireAdminMock.mockRejectedValue(new AuthErrorStub('You must be signed in to do that.'))

    await expect(updateDish(TEST_DISH_ID, { price: 500 })).rejects.toThrow(AuthErrorStub)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('a valid payload returns ActionResult<Dish> with ok: true (mocked Prisma)', async () => {
    const tx = txStub()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(tx.dish as any).update = vi.fn().mockResolvedValue({
      id: 'dish-1',
      shortId: 1,
      name: 'Jollof Rice (renamed)',
      price: 1400,
      servingSize: 1,
      isActive: true,
      imageUrl: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    })
    stubTransaction(tx)

    const result = await updateDish(TEST_DISH_ID, { name: 'Jollof Rice (renamed)', price: 1400 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.price).toBe(1400)
  })
})
