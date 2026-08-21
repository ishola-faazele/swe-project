import { getDishes } from './actions'
import { getInventoryItems } from '../inventory/actions'
import { MenuClient } from './MenuClient'
import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export default async function MenuPage() {
  await authorizePage([Role.ADMIN, Role.KITCHEN_STAFF])
  const [dishes, inventory] = await Promise.all([
    getDishes(),
    getInventoryItems()
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Menu
        </h1>
        <p className="meta-text mt-0.5">
          {dishes.length} dish{dishes.length !== 1 ? 'es' : ''} on the menu
        </p>
      </div>
      <MenuClient initialData={dishes} inventory={inventory} />
    </div>
  )
}
