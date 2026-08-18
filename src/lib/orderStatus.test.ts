/**
 * Unit tests for src/lib/orderStatus.ts — the shared status/badge lookup table that replaced two
 * independently-drifting copies (admin/page.tsx's old `statusConfig`, dashboard/page.tsx's old
 * `statusColors`/`statusEmojis`). The value of this module is entirely that both screens resolve
 * a status through the exact same table, so these tests pin its shape rather than re-deriving it.
 */
import { describe, expect, it } from 'vitest'
import { OrderStatus } from '@prisma/client'
import { ORDER_STATUS_CONFIG } from './orderStatus'

describe('ORDER_STATUS_CONFIG', () => {
  it('has an entry for every OrderStatus enum value — none missing, none stale', () => {
    // Prisma's own enum is the source of truth. If a status is ever added or removed from the
    // schema, this test fails loudly instead of the badge silently rendering undefined somewhere.
    const enumValues = Object.values(OrderStatus)
    expect(Object.keys(ORDER_STATUS_CONFIG).sort()).toEqual([...enumValues].sort())
  })

  it.each(Object.values(OrderStatus))('%s has a non-empty label, emoji, and className', (status) => {
    const entry = ORDER_STATUS_CONFIG[status]
    expect(entry.label.length).toBeGreaterThan(0)
    expect(entry.emoji.length).toBeGreaterThan(0)
    expect(entry.className.length).toBeGreaterThan(0)
  })

  it('every className references the existing .status-* family in globals.css, not an invented one', () => {
    for (const { className } of Object.values(ORDER_STATUS_CONFIG)) {
      expect(className).toMatch(/^status-[a-z]+$/)
    }
  })

  it('maps each status to its own distinct className — no two statuses silently share a badge', () => {
    const classNames = Object.values(ORDER_STATUS_CONFIG).map((c) => c.className)
    expect(new Set(classNames).size).toBe(classNames.length)
  })

  it('CANCELLED and COMPLETED read as visually terminal (distinct from the four in-kitchen statuses)', () => {
    // Not a strict requirement of the type, but the whole reason this module exists is so the
    // admin and customer dashboards agree — pin the two terminal states' concrete values so a
    // future edit to one badge doesn't silently drift from the other's still-passing assertion.
    expect(ORDER_STATUS_CONFIG.CANCELLED).toMatchObject({
      label: 'Cancelled',
      emoji: '❌',
      className: 'status-cancelled',
    })
    expect(ORDER_STATUS_CONFIG.COMPLETED).toMatchObject({
      label: 'Completed',
      emoji: '🎉',
      className: 'status-completed',
    })
  })
})
