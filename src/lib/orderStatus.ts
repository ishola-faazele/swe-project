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
 *
 * `icon` is a Lucide React component — render it as <cfg.icon className="h-3 w-3"
 * aria-hidden="true" /> at each call site. Lucide is tree-shaken at build time
 * so only the icons actually imported are bundled.
 */

import type { OrderStatus } from "@prisma/client"
import type { LucideIcon } from "lucide-react"
import {
  Clock,
  Scissors,
  Flame,
  CheckCircle2,
  PackageCheck,
  XCircle,
} from "lucide-react"

export const ORDER_STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  PENDING:   { label: "Pending",   icon: Clock,         className: "status-pending"   },
  PREPPING:  { label: "Prepping",  icon: Scissors,      className: "status-prepping"  },
  COOKING:   { label: "Cooking",   icon: Flame,         className: "status-cooking"   },
  READY:     { label: "Ready",     icon: CheckCircle2,  className: "status-ready"     },
  COMPLETED: { label: "Completed", icon: PackageCheck,  className: "status-completed" },
  CANCELLED: { label: "Cancelled", icon: XCircle,       className: "status-cancelled" },
}
