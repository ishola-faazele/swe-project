/**
 * Unit tests for src/lib/storage/actions.ts — getMediaUploadUrl, the only file in the storage
 * module that touches requireAdmin/zod/ActionResult. Mocks `@/lib/auth`'s requireAdmin and the
 * sibling ./client module (createPresignedUploadUrl/buildPublicUrl) — no real crypto, no real
 * Prisma, no real MinIO. Mirrors the requireAdmin-mocking convention already used in this repo's
 * Server Action unit tests (e.g. src/app/dashboard/actions.test.ts mocks its own auth boundary).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(), getCurrentDbUser: vi.fn() }))
vi.mock('./client', () => ({
  createPresignedUploadUrl: vi.fn(),
  buildPublicUrl: vi.fn(),
}))

import { requireAdmin, getCurrentDbUser } from '@/lib/auth'
import { createPresignedUploadUrl, buildPublicUrl } from './client'
import { getMediaUploadUrl } from './actions'

const requireAdminMock = vi.mocked(requireAdmin)
const getCurrentDbUserMock = vi.mocked(getCurrentDbUser)
const createPresignedUploadUrlMock = vi.mocked(createPresignedUploadUrl)
const buildPublicUrlMock = vi.mocked(buildPublicUrl)

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAdminMock.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCurrentDbUserMock.mockResolvedValue({ id: 'customer-1', role: 'CUSTOMER' } as any)
  createPresignedUploadUrlMock.mockResolvedValue('http://127.0.0.1:9000/chop-uploads/dishes/some-uuid.jpg?X-Amz-Signature=abc')
  buildPublicUrlMock.mockReturnValue('http://127.0.0.1:9000/chop-uploads/dishes/some-uuid.jpg')
})

describe('getMediaUploadUrl', () => {
  it('calls requireAdmin() before anything else, and propagates its rejection rather than swallowing it into an ActionResult', async () => {
    class AuthErrorStub extends Error {}
    requireAdminMock.mockRejectedValue(new AuthErrorStub('You must be signed in to do that.'))

    await expect(getMediaUploadUrl({ entityType: 'dish', contentType: 'image/jpeg' })).rejects.toThrow(AuthErrorStub)
    expect(createPresignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('returns { ok: true, data: { uploadUrl, publicUrl } } for valid input', async () => {
    const result = await getMediaUploadUrl({ entityType: 'dish', contentType: 'image/jpeg' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.uploadUrl).toBe('http://127.0.0.1:9000/chop-uploads/dishes/some-uuid.jpg?X-Amz-Signature=abc')
    expect(result.data.publicUrl).toBe('http://127.0.0.1:9000/chop-uploads/dishes/some-uuid.jpg')
  })

  it('generates a server-side key under the dish/ prefix for entityType "dish", never from client input', async () => {
    await getMediaUploadUrl({ entityType: 'dish', contentType: 'image/jpeg' })

    expect(createPresignedUploadUrlMock).toHaveBeenCalledTimes(1)
    const [key, contentType] = createPresignedUploadUrlMock.mock.calls[0]
    expect(key).toMatch(/^dishes\/[0-9a-f-]{36}\.jpg$/)
    expect(contentType).toBe('image/jpeg')
  })

  it('generates a server-side key under the customers/ prefix for entityType "customer"', async () => {
    await getMediaUploadUrl({ entityType: 'customer', contentType: 'image/png' })

    const [key] = createPresignedUploadUrlMock.mock.calls[0]
    expect(key).toMatch(/^customers\/[0-9a-f-]{36}\.png$/)
  })

  it('derives the file extension from contentType (webp -> .webp)', async () => {
    await getMediaUploadUrl({ entityType: 'dish', contentType: 'image/webp' })

    const [key] = createPresignedUploadUrlMock.mock.calls[0]
    expect(key).toMatch(/\.webp$/)
  })

  it('rejects an invalid contentType with a VALIDATION ActionResult, without calling createPresignedUploadUrl', async () => {
    const result = await getMediaUploadUrl({ entityType: 'dish', contentType: 'image/heic' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(createPresignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid entityType with a VALIDATION ActionResult, without calling createPresignedUploadUrl', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getMediaUploadUrl({ entityType: 'invoice' as any, contentType: 'image/jpeg' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(createPresignedUploadUrlMock).not.toHaveBeenCalled()
  })

  // The entityType-conditional gate — this is the test that would have caught the "customer
  // self-service impossible with an unconditional requireAdmin()" bug if it had shipped unfixed.
  it('entityType:"customer" rejects with VALIDATION when getCurrentDbUser() resolves null, and never calls requireAdmin', async () => {
    getCurrentDbUserMock.mockResolvedValue(null)

    const result = await getMediaUploadUrl({ entityType: 'customer', contentType: 'image/jpeg' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
    expect(requireAdminMock).not.toHaveBeenCalled()
    expect(createPresignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('entityType:"customer" succeeds for a logged-in user without ever calling requireAdmin', async () => {
    const result = await getMediaUploadUrl({ entityType: 'customer', contentType: 'image/jpeg' })

    expect(result.ok).toBe(true)
    expect(requireAdminMock).not.toHaveBeenCalled()
    expect(getCurrentDbUserMock).toHaveBeenCalledTimes(1)
  })

  it.each(['video/mp4', 'video/webm', 'video/quicktime'])(
    'entityType:"dish" accepts %s',
    async (contentType) => {
      const result = await getMediaUploadUrl({ entityType: 'dish', contentType })

      expect(result.ok).toBe(true)
      expect(createPresignedUploadUrlMock).toHaveBeenCalledWith(expect.any(String), contentType)
    }
  )

  // The single most important assertion in this file per the TDD: proves the schema's .refine()
  // gate actually rejects video for customers, even though those content types are in the base
  // allowlist for dish.
  it.each(['video/mp4', 'video/webm', 'video/quicktime'])(
    'entityType:"customer" REJECTS %s with VALIDATION, even though it is allowed for dish',
    async (contentType) => {
      const result = await getMediaUploadUrl({ entityType: 'customer', contentType })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('VALIDATION')
      expect(createPresignedUploadUrlMock).not.toHaveBeenCalled()
    }
  )

  // This file deliberately mocks '@/lib/auth' and './client' only — no '@/lib/prisma' mock is
  // registered anywhere in this file. If getMediaUploadUrl ever started importing/calling Prisma
  // (e.g. to log the upload), that unmocked import would attempt a real PrismaClient construction
  // and every test above would fail with a connection/module error rather than the assertions
  // they actually make — so the full suite passing is itself evidence this action stays
  // Prisma-free, exactly as BE-004's Definition of Done requires.
})
