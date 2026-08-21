import { getInventoryItems } from './actions'
import { InventoryClient } from './InventoryClient'
import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export default async function InventoryPage() {
  await authorizePage([Role.ADMIN, Role.KITCHEN_STAFF])
  // The one call site that opts into archived rows, so InventoryClient's "Show Archived" toggle
  // has data to reveal and restore. Every other caller keeps the active-only default.
  const items = await getInventoryItems({ includeArchived: true })

  // "N items tracked" should mean actively tracked — a retired item is still fetched (for the
  // reveal toggle) but must not inflate the headline count.
  const activeCount = items.filter(i => i.isActive).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Inventory
        </h1>
        <p className="meta-text mt-0.5">
          {activeCount} item{activeCount !== 1 ? 's' : ''} tracked
        </p>
      </div>
      <InventoryClient initialData={items} />
    </div>
  )
}
