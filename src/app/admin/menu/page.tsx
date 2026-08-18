import { getDishes } from './actions'
import { getInventoryItems } from '../inventory/actions'
import { MenuClient } from './MenuClient'

export default async function MenuPage() {
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
