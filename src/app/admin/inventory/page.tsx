import { getInventoryItems } from './actions'
import { InventoryClient } from './InventoryClient'

export default async function InventoryPage() {
  const items = await getInventoryItems()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'oklch(0.93 0.008 65)' }}>
          Inventory
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'oklch(0.45 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
          {items.length} item{items.length !== 1 ? 's' : ''} tracked
        </p>
      </div>
      <InventoryClient initialData={items} />
    </div>
  )
}
