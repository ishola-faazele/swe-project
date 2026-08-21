import { getOrders } from './actions'
import { getCustomers } from '../customers/actions'
import { getInventoryItems } from '../inventory/actions'
import { getDishes } from '../menu/actions'
import { OrderClient } from './OrderClient'

import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export default async function OrdersPage() {
  const user = await authorizePage([Role.ADMIN, Role.KITCHEN_STAFF])
  
  const [orders, customers, inventory, dishes] = await Promise.all([
    getOrders(),
    getCustomers(),
    getInventoryItems(),
    getDishes(),
  ])
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Orders</h1>
        <p className="meta-text mt-0.5">
          {orders.length} order{orders.length !== 1 ? 's' : ''} on record
        </p>
      </div>
      <OrderClient initialData={orders} customers={customers} inventory={inventory} dishes={dishes} userRole={user?.role} />
    </div>
  )
}
