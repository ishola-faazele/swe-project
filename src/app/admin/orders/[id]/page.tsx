import { prisma } from '@/lib/prisma'
import { getInventoryItems } from '../../inventory/actions'
import { getDishes } from '../../menu/actions'
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
      },
      // This order's own dish line items — dishName/unitPrice are snapshots, so no join is
      // needed to render them. Legacy orders simply come back with an empty array.
      dishes: true
    }
  })

  if (!order) {
    notFound()
  }

  // Separate from order.dishes: the full catalog backing the "add a dish" picker.
  const [inventory, dishes] = await Promise.all([
    getInventoryItems(),
    getDishes()
  ])

  return (
    <div className="flex-1 space-y-4 p-8 pt-6 max-w-4xl mx-auto">
      <OrderDetailsClient order={order} inventory={inventory} dishes={dishes} />
    </div>
  )
}
