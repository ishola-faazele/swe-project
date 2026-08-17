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
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'oklch(0.93 0.008 65)' }}>
          Menu
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'oklch(0.45 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
          {dishes.length} dish{dishes.length !== 1 ? 'es' : ''} on the menu
        </p>
      </div>
      <MenuClient initialData={dishes} inventory={inventory} />
    </div>
  )
}
