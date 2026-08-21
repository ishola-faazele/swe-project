"use server"

import { randomUUID } from 'crypto'
import { requireAdmin, getCurrentDbUser } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { mediaUploadRequestSchema } from '@/lib/validation'
import { createPresignedUploadUrl, buildPublicUrl } from './client'

const KEY_PREFIX: Record<'dish' | 'customer', string> = { dish: 'dishes', customer: 'customers' }

// Video entries are gated to entityType:'dish' at the SCHEMA level (mediaUploadRequestSchema),
// not here; this map just needs an extension for every content type the schema can let through.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov', // iOS/QuickTime camera video — same class of real-device gotcha as HEIC
}

/**
 * Mints a short-lived presigned PUT URL so the browser can upload a photo or video DIRECTLY to
 * MinIO, plus the permanent public URL to store on the record once it has.
 *
 * This action deliberately does not touch Prisma at all — it has no idea whether an
 * addDishMedia/updateProfilePhoto call ever follows. Decoupling "issue an upload URL" from
 * "attach a URL to a record" is what lets the upload start the instant a file is picked rather
 * than on form submit, and it is the direct mechanism behind this feature's accepted
 * orphaned-object tradeoff: the entire contract here is "here is somewhere you are allowed to PUT
 * one file", full stop.
 *
 * ⚠ A successful return does NOT mean MinIO is reachable. Presigning is a pure cryptographic
 * operation with no network call, so this succeeds even when the compose stack is down; that
 * failure only surfaces at the browser's actual PUT.
 */
export async function getMediaUploadUrl(
  input: { entityType: 'dish' | 'customer'; contentType: string }
): Promise<ActionResult<{ uploadUrl: string; publicUrl: string }>> {
  // The gate is entityType-conditional, and deliberately so. An unconditional requireAdmin() here
  // would make customer self-service impossible outright: a logged-in customer uploading their own
  // photo would hit AuthError before ever reaching MinIO.
  if (input.entityType === 'dish') {
    await requireAdmin() // only admins manage the dish menu and its media
  } else {
    const user = await getCurrentDbUser()
    if (!user) {
      return { ok: false, error: 'You must be signed in to do that.', code: 'VALIDATION' }
    }
    // Deliberately does NOT further check that `user` is specifically a CUSTOMER, nor which one —
    // this action stays fully decoupled from any specific row, so "is some real authenticated
    // user" is the complete, correct authorization check it can meaningfully make here. The
    // row-level check that matters — "can this caller write to THIS User.id" — lives entirely in
    // updateProfilePhoto (dashboard/actions.ts), which always writes the caller's own resolved id
    // and never a client-supplied one.
  }

  try {
    const parsed = mediaUploadRequestSchema.parse(input)

    // The key is fully server-generated — the client's original filename is never used to build
    // it, which sidesteps path-traversal, collision and special-character concerns from
    // user-supplied filenames entirely, at the cost of not preserving the original filename.
    // UUIDv4 keys are also not practically guessable, which is what makes a public-GET-by-key
    // bucket (no public LIST) an acceptable access model here.
    const key = `${KEY_PREFIX[parsed.entityType]}/${randomUUID()}.${EXTENSION_BY_CONTENT_TYPE[parsed.contentType]}`

    const uploadUrl = await createPresignedUploadUrl(key, parsed.contentType)
    return okResult({ uploadUrl, publicUrl: buildPublicUrl(key) })
  } catch (err) {
    return toErrorResult(err, 'Could not prepare an upload. Please try again.')
  }
}
