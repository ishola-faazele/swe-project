import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { getInventoryItems } from '../../inventory/actions'
import { DishDetailsClient } from './DishDetailsClient'

export default async function DishDetailsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params

  // A route-specific direct fetch rather than reusing getDishes(), matching the
  // admin/orders/[id]/page.tsx precedent. The media include mirrors getDishes()'s own.
  const dish = await prisma.dish.findUnique({
    where: { id: params.id },
    include: {
      ingredients: {
        include: {
          inventoryItem: true
        }
      },
      media: {
        orderBy: { position: 'asc' }
      }
    }
  })

  if (!dish) {
    notFound()
  }

  const inventory = await getInventoryItems()

  return (
    <div className="flex-1 space-y-6 p-8 pt-6 max-w-4xl mx-auto">
      <DishDetailsClient dish={dish} inventory={inventory} />
    </div>
  )
}
