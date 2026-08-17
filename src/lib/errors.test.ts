/**
 * Unit tests for toErrorResult()'s branch mapping — TEST-003.
 *
 * Pure logic, no real database or network. Confirms every recognized error type maps to the
 * correct ActionResult shape, and critically that the fallback/UNKNOWN branch never leaks the
 * original error's message to the client (see docs/tasks-integrity-hardening.md TEST-003).
 */
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { ActionError, toErrorResult } from '@/lib/errors'

function zodErrorFrom(schema: z.ZodTypeAny, input: unknown): z.ZodError {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('test setup error: expected schema.safeParse to fail')
  return result.error
}

function prismaError(code: string, message = 'Prisma error'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' })
}

describe('toErrorResult', () => {
  test('passes an ActionError through with its own message and code', () => {
    const err = new ActionError('Not enough "Rice" in stock: have 2 kg, need 5.', 'INSUFFICIENT_STOCK')

    const result = toErrorResult(err, 'fallback message')

    expect(result).toEqual({
      ok: false,
      error: 'Not enough "Rice" in stock: have 2 kg, need 5.',
      code: 'INSUFFICIENT_STOCK',
    })
  })

  test('maps a ZodError to code: VALIDATION using the first issue message', () => {
    const schema = z.object({ name: z.string().min(1, 'Name is required.') })
    const err = zodErrorFrom(schema, { name: '' })

    const result = toErrorResult(err, 'fallback message')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    if (!result.ok) expect(result.error).toBe('Name is required.')
  })

  test('maps PrismaClientKnownRequestError P2003 to code: FK_CONSTRAINT', () => {
    const err = prismaError('P2003')

    const result = toErrorResult(err, 'fallback message')

    expect(result).toMatchObject({
      ok: false,
      code: 'FK_CONSTRAINT',
      error: 'This record is still referenced by other data and cannot be deleted.',
    })
  })

  test('maps PrismaClientKnownRequestError P2025 to code: NOT_FOUND', () => {
    const err = prismaError('P2025')

    const result = toErrorResult(err, 'fallback message')

    expect(result).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
      error: 'That record no longer exists. It may have already been deleted.',
    })
  })

  test('maps PrismaClientKnownRequestError P2002 to code: VALIDATION with the duplicate-contact message', () => {
    const err = prismaError('P2002')

    const result = toErrorResult(err, 'fallback message')

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      error: 'A customer with that email or phone number already exists.',
    })
  })

  test('maps an arbitrary unknown error to code: UNKNOWN with the fallback string, never leaking the original message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const err = new Error('secret internal detail')
    const result = toErrorResult(err, 'Could not complete this action. Please try again.')

    expect(result).toEqual({
      ok: false,
      code: 'UNKNOWN',
      error: 'Could not complete this action. Please try again.',
    })
    if (!result.ok) expect(result.error).not.toContain('secret internal detail')

    // Server-side diagnosis still happens — just never surfaced to the client.
    expect(consoleErrorSpy).toHaveBeenCalledWith(err)

    consoleErrorSpy.mockRestore()
  })
})
