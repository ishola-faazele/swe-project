import { Prisma } from '@prisma/client'
import { z } from 'zod'

export type ActionErrorCode =
  | 'VALIDATION'
  | 'INSUFFICIENT_STOCK'
  | 'NOT_FOUND'
  | 'FK_CONSTRAINT'
  | 'INVALID_TRANSITION'
  | 'UNKNOWN'

/**
 * Internal control-flow error for "expected" business failures. Thrown deliberately inside
 * business logic (often inside a prisma.$transaction callback, to trigger an automatic
 * rollback) and always caught at the top of the exported action before it can escape to the
 * client — see toErrorResult(). Never let this cross the 'use server' boundary unconverted.
 */
export class ActionError extends Error {
  constructor(message: string, public code: ActionErrorCode = 'UNKNOWN') {
    super(message)
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionErrorCode }

export function okResult<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

/** Converts a caught error into the client-facing ActionResult failure shape. */
export function toErrorResult(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof ActionError) {
    return { ok: false, error: err.message, code: err.code }
  }
  if (err instanceof z.ZodError) {
    return { ok: false, error: err.issues[0]?.message ?? 'Invalid input.', code: 'VALIDATION' }
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Unique constraint violation. User.email and User.phone are both @unique, so this is
      // the common "re-entered an existing customer" mistake. Deliberately generic about which
      // field collided — err.meta.target would leak raw column names (e.g. "User_email_key")
      // to the browser. Reuses VALIDATION because, like a zod failure, the caller fixes it by
      // editing their input.
      return {
        ok: false,
        error: 'A customer with that email or phone number already exists.',
        code: 'VALIDATION',
      }
    }
    if (err.code === 'P2003') {
      return {
        ok: false,
        error: 'This record is still referenced by other data and cannot be deleted.',
        code: 'FK_CONSTRAINT',
      }
    }
    if (err.code === 'P2025') {
      return {
        ok: false,
        error: 'That record no longer exists. It may have already been deleted.',
        code: 'NOT_FOUND',
      }
    }
  }
  // Genuinely unexpected: log server-side for diagnosis, never leak raw internals to the browser.
  console.error(err)
  return { ok: false, error: fallback, code: 'UNKNOWN' }
}
