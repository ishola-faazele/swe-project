"use client"

import { useMemo, useState } from "react"
import { UtensilsCrossed, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { MediaCarousel } from "@/components/ui/media-carousel"
import { formatCurrency } from "@/lib/currency"

type CustomerDish = any // I will use any or infer it, wait, let's type it properly.

export function CustomerMenuClient({ initialData }: { initialData: any[] }) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [sort, setSort] = useState<'name-asc' | 'name-desc' | 'price-asc' | 'price-desc'>('name-asc')

  const filtered = useMemo(() => {
    let result = initialData.filter(d => d.name.toLowerCase().includes(globalFilter.toLowerCase()))
    
    result.sort((a, b) => {
      switch (sort) {
        case 'name-asc': return a.name.localeCompare(b.name)
        case 'name-desc': return b.name.localeCompare(a.name)
        case 'price-asc': return a.price - b.price
        case 'price-desc': return b.price - a.price
        default: return 0
      }
    })

    return result
  }, [initialData, globalFilter, sort])

  return (
    <div className="flex-1 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Our Menu</h1>
          <p className="text-muted-foreground mt-1">
            Explore our delicious offerings. Place your order by calling or messaging us on WhatsApp.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search menu..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="w-full sm:w-64 pl-9 bg-card"
            />
          </div>
          <select
            className="select-field h-9 text-sm min-w-[160px]"
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
          >
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="price-asc">Price (Low to High)</option>
            <option value="price-desc">Price (High to Low)</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="empty-state-title">No dishes found</p>
            <p className="empty-state-hint">
              {initialData.length === 0 
                ? "Check back later for new additions to our menu." 
                : "Try adjusting your search criteria."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filtered.map((dish) => (
            <div key={dish.id} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
              <div className="relative aspect-[4/3] w-full bg-muted overflow-hidden">
                <MediaCarousel media={dish.media} />
              </div>
              
              <div className="flex flex-1 flex-col p-4">
                <div className="flex justify-between items-start gap-3">
                  <h3 className="font-semibold text-base leading-tight line-clamp-2">{dish.name}</h3>
                  <span className="shrink-0 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold font-mono-data">
                    {formatCurrency(dish.price)}
                  </span>
                </div>
                
                {dish.ingredients.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Contains</p>
                    <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                      {dish.ingredients.map((i: any) => i.inventoryItem.name).join(', ')}
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
