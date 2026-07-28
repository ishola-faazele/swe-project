import { getInventoryItems } from './actions'
import { InventoryClient } from './InventoryClient'

export default async function InventoryPage() {
  const items = await getInventoryItems()

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Inventory</h2>
      </div>
      <InventoryClient initialData={items} />
    </div>
  )
}
