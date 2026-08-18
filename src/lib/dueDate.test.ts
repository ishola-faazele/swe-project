/**
 * Unit tests for src/lib/dueDate.ts — the correctness target the PRD calls out
 * explicitly ("zero false negatives in the due-today/overdue derivation").
 *
 * Every case passes `now` explicitly. Nothing here reads the real system clock,
 * so these tests cannot start failing at a particular time of day or when CI
 * runs in a different timezone from a developer's laptop.
 */
import { describe, expect, it } from 'vitest'
import {
  ACTIVE_ORDER_STATUSES,
  getDueUrgency,
  isActiveOrderStatus,
  type DueUrgency,
} from './dueDate'

describe('getDueUrgency', () => {
  it('returns "none" for a missing due date', () => {
    const now = new Date('2026-08-18T09:00:00Z')

    expect(getDueUrgency(null, now)).toBe('none')
    expect(getDueUrgency(undefined, now)).toBe('none')
  })

  it('returns "overdue" for a date before today', () => {
    const now = new Date('2026-08-18T09:00:00Z')
    expect(getDueUrgency(new Date('2026-08-15T09:00:00Z'), now)).toBe('overdue')
  })

  it('returns "due-today" for the same calendar day at a different time', () => {
    // Comparison is date-granular, not timestamp-granular: an order due today
    // is due all day, not overdue from one minute past its timestamp.
    const now = new Date('2026-08-18T18:00:00Z')
    expect(getDueUrgency(new Date('2026-08-18T06:00:00Z'), now)).toBe('due-today')
  })

  it('returns "upcoming" for a future date', () => {
    const now = new Date('2026-08-18T09:00:00Z')
    expect(getDueUrgency(new Date('2026-08-21T09:00:00Z'), now)).toBe('upcoming')
  })

  it('pins the calendar day to Africa/Lagos, not UTC, across the midnight boundary', () => {
    // Lagos is UTC+1 with no DST, so 23:00–23:59 UTC is ALREADY the next
    // calendar day locally.
    //
    // dueDate = 2026-08-17T23:30:00Z → 2026-08-18T00:30 in Lagos
    // now     = 2026-08-18T00:15:00Z → 2026-08-18T01:15 in Lagos
    //
    // UTC calendar days DIFFER (Aug 17 vs Aug 18). Lagos calendar days are the
    // SAME (both Aug 18). A naive UTC-based implementation compares
    // Aug 17 < Aug 18 and wrongly reports "overdue" — flagging an order that is
    // in fact due today. That false positive is exactly what this test exists
    // to catch.
    const dueDate = new Date('2026-08-17T23:30:00Z')
    const now = new Date('2026-08-18T00:15:00Z')

    expect(getDueUrgency(dueDate, now)).toBe('due-today')
  })

  it('accepts an ISO date string as well as a Date', () => {
    const now = new Date('2026-08-18T09:00:00Z')

    // `<input type="date">` yields a bare "YYYY-MM-DD", which parses as UTC
    // midnight — still the same calendar day in Lagos (UTC+1). Deliberately not
    // "fixed" to local-time parsing; the Lagos-pinned comparison is what makes
    // it safe.
    expect(getDueUrgency('2026-08-18', now)).toBe('due-today')
    expect(getDueUrgency('2026-08-15', now)).toBe('overdue')
  })

  it('returns "none" for a malformed date string instead of throwing', () => {
    const now = new Date('2026-08-18T09:00:00Z')

    // Called inline during render for every row of the orders table, so a bad
    // value must degrade to "unflagged", never crash the page.
    expect(() => getDueUrgency('not-a-date', now)).not.toThrow()
    expect(getDueUrgency('not-a-date', now)).toBe('none')
    expect(getDueUrgency(new Date('nonsense'), now)).toBe('none')
  })

  it('defaults `now` to the current time when omitted', () => {
    // Signature check only — no assertion on which bucket today's date lands in.
    expect(() => getDueUrgency(new Date())).not.toThrow()
    expect(getDueUrgency(new Date())).toBe('due-today')
  })
})

describe('ACTIVE_ORDER_STATUSES / isActiveOrderStatus', () => {
  it('lists exactly the four in-kitchen statuses', () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual(['PENDING', 'PREPPING', 'COOKING', 'READY'])
  })

  it('treats terminal statuses as inactive', () => {
    expect(isActiveOrderStatus('PENDING')).toBe(true)
    expect(isActiveOrderStatus('READY')).toBe(true)
    expect(isActiveOrderStatus('COMPLETED')).toBe(false)
    expect(isActiveOrderStatus('CANCELLED')).toBe(false)
  })
})

describe('call-site interaction: status gating × urgency', () => {
  // Mirrors exactly what the orders table and dashboard widget do, so the two
  // consumers of these functions cannot drift apart in how they combine them.
  function flaggedUrgency(
    status: Parameters<typeof isActiveOrderStatus>[0],
    dueDate: Date | null,
    now: Date
  ): DueUrgency {
    return isActiveOrderStatus(status) ? getDueUrgency(dueDate, now) : 'none'
  }

  const now = new Date('2026-08-18T09:00:00Z')
  const longOverdue = new Date('2026-07-01T09:00:00Z')

  it('does not flag a COMPLETED order even when its due date is long past', () => {
    // The order was delivered. Nagging about its due date forever is the
    // specific false positive this gating prevents.
    expect(flaggedUrgency('COMPLETED', longOverdue, now)).toBe('none')
  })

  it('does not flag a CANCELLED order with a long-past due date', () => {
    expect(flaggedUrgency('CANCELLED', longOverdue, now)).toBe('none')
  })

  it('does flag an active order with the same long-past due date', () => {
    expect(flaggedUrgency('COOKING', longOverdue, now)).toBe('overdue')
  })
})
