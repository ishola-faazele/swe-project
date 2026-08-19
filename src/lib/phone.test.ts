/**
 * Unit tests for src/lib/phone.ts — the Ghana → E.164 normalizer every SMS and WhatsApp send
 * depends on to avoid handing a malformed destination to either provider. Pure function, no
 * mocks, no I/O: table-driven cases only.
 */
import { describe, expect, it } from 'vitest'
import { toGhanaE164 } from './phone'

describe('toGhanaE164', () => {
  describe('accepts and normalizes real Ghanaian shapes', () => {
    const accepted: [label: string, input: string, expected: string][] = [
      ['local 0-prefixed', '0241234567', '233241234567'],
      ['international +233', '+233241234567', '233241234567'],
      ['bare 233 (already normalized)', '233241234567', '233241234567'],
      ['local with spaces', '024 123 4567', '233241234567'],
      ['local with dashes', '024-123-4567', '233241234567'],
      ['+233 with spaces', '+233 24 123 4567', '233241234567'],
      ['local with parentheses', '(024) 123-4567', '233241234567'],
      ['surrounding whitespace', '  0241234567  ', '233241234567'],
      ['a different Ghanaian network prefix', '0501234567', '233501234567'],
    ]

    it.each(accepted)('%s: %s → %s', (_label, input, expected) => {
      expect(toGhanaE164(input)).toBe(expected)
    })

    it('strips the leading + rather than preserving it — both APIs want bare digits', () => {
      expect(toGhanaE164('+233241234567')).not.toContain('+')
    })
  })

  describe('rejects anything that is not a plausible Ghanaian mobile number', () => {
    const rejected: [label: string, input: string][] = [
      // The case that matters most against this repo's own seed data: prisma/seed.ts's fixture
      // customers carry Nigerian (+234) numbers. Guessing a Ghana number out of one would send a
      // real message to a real stranger's phone, so a non-233 country code must return null.
      ['Nigerian country code (matches this repo seed data)', '+2348012345678'],
      ['bare Nigerian country code', '2348012345678'],
      ['UK country code', '+447911123456'],
      ['US country code', '+14155552671'],
      ['too short local', '024123'],
      ['too short +233', '+2332412'],
      ['too long local', '02412345678901'],
      ['too long 233', '2332412345678901'],
      ['letters only', 'not-a-phone'],
      ['no recognizable prefix', '99887766'],
      ['punctuation only', '---'],
      ['a lone plus', '+'],
    ]

    it.each(rejected)('%s: %s → null', (_label, input) => {
      expect(toGhanaE164(input)).toBeNull()
    })
  })

  describe('nullish and empty input never throws', () => {
    it('returns null for null', () => {
      expect(toGhanaE164(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(toGhanaE164(undefined)).toBeNull()
    })

    it('returns null for an empty string', () => {
      expect(toGhanaE164('')).toBeNull()
    })

    it('returns null for a whitespace-only string', () => {
      expect(toGhanaE164('   ')).toBeNull()
    })
  })
})
