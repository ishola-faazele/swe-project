/**
 * OTP code generation, hashing, and verification — channel-agnostic. Used by phone login
 * (src/app/login/actions.ts) AND by the customer-dashboard flow for adding a missing email or
 * phone to an already-authenticated account (src/app/dashboard/actions.ts). Neither this module
 * nor the OtpCode row it backs cares which channel a code was sent through or what it's meant to
 * verify — that's entirely up to the caller.
 *
 * Follows src/lib/phone.ts's and src/lib/recipe.ts's "no Prisma, no next/*" convention as far as
 * it can — this module needs node:crypto and one env var, but has zero Next.js or database
 * coupling, so it runs identically inside a Server Action and in a plain unit test.
 *
 * Codes are NEVER stored in plaintext. Only the HMAC digest reaches the database, so a database
 * dump cannot be replayed into a login. The real defenses against brute force are the short
 * expiry and the attempt cap, not the hashing scheme itself — a 6-digit code has a small enough
 * search space that hashing alone would not save it.
 */
import crypto from 'node:crypto'

export const OTP_LENGTH = 6
export const OTP_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes
export const OTP_COOLDOWN_MS = 60 * 1000 // one request per phone per 60s
// A sanity ceiling in the same spirit as MAX_INGREDIENT_LINES in validation.ts.
export const MAX_OTP_ATTEMPTS = 5

/**
 * A cryptographically-random, zero-padded numeric string of exactly OTP_LENGTH characters.
 *
 * padStart is load-bearing, not cosmetic: randomInt legitimately returns values below 100000
 * roughly 10% of the time, and without padding those would be delivered (and compared) as 5-digit
 * strings, quietly breaking any fixed-length assumption downstream.
 */
export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

export function hashOtpCode(code: string): string {
  const secret = process.env.OTP_HASH_SECRET
  if (!secret) {
    // Fail loud rather than silently hashing with an empty pepper — mirrors how every other
    // required secret in this codebase behaves when missing.
    throw new Error('OTP_HASH_SECRET is not configured')
  }
  return crypto.createHmac('sha256', secret).update(code).digest('hex')
}

/**
 * Timing-safe comparison of a submitted code against a stored digest.
 *
 * The length check before timingSafeEqual is required, not defensive style: timingSafeEqual
 * THROWS a RangeError on mismatched buffer lengths, and Buffer.from(x, 'hex') silently stops at
 * the first invalid character — so a truncated or corrupted stored hash would crash the verify
 * action instead of simply failing to match. && short-circuits, so timingSafeEqual is never
 * reached on a length mismatch. Same guard the WhatsApp webhook route already uses for its HMAC.
 */
export function verifyOtpCodeHash(code: string, storedHash: string): boolean {
  const expected = Buffer.from(hashOtpCode(code), 'hex')
  const actual = Buffer.from(storedHash, 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
