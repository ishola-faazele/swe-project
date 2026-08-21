/**
 * MinIO (S3-compatible) object-storage integration.
 *
 * Mirrors the src/lib/notifications/ split: this file is the PURE provider integration — no
 * "use server", no Prisma, no auth import — so it stays testable in isolation. The thin,
 * auth-gated Server Action wrapper lives next door in ./actions.ts, and is the only file in
 * this module that touches requireAdmin/getCurrentDbUser/zod/ActionResult.
 *
 * Every value below is read lazily, per call, rather than captured in a module-scope const —
 * the same convention (and for the same reason) as whatsapp.ts's graphUrl(): a module-scope
 * `process.env.X` is frozen at import time, which makes it neither genuinely overridable at
 * runtime nor stubbable by a test that imports this module normally. The S3Client is
 * constructed per call for that same reason; presigning performs no network I/O and this is an
 * admin-only, occasional path, so the construction cost is irrelevant here.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// MinIO ignores the region entirely, but the AWS SDK's constructor rejects an empty one.
const DEFAULT_REGION = 'us-east-1'

// Must match the bucket docker-compose.yml's minio-init service creates and applies
// `mc anonymous set download` to.
const DEFAULT_BUCKET = 'chop-uploads'

// 10 minutes — generous for a slow mobile upload, short enough that a leaked link can't be
// replayed hours later.
const PRESIGN_EXPIRY_SECONDS = 600

function bucketName(): string {
  return process.env.MINIO_BUCKET || DEFAULT_BUCKET
}

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.MINIO_REGION || DEFAULT_REGION,
    endpoint: process.env.MINIO_ENDPOINT,
    // Required for MinIO — virtual-hosted-style bucket addressing does not work against it.
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    },
  })
}

export async function createPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ContentType: contentType,
  })

  // ⚠ ContentType is NOT signed/enforced by @aws-sdk/s3-request-presigner by default (confirmed
  // against aws/aws-sdk-js-v3#3497). Without this explicit signableHeaders override a client
  // could PUT with ANY Content-Type despite the server only ever issuing URLs for allowlisted
  // types, silently defeating getMediaUploadUrl's allowlist. With it, MinIO rejects a mismatched
  // Content-Type on the actual PUT with a 403 — a protocol-level guarantee, not just an
  // application-layer check. Do not remove.
  return getSignedUrl(s3Client(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    signableHeaders: new Set(['content-type']),
  })
}

/**
 * The permanent, stable URL stored in DishMedia.url / User.imageUrl.
 *
 * Deliberately NOT a presigned/expiring GET URL — this value is persisted and rendered
 * indefinitely, so it must never expire. It works only because the bucket carries an
 * anonymous-download policy (public GET by exact key, never public LIST) applied by
 * docker-compose.yml's minio-init service.
 *
 * MINIO_PUBLIC_ENDPOINT overrides the host for display purposes only (a future reverse
 * proxy/CDN domain); it is never used for presigning, whose signature is bound to
 * MINIO_ENDPOINT's exact host.
 */
export function buildPublicUrl(key: string): string {
  const base = (process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || '').replace(/\/$/, '')
  return `${base}/${bucketName()}/${key}`
}
