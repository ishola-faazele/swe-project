import { getOrders } from './actions'
import { getCustomers } from '../customers/actions'
import { getInventoryItems } from '../inventory/actions'
import { OrderClient } from './OrderClient'

export default async function OrdersPage() {
  const [orders, customers, inventory] = await Promise.all([
    getOrders(),
    getCustomers(),
    getInventoryItems()
  ])

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Orders</h2>
      </div>
      <OrderClient initialData={orders} customers={customers} inventory={inventory} />
    </div>
  )
}
