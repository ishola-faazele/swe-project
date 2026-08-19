/**
 * Unit tests for src/lib/otp.ts — code generation and hashing.
 *
 * Pure module, no database or network. OTP_HASH_SECRET is stubbed explicitly in every case: the
 * repo's real `.env` now sets it (vitest.config.mts's `node` project loads it via dotenv/config),
 * so the "unset" case would silently pass for the wrong reason if it relied on ambient absence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import {
  MAX_OTP_ATTEMPTS,
  OTP_COOLDOWN_MS,
  OTP_EXPIRY_MS,
  OTP_LENGTH,
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
} from './otp'

const TEST_SECRET = 'test-otp-pepper-NEVER-LOG-ME'

beforeEach(() => {
  vi.stubEnv('OTP_HASH_SECRET', TEST_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('constants', () => {
  it('match the values the login flow and its copy are written against', () => {
    expect(OTP_LENGTH).toBe(6)
    expect(OTP_EXPIRY_MS).toBe(10 * 60 * 1000)
    expect(OTP_COOLDOWN_MS).toBe(60 * 1000)
    expect(MAX_OTP_ATTEMPTS).toBe(5)
  })
})

describe('generateOtpCode', () => {
  it('produces a 6-character numeric string across many samples', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtpCode()
      expect(code).toMatch(/^\d{6}$/)
      expect(code).toHaveLength(OTP_LENGTH)
    }
  })

  // The padStart regression. randomInt legitimately returns values below 100000 about 10% of the
  // time; unpadded those would be delivered as 5-digit codes.
  it('zero-pads a randomly-generated value below 100000 instead of emitting a short code', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(crypto, 'randomInt').mockReturnValue(42 as any)

    expect(generateOtpCode()).toBe('000042')
  })

  it('pads a zero value to all zeroes rather than a single character', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(crypto, 'randomInt').mockReturnValue(0 as any)

    expect(generateOtpCode()).toBe('000000')
  })

  it('does not always return the same code', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('hashOtpCode', () => {
  it('returns a hex SHA-256 digest, never the code itself', () => {
    const hash = hashOtpCode('123456')

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('123456')
  })

  it('is deterministic for the same code and secret', () => {
    expect(hashOtpCode('123456')).toBe(hashOtpCode('123456'))
  })

  it('produces different digests for different codes', () => {
    expect(hashOtpCode('123456')).not.toBe(hashOtpCode('123457'))
  })

  // Rotating the pepper invalidating every outstanding code is a documented, accepted side effect.
  it('produces a different digest under a different secret', () => {
    const before = hashOtpCode('123456')
    vi.stubEnv('OTP_HASH_SECRET', 'a-rotated-pepper')

    expect(hashOtpCode('123456')).not.toBe(before)
  })

  it('throws a clear error when OTP_HASH_SECRET is unset', () => {
    vi.stubEnv('OTP_HASH_SECRET', '')

    expect(() => hashOtpCode('123456')).toThrow('OTP_HASH_SECRET is not configured')
  })
})

describe('verifyOtpCodeHash', () => {
  it('round-trips a real code', () => {
    const code = generateOtpCode()

    expect(verifyOtpCodeHash(code, hashOtpCode(code))).toBe(true)
  })

  it('rejects a wrong code of the same length', () => {
    expect(verifyOtpCodeHash('123456', hashOtpCode('654321'))).toBe(false)
  })

  // The timingSafeEqual length-guard regression. Without the length check short-circuiting first,
  // each of these throws a RangeError and takes the verify action down with a raw 500.
  describe('mismatched-length stored hashes return false rather than throwing', () => {
    const malformed: [label: string, storedHash: string][] = [
      ['truncated hex', 'abc123'],
      ['empty string', ''],
      ['odd-length hex', 'abc'],
      ['non-hex characters', 'z'.repeat(64)],
      ['far too long', 'a'.repeat(200)],
      ['whitespace', '   '],
    ]

    it.each(malformed)('%s → returns false, does not throw', (_label, storedHash) => {
      expect(() => verifyOtpCodeHash('123456', storedHash)).not.toThrow()
      expect(verifyOtpCodeHash('123456', storedHash)).toBe(false)
    })
  })

  it('rejects a same-length but wrong digest — the case timingSafeEqual exists for', () => {
    expect(verifyOtpCodeHash('123456', 'a'.repeat(64))).toBe(false)
  })
})
