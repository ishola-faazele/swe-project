import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/currency'
import { UtensilsCrossed } from 'lucide-react'

export default async function CustomerMenuPage() {
  const dishes = await prisma.dish.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { ingredients: { include: { inventoryItem: true } } }
  })

  return (
    <div className="flex-1 space-y-6">
      <div>
        <h1 className="page-title">Our Menu</h1>
        <p className="text-muted-foreground mt-1">
          Explore our delicious offerings. Place your order by calling or messaging us on WhatsApp.
        </p>
      </div>

      {dishes.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="empty-state-title">Menu is currently empty</p>
            <p className="empty-state-hint">
              Check back later for new additions to our menu.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dishes.map((dish) => (
            <div key={dish.id} className="rounded-xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col">
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-lg">{dish.name}</h3>
                  <span className="bg-primary/10 text-primary px-2 py-1 rounded text-sm font-bold font-mono-data">
                    {formatCurrency(dish.price)}
                  </span>
                </div>
                
                {dish.ingredients.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contains</p>
                    <p className="text-sm text-foreground/80 line-clamp-3">
                      {dish.ingredients.map(i => i.inventoryItem.name).join(', ')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
