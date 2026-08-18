/**
 * Order-status display metadata — one lookup table, shared by every screen that
 * renders a status badge.
 *
 * This previously existed as two independent copies (`admin/page.tsx`'s
 * `statusConfig` and `dashboard/page.tsx`'s `statusColors`/`statusEmojis`) that
 * could silently drift; the customer portal's copy had in fact already drifted
 * to light-mode pastels on an otherwise-dark app. Importing from here means the
 * customer sees literally the same badge the admin does, not a lookalike.
 *
 * Pure — no Prisma client, no `next/*` (only the `OrderStatus` *type*), same
 * discipline as `src/lib/recipe.ts`. The `className` values are the `.status-*`
 * classes that already exist in `globals.css`; no new CSS is introduced here.
 */

import type { OrderStatus } from "@prisma/client"

export const ORDER_STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; emoji: string; className: string }
> = {
  PENDING: { label: "Pending", emoji: "⏳", className: "status-pending" },
  PREPPING: { label: "Prepping", emoji: "🔪", className: "status-prepping" },
  COOKING: { label: "Cooking", emoji: "🍳", className: "status-cooking" },
  READY: { label: "Ready", emoji: "✅", className: "status-ready" },
  COMPLETED: { label: "Completed", emoji: "🎉", className: "status-completed" },
  CANCELLED: { label: "Cancelled", emoji: "❌", className: "status-cancelled" },
}
