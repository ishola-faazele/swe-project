/**
 * Due-date urgency — pure, timezone-pinned, no Prisma and no `next/*` imports
 * (same discipline as `src/lib/recipe.ts`), so the identical function runs in a
 * Server Component, a Server Action, and the browser.
 *
 * Comparison is DATE-GRANULAR, not timestamp-granular: an order due "today" is
 * due today all day, not overdue from 00:01 onward. The calendar day is pinned
 * to Africa/Lagos (WAT, UTC+1, no DST) rather than the host's ambient timezone,
 * because the kitchen's "today" is Lagos's today regardless of where the server
 * happens to run.
 *
 * ⚠️ Any future CLIENT-side call site must pass an explicit, server-sourced
 * `now`. Never let a Client Component's render body call `new Date()` for this:
 * near the Lagos midnight boundary a client-evaluated `now` can disagree with
 * the server-rendered value by a full calendar day, which both produces a
 * hydration mismatch and flips an order's urgency badge.
 */

import type { OrderStatus } from "@prisma/client"

const BUSINESS_TIMEZONE = "Africa/Lagos" // WAT, UTC+1, no DST

// en-CA formats as YYYY-MM-DD, which sorts correctly under plain string comparison.
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function toBusinessDateKey(date: Date): string {
  return dateKeyFormatter.format(date)
}

export type DueUrgency = "overdue" | "due-today" | "upcoming" | "none"

/**
 * The single source of truth for "this order is still in the kitchen's queue."
 * Reused verbatim in the dashboard's Prisma `where` clause and in the orders
 * table's row highlighting, so the two can never drift apart.
 */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["PENDING", "PREPPING", "COOKING", "READY"]

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return (ACTIVE_ORDER_STATUSES as string[]).includes(status)
}

/**
 * Resolves a due date into an urgency bucket, relative to `now` in Lagos time.
 *
 * Returns "none" for a missing or unparseable date — this must never throw, as
 * it is called inline during render for every row of the orders table.
 */
export function getDueUrgency(
  dueDate: Date | string | null | undefined,
  now: Date = new Date()
): DueUrgency {
  if (!dueDate) return "none"

  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  if (Number.isNaN(due.getTime())) return "none"

  const dueKey = toBusinessDateKey(due)
  const todayKey = toBusinessDateKey(now)

  if (dueKey < todayKey) return "overdue"
  if (dueKey === todayKey) return "due-today"
  return "upcoming"
}
