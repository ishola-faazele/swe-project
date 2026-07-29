import { prisma } from '@/lib/prisma'
import { getInventoryItems } from '../../inventory/actions'
import { OrderDetailsClient } from './OrderDetailsClient'
import { notFound } from 'next/navigation'

export default async function OrderDetailsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      ingredientLogs: {
        include: {
          inventoryItem: true
        }
      }
    }
  })

  if (!order) {
    notFound()
  }

  const inventory = await getInventoryItems()

  return (
    <div className="flex-1 space-y-4 p-8 pt-6 max-w-4xl mx-auto">
      <OrderDetailsClient order={order} inventory={inventory} />
    </div>
  )
}
