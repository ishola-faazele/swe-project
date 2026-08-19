/**
 * Ghana phone-number normalization for outbound notifications.
 *
 * Deliberately pure — no Prisma, no `next/*`, no I/O — following the same convention as
 * `src/lib/recipe.ts`, so the same function can run inside a server action, a sender module,
 * or a plain unit test with no database and no Next.js runtime.
 */

/**
 * Normalizes a Ghanaian phone number to the bare E.164 digit string both WhatsApp Cloud API's
 * `to` field and Arkesel v1's `to` query parameter expect (e.g. "233241234567" — no leading '+').
 * Returns null for anything that doesn't resolve to a plausible Ghanaian mobile number, so
 * callers can no-op cleanly per channel instead of sending a malformed destination to either API.
 * Outbound-formatting only — never mutates User.phone as stored in the database.
 */
export function toGhanaE164(raw: string | null | undefined): string | null {
  if (!raw) return null

  const digitsOnly = raw.trim().replace(/[^\d+]/g, '')

  let normalized: string
  if (digitsOnly.startsWith('+233')) {
    normalized = digitsOnly.slice(1)
  } else if (digitsOnly.startsWith('233')) {
    normalized = digitsOnly
  } else if (digitsOnly.startsWith('0')) {
    normalized = '233' + digitsOnly.slice(1)
  } else {
    return null // unrecognized prefix (e.g. a non-Ghana country code) — don't guess
  }

  // Ghanaian mobile numbers: '233' + 9 digits = 12 digits total.
  if (!/^233\d{9}$/.test(normalized)) return null

  return normalized
}
