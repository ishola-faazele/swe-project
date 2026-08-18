import { getInventoryItems } from './actions'
import { InventoryClient } from './InventoryClient'

export default async function InventoryPage() {
  const items = await getInventoryItems()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Inventory
        </h1>
        <p className="meta-text mt-0.5">
          {items.length} item{items.length !== 1 ? 's' : ''} tracked
        </p>
      </div>
      <InventoryClient initialData={items} />
    </div>
  )
}
