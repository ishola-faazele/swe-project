import { prisma } from '@/lib/prisma'
import { CustomerMenuClient } from './CustomerMenuClient'

export default async function CustomerMenuPage() {
  const dishes = await prisma.dish.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { 
      ingredients: { include: { inventoryItem: true } },
      media: { orderBy: { position: 'asc' } }
    }
  })

  return <CustomerMenuClient initialData={dishes} />
}
