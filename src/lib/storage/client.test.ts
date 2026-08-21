/**
 * Unit tests for src/lib/storage/client.ts — the pure MinIO/S3-SDK integration (no "use server",
 * no Prisma, no auth import). `@aws-sdk/s3-request-presigner`'s getSignedUrl is mocked; no real
 * network call is made and no real MinIO instance is required for this file. All MINIO_* env vars
 * are stubbed per-test (this repo's `vitest.config.mts` loads the real `.env` via `dotenv/config`,
 * so without stubbing, these tests would depend on whatever this worktree's real .env happens to
 * contain — see whatsapp.test.ts for the same stub/unstub-per-test convention).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { buildPublicUrl, createPresignedUploadUrl } from './client'

const getSignedUrlMock = vi.mocked(getSignedUrl)

function stubMinioEnv(overrides: Partial<Record<
  'MINIO_ENDPOINT' | 'MINIO_PUBLIC_ENDPOINT' | 'MINIO_BUCKET' | 'MINIO_ACCESS_KEY' | 'MINIO_SECRET_KEY' | 'MINIO_REGION',
  string
>> = {}) {
  const {
    MINIO_ENDPOINT = 'http://127.0.0.1:9000',
    MINIO_PUBLIC_ENDPOINT = '',
    MINIO_BUCKET = 'chop-uploads',
    MINIO_ACCESS_KEY = 'minioadmin',
    MINIO_SECRET_KEY = 'minioadmin',
    MINIO_REGION = 'us-east-1',
  } = overrides
  vi.stubEnv('MINIO_ENDPOINT', MINIO_ENDPOINT)
  vi.stubEnv('MINIO_PUBLIC_ENDPOINT', MINIO_PUBLIC_ENDPOINT)
  vi.stubEnv('MINIO_BUCKET', MINIO_BUCKET)
  vi.stubEnv('MINIO_ACCESS_KEY', MINIO_ACCESS_KEY)
  vi.stubEnv('MINIO_SECRET_KEY', MINIO_SECRET_KEY)
  vi.stubEnv('MINIO_REGION', MINIO_REGION)
}

beforeEach(() => {
  stubMinioEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('createPresignedUploadUrl', () => {
  it('resolves with the URL returned by getSignedUrl', async () => {
    getSignedUrlMock.mockResolvedValue('http://127.0.0.1:9000/chop-uploads/dishes/abc.jpg?X-Amz-Signature=deadbeef')

    const url = await createPresignedUploadUrl('dishes/abc.jpg', 'image/jpeg')

    expect(url).toBe('http://127.0.0.1:9000/chop-uploads/dishes/abc.jpg?X-Amz-Signature=deadbeef')
  })

  it('signs a PutObjectCommand carrying the exact Bucket/Key/ContentType', async () => {
    getSignedUrlMock.mockResolvedValue('signed-url')

    await createPresignedUploadUrl('customers/xyz.png', 'image/png')

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1)
    const [, command] = getSignedUrlMock.mock.calls[0]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toMatchObject({
      Bucket: 'chop-uploads',
      Key: 'customers/xyz.png',
      ContentType: 'image/png',
    })
  })

  /**
   * The load-bearing assertion (TEST-001's DoD calls this out explicitly): without
   * `signableHeaders: new Set(['content-type'])`, @aws-sdk/s3-request-presigner does not sign
   * ContentType at all, so a client could PUT with any Content-Type despite the server only ever
   * issuing URLs for allowlisted types — silently defeating getImageUploadUrl's allowlist. This
   * assertion is what makes the "content-type spoofing is blocked" claim in client.ts's own
   * comment (and the TDD) actually true, rather than merely asserted in a comment.
   */
  it('signs with signableHeaders: new Set(["content-type"]) — the content-type enforcement line', async () => {
    getSignedUrlMock.mockResolvedValue('signed-url')

    await createPresignedUploadUrl('dishes/abc.jpg', 'image/jpeg')

    const [, , options] = getSignedUrlMock.mock.calls[0]
    expect(options).toMatchObject({ signableHeaders: new Set(['content-type']) })
  })

  it('sets a 600-second (10 minute) expiry', async () => {
    getSignedUrlMock.mockResolvedValue('signed-url')

    await createPresignedUploadUrl('dishes/abc.jpg', 'image/jpeg')

    const [, , options] = getSignedUrlMock.mock.calls[0]
    expect(options).toMatchObject({ expiresIn: 600 })
  })

  it('falls back to the chop-uploads default bucket when MINIO_BUCKET is unset', async () => {
    stubMinioEnv({ MINIO_BUCKET: '' })
    getSignedUrlMock.mockResolvedValue('signed-url')

    await createPresignedUploadUrl('dishes/abc.jpg', 'image/jpeg')

    const [, command] = getSignedUrlMock.mock.calls[0]
    expect((command as PutObjectCommand).input.Bucket).toBe('chop-uploads')
  })

  it('falls back to the us-east-1 default region when MINIO_REGION is unset (MinIO ignores it, but the SDK requires a non-empty string)', async () => {
    stubMinioEnv({ MINIO_REGION: '' })
    getSignedUrlMock.mockResolvedValue('signed-url')

    // The region isn't part of the signed command's own input, so this only asserts that
    // constructing the client with an empty region doesn't throw before getSignedUrl is reached.
    await expect(createPresignedUploadUrl('dishes/abc.jpg', 'image/jpeg')).resolves.toBe('signed-url')
  })
})

describe('buildPublicUrl', () => {
  it('builds Bucket/Key off MINIO_ENDPOINT when MINIO_PUBLIC_ENDPOINT is unset', () => {
    stubMinioEnv({ MINIO_PUBLIC_ENDPOINT: '' })

    expect(buildPublicUrl('dishes/abc.jpg')).toBe('http://127.0.0.1:9000/chop-uploads/dishes/abc.jpg')
  })

  it('prefers MINIO_PUBLIC_ENDPOINT over MINIO_ENDPOINT when set — this is what a future reverse-proxy/CDN domain would override', () => {
    stubMinioEnv({ MINIO_PUBLIC_ENDPOINT: 'https://cdn.example.com' })

    expect(buildPublicUrl('dishes/abc.jpg')).toBe('https://cdn.example.com/chop-uploads/dishes/abc.jpg')
  })

  it('strips a trailing slash from MINIO_PUBLIC_ENDPOINT before joining', () => {
    stubMinioEnv({ MINIO_PUBLIC_ENDPOINT: 'https://cdn.example.com/' })

    expect(buildPublicUrl('dishes/abc.jpg')).toBe('https://cdn.example.com/chop-uploads/dishes/abc.jpg')
  })

  it('strips a trailing slash from MINIO_ENDPOINT (the fallback) before joining', () => {
    stubMinioEnv({ MINIO_PUBLIC_ENDPOINT: '', MINIO_ENDPOINT: 'http://127.0.0.1:9000/' })

    expect(buildPublicUrl('customers/xyz.png')).toBe('http://127.0.0.1:9000/chop-uploads/customers/xyz.png')
  })

  it('never returns an expiring/presigned URL shape — no query string, unlike createPresignedUploadUrl', () => {
    stubMinioEnv({ MINIO_PUBLIC_ENDPOINT: '' })

    const url = buildPublicUrl('dishes/abc.jpg')

    expect(url).not.toContain('?')
    expect(url).not.toContain('X-Amz-')
  })
})
