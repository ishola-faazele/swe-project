import { getOrders } from './actions'
import { getCustomers } from '../customers/actions'
import { getInventoryItems } from '../inventory/actions'
import { getDishes } from '../menu/actions'
import { OrderClient } from './OrderClient'

import { getCurrentDbUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function OrdersPage() {
  const [orders, customers, inventory, dishes, user] = await Promise.all([
    getOrders(),
    getCustomers(),
    getInventoryItems(),
    getDishes(),
    getCurrentDbUser()
  ])

  if (user?.role === 'DELIVERY_DRIVER') {
    redirect('/admin/driver')
  }

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
