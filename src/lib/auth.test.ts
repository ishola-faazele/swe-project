/**
 * Unit tests for getCurrentDbUser() / requireAdmin() — TEST-004.
 *
 * The security-critical unit test for this phase. Mocks `@/utils/supabase/server`'s
 * createClient and `@/lib/prisma`'s prisma.user.findUnique — no real database or network.
 * Covers the admin-lockout regression case (c): a Supabase session whose auth UUID has no
 * matching Prisma `id` must still resolve via the unique email fallback.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { User } from '@prisma/client'

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { AuthError, getCurrentDbUser, requireAdmin } from '@/lib/auth'

const createClientMock = vi.mocked(createClient)
const findUniqueMock = vi.mocked(prisma.user.findUnique)

function mockSupabaseUser(user: { id: string; email: string | null } | null) {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

function dbUser(overrides: Partial<User> = {}): User {
  return {
    id: 'db-user-1',
    shortId: 1,
    name: 'Test User',
    email: 'test@example.com',
    phone: null,
    role: 'ADMIN',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCurrentDbUser', () => {
  test('case (a): resolves null when there is no Supabase session', async () => {
    mockSupabaseUser(null)

    const result = await getCurrentDbUser()

    expect(result).toBeNull()
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  test('case (b): resolves the row directly when the Prisma id matches, without a fallback email lookup', async () => {
    mockSupabaseUser({ id: 'db-user-1', email: 'test@example.com' })
    const row = dbUser({ id: 'db-user-1' })
    findUniqueMock.mockResolvedValueOnce(row)

    const result = await getCurrentDbUser()

    expect(result).toEqual(row)
    expect(findUniqueMock).toHaveBeenCalledTimes(1)
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'db-user-1' } })
  })

  test('case (c) — lockout regression: falls back to a unique email match when no row matches the auth id', async () => {
    mockSupabaseUser({ id: 'divergent-auth-uuid', email: 'owner@example.com' })
    const row = dbUser({ id: 'prisma-generated-id', email: 'owner@example.com' })
    findUniqueMock
      .mockResolvedValueOnce(null) // first call: where { id: 'divergent-auth-uuid' } finds nothing
      .mockResolvedValueOnce(row) // second call: where { email: 'owner@example.com' } finds the row

    const result = await getCurrentDbUser()

    expect(result).toEqual(row)
    expect(findUniqueMock).toHaveBeenCalledTimes(2)
    expect(findUniqueMock).toHaveBeenNthCalledWith(1, { where: { id: 'divergent-auth-uuid' } })
    expect(findUniqueMock).toHaveBeenNthCalledWith(2, { where: { email: 'owner@example.com' } })
  })

  test('resolves null when the auth id has no match and the session has no email to fall back on', async () => {
    mockSupabaseUser({ id: 'divergent-auth-uuid', email: null })
    findUniqueMock.mockResolvedValueOnce(null)

    const result = await getCurrentDbUser()

    expect(result).toBeNull()
    expect(findUniqueMock).toHaveBeenCalledTimes(1)
  })
})

describe('requireAdmin', () => {
  test('case (a): rejects with AuthError "You must be signed in..." when there is no session', async () => {
    mockSupabaseUser(null)

    await expect(requireAdmin()).rejects.toThrow(AuthError)
    await expect(requireAdmin()).rejects.toThrow('You must be signed in to do that.')
  })

  test('case (b): resolves the admin row when the Prisma id matches and role is ADMIN', async () => {
    mockSupabaseUser({ id: 'db-user-1', email: 'admin@example.com' })
    const row = dbUser({ id: 'db-user-1', role: 'ADMIN' })
    findUniqueMock.mockResolvedValueOnce(row)

    await expect(requireAdmin()).resolves.toEqual(row)
  })

  test('case (c) — lockout regression: resolves and authorizes via the email fallback', async () => {
    mockSupabaseUser({ id: 'divergent-auth-uuid', email: 'owner@example.com' })
    const row = dbUser({ id: 'prisma-generated-id', email: 'owner@example.com', role: 'ADMIN' })
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(row)

    await expect(requireAdmin()).resolves.toEqual(row)
  })

  test('case (d): rejects with AuthError "You do not have permission..." when the resolved user is not ADMIN', async () => {
    mockSupabaseUser({ id: 'db-user-1', email: 'customer@example.com' })
    const row = dbUser({ id: 'db-user-1', role: 'CUSTOMER' })
    findUniqueMock.mockResolvedValue(row)

    await expect(requireAdmin()).rejects.toThrow(AuthError)
    await expect(requireAdmin()).rejects.toThrow('You do not have permission to do that.')
  })
})
