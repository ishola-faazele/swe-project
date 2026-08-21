import { getDriverOrders } from './actions'
import { DriverClient } from './DriverClient'
import { authorizePage } from '@/lib/auth'
import { Role } from '@prisma/client'

export const metadata = {
  title: 'Deliveries | Chop with Rostty',
}

export default async function DriverPage() {
  const user = await authorizePage([Role.ADMIN, Role.DELIVERY_DRIVER])

  const orders = await getDriverOrders()

  return (
    <div className="space-y-4 max-w-2xl mx-auto h-[calc(100vh-64px)] flex flex-col">
      <div className="flex-shrink-0 pt-2 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Active Deliveries</h1>
        <p className="text-muted-foreground">{orders.length} order{orders.length !== 1 ? 's' : ''} ready</p>
      </div>
      <div className="flex-1 min-h-0">
        <DriverClient initialOrders={orders} />
      </div>
    </div>
  )
}
