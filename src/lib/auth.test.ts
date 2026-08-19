/**
 * Unit tests for src/lib/auth.ts — identity resolution and session minting.
 *
 * Mocks `@/utils/supabase/server`'s createClient, `@/utils/supabase/admin`'s createAdminClient, and
 * `@/lib/prisma` — no real database or network. Covers the admin-lockout regression case (c) and
 * the phone-login identity paths added alongside phone-OTP support.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { User } from '@prisma/client'

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { prisma } from '@/lib/prisma'
import {
  AuthError,
  getCurrentDbUser,
  mintSessionForAuthEmail,
  requireAdmin,
  resolveCustomerForPhoneLogin,
  syncPrismaUser,
  syntheticEmailForPhone,
} from '@/lib/auth'

const createClientMock = vi.mocked(createClient)
const createAdminClientMock = vi.mocked(createAdminClient)
const findUniqueMock = vi.mocked(prisma.user.findUnique)
const findFirstMock = vi.mocked(prisma.user.findFirst)
const createMock = vi.mocked(prisma.user.create)
const updateMock = vi.mocked(prisma.user.update)

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
    authEmail: null,
    preferredLoginMethod: 'EMAIL',
    role: 'ADMIN',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('getCurrentDbUser', () => {
  test('case (a): resolves null when there is no Supabase session', async () => {
    mockSupabaseUser(null)

    const result = await getCurrentDbUser()

    expect(result).toBeNull()
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  test('case (b): resolves the row directly when the Prisma id matches, without any fallback lookup', async () => {
    mockSupabaseUser({ id: 'db-user-1', email: 'test@example.com' })
    const row = dbUser({ id: 'db-user-1' })
    findUniqueMock.mockResolvedValueOnce(row)

    const result = await getCurrentDbUser()

    expect(result).toEqual(row)
    expect(findUniqueMock).toHaveBeenCalledTimes(1)
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'db-user-1' } })
  })

  test('resolves via authEmail — the exact-identity match for a repeat login', async () => {
    mockSupabaseUser({ id: 'divergent-auth-uuid', email: 'owner@example.com' })
    const row = dbUser({ id: 'prisma-generated-id', authEmail: 'owner@example.com' })
    findUniqueMock
      .mockResolvedValueOnce(null) // by id — misses
      .mockResolvedValueOnce(row) // by authEmail — hits

    const result = await getCurrentDbUser()

    expect(result).toEqual(row)
    expect(findUniqueMock).toHaveBeenCalledTimes(2)
    expect(findUniqueMock).toHaveBeenNthCalledWith(2, { where: { authEmail: 'owner@example.com' } })
  })

  test('case (c) — lockout regression: falls back to a unique email match when neither id nor authEmail matches', async () => {
    mockSupabaseUser({ id: 'divergent-auth-uuid', email: 'owner@example.com' })
    const row = dbUser({ id: 'prisma-generated-id', email: 'owner@example.com' })
    findUniqueMock
      .mockResolvedValueOnce(null) // 1: where { id } — finds nothing
      .mockResolvedValueOnce(null) // 2: where { authEmail } — misses, this row has none yet
      .mockResolvedValueOnce(row) // 3: where { email } — the pre-existing-row fallback

    const result = await getCurrentDbUser()

    expect(result).toEqual(row)
    expect(findUniqueMock).toHaveBeenCalledTimes(3)
    expect(findUniqueMock).toHaveBeenNthCalledWith(1, { where: { id: 'divergent-auth-uuid' } })
    expect(findUniqueMock).toHaveBeenNthCalledWith(2, { where: { authEmail: 'owner@example.com' } })
    expect(findUniqueMock).toHaveBeenNthCalledWith(3, { where: { email: 'owner@example.com' } })
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
    findUniqueMock
      .mockResolvedValueOnce(null) // by id
      .mockResolvedValueOnce(null) // by authEmail
      .mockResolvedValueOnce(row) // by email

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

describe('syncPrismaUser', () => {
  test('(a) already-synced: finds the row by authEmail and writes nothing', async () => {
    const row = dbUser({ id: 'other-id', authEmail: 'ama@example.com', role: 'CUSTOMER' })
    findUniqueMock
      .mockResolvedValueOnce(null) // by id
      .mockResolvedValueOnce(row) // by authEmail

    const result = await syncPrismaUser({ id: 'auth-uuid', email: 'ama@example.com' })

    expect(result).toEqual(row)
    expect(updateMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  test('(b) backfill: an admin-created row matched by real email gains authEmail rather than a duplicate', async () => {
    const preExisting = dbUser({ id: 'admin-created-id', email: 'ama@example.com', authEmail: null, role: 'CUSTOMER' })
    findUniqueMock
      .mockResolvedValueOnce(null) // by id
      .mockResolvedValueOnce(null) // by authEmail
    findFirstMock.mockResolvedValueOnce(preExisting)
    const backfilled = { ...preExisting, authEmail: 'ama@example.com' }
    updateMock.mockResolvedValueOnce(backfilled)

    const result = await syncPrismaUser({ id: 'auth-uuid', email: 'ama@example.com' })

    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'admin-created-id' },
      data: { authEmail: 'ama@example.com' },
    })
    expect(result).toEqual(backfilled)
  })

  test('(c) create: nothing matches, so a brand-new row is created with authEmail set', async () => {
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    findFirstMock.mockResolvedValueOnce(null)
    const created = dbUser({ id: 'auth-uuid', email: 'new@example.com', authEmail: 'new@example.com', role: 'CUSTOMER' })
    createMock.mockResolvedValueOnce(created)

    const result = await syncPrismaUser({ id: 'auth-uuid', email: 'new@example.com' })

    expect(createMock).toHaveBeenCalledWith({
      data: {
        id: 'auth-uuid',
        email: 'new@example.com',
        authEmail: 'new@example.com',
        phone: null,
        role: 'CUSTOMER',
      },
    })
    expect(result).toEqual(created)
  })

  test('(f) promotes a matched row to ADMIN when the identity matches ADMIN_EMAIL', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'owner@example.com')
    const row = dbUser({ id: 'row-id', authEmail: 'owner@example.com', role: 'CUSTOMER' })
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    updateMock.mockResolvedValueOnce({ ...row, role: 'ADMIN' })

    await syncPrismaUser({ id: 'auth-uuid', email: 'owner@example.com' })

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'row-id' },
      data: { role: 'ADMIN' },
    })
  })

  test('creates a brand-new admin row when ADMIN_EMAIL matches and nothing exists yet', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'owner@example.com')
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    findFirstMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce(dbUser({ role: 'ADMIN' }))

    await syncPrismaUser({ id: 'auth-uuid', email: 'owner@example.com' })

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) })
    )
  })
})

describe('resolveCustomerForPhoneLogin', () => {
  const PHONE = '233241234567'

  test('(d) create: a phone with no existing row gets a new one with a synthetic authEmail', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    const created = dbUser({
      id: 'new-id',
      email: null,
      phone: PHONE,
      authEmail: syntheticEmailForPhone(PHONE),
      preferredLoginMethod: 'PHONE',
      role: 'CUSTOMER',
    })
    createMock.mockResolvedValueOnce(created)

    const result = await resolveCustomerForPhoneLogin(PHONE)

    expect(createMock).toHaveBeenCalledWith({
      data: {
        phone: PHONE,
        authEmail: syntheticEmailForPhone(PHONE),
        preferredLoginMethod: 'PHONE',
        role: 'CUSTOMER',
      },
    })
    expect(result.authEmail).toBe(syntheticEmailForPhone(PHONE))
    expect(result.user).toEqual(created)
  })

  test('(e) backfill: an existing phone-matched row with no authEmail gets one, and is not duplicated', async () => {
    const existing = dbUser({ id: 'existing-id', phone: PHONE, authEmail: null, role: 'CUSTOMER' })
    findUniqueMock.mockResolvedValueOnce(existing)
    updateMock.mockResolvedValueOnce({ ...existing, authEmail: syntheticEmailForPhone(PHONE) })

    const result = await resolveCustomerForPhoneLogin(PHONE)

    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: { authEmail: syntheticEmailForPhone(PHONE) },
    })
    expect(result.user.id).toBe('existing-id')
  })

  test('already-synced: an existing row that already has an authEmail is returned untouched', async () => {
    const existing = dbUser({
      id: 'existing-id',
      phone: PHONE,
      authEmail: syntheticEmailForPhone(PHONE),
      role: 'CUSTOMER',
    })
    findUniqueMock.mockResolvedValueOnce(existing)

    const result = await resolveCustomerForPhoneLogin(PHONE)

    expect(updateMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
    expect(result.user).toEqual(existing)
  })

  test('(f) promotes to ADMIN when the phone matches ADMIN_PHONE', async () => {
    vi.stubEnv('ADMIN_PHONE', PHONE)
    const existing = dbUser({
      id: 'existing-id',
      phone: PHONE,
      authEmail: syntheticEmailForPhone(PHONE),
      role: 'CUSTOMER',
    })
    findUniqueMock.mockResolvedValueOnce(existing)
    updateMock.mockResolvedValueOnce({ ...existing, role: 'ADMIN' })

    await resolveCustomerForPhoneLogin(PHONE)

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: { role: 'ADMIN' },
    })
  })

  // PROACTIVE-002: a double-submit on a slow connection races two first-login requests through the
  // create branch. User.phone is @unique, so one gets P2002 — which must NOT surface to a customer
  // who just entered a correct code as "a customer with that phone already exists".
  test('a P2002 collision in the create branch re-fetches the winner instead of surfacing an error', async () => {
    const { Prisma } = await import('@prisma/client')
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const winner = dbUser({
      id: 'winner-id',
      phone: PHONE,
      authEmail: syntheticEmailForPhone(PHONE),
      role: 'CUSTOMER',
    })
    findUniqueMock
      .mockResolvedValueOnce(null) // initial lookup: nothing yet
      .mockResolvedValueOnce(winner) // re-fetch after losing the race
    createMock.mockRejectedValueOnce(collision)

    const result = await resolveCustomerForPhoneLogin(PHONE)

    expect(result.user.id).toBe('winner-id')
    expect(result.authEmail).toBe(syntheticEmailForPhone(PHONE))
  })

  test('a non-P2002 create failure still propagates rather than being swallowed', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    createMock.mockRejectedValueOnce(new Error('connection lost'))

    await expect(resolveCustomerForPhoneLogin(PHONE)).rejects.toThrow('connection lost')
  })
})

describe('mintSessionForAuthEmail', () => {
  const AUTH_EMAIL = 'phone-233241234567@internal.chopwithrostty.app'

  function mockAdminGenerateLink(result: unknown) {
    const generateLink = vi.fn().mockResolvedValue(result)
    createAdminClientMock.mockReturnValue({
      auth: { admin: { generateLink } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    return generateLink
  }

  function mockVerifyOtp(result: unknown) {
    const verifyOtp = vi.fn().mockResolvedValue(result)
    createClientMock.mockResolvedValue({
      auth: { verifyOtp },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    return verifyOtp
  }

  // THE binding directive. Hard-coding 'magiclink' works for every returning customer and 403s on
  // exactly one path — a phone-only customer's very first login, where Supabase reports "signup".
  test('redeems with verification_type "signup" when generateLink reports it (first-ever login)', async () => {
    mockAdminGenerateLink({
      data: { properties: { hashed_token: 'hash-abc', verification_type: 'signup' } },
      error: null,
    })
    const verifyOtp = mockVerifyOtp({ error: null })

    await mintSessionForAuthEmail(AUTH_EMAIL)

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-abc', type: 'signup' })
  })

  test('redeems with verification_type "magiclink" when generateLink reports it (repeat login)', async () => {
    mockAdminGenerateLink({
      data: { properties: { hashed_token: 'hash-def', verification_type: 'magiclink' } },
      error: null,
    })
    const verifyOtp = mockVerifyOtp({ error: null })

    await mintSessionForAuthEmail(AUTH_EMAIL)

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-def', type: 'magiclink' })
  })

  test('verifyOtp runs on the cookie-writing SSR client, not the service-role admin client', async () => {
    mockAdminGenerateLink({
      data: { properties: { hashed_token: 'hash-abc', verification_type: 'signup' } },
      error: null,
    })
    mockVerifyOtp({ error: null })

    await mintSessionForAuthEmail(AUTH_EMAIL)

    // A session minted on the admin client reaches nobody's browser — this asserts the split.
    expect(createClientMock).toHaveBeenCalled()
    expect(createAdminClientMock).toHaveBeenCalled()
  })

  test('throws AuthError when generateLink fails', async () => {
    mockAdminGenerateLink({ data: null, error: { message: 'bad service role key' } })

    await expect(mintSessionForAuthEmail(AUTH_EMAIL)).rejects.toThrow(AuthError)
  })

  test('throws AuthError when the token is rejected by verifyOtp', async () => {
    mockAdminGenerateLink({
      data: { properties: { hashed_token: 'hash-abc', verification_type: 'signup' } },
      error: null,
    })
    mockVerifyOtp({ error: { message: 'Token has expired or is invalid' } })

    await expect(mintSessionForAuthEmail(AUTH_EMAIL)).rejects.toThrow(AuthError)
  })
})
