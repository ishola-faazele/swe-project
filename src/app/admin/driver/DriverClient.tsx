"use client"

import { useState } from 'react'
import { Prisma } from '@prisma/client'
import dynamic from 'next/dynamic'
import { Check, MapPin, Phone, PackageOpen } from 'lucide-react'
import { completeDelivery } from './actions'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Dynamic import for react-leaflet component since it needs window
const MapComponent = dynamic(() => import('./MapComponent'), { ssr: false })

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { customer: true, dishes: true }
}>

function SlideToConfirm({ onConfirm, isLoading }: { onConfirm: () => void, isLoading: boolean }) {
  const [sliderValue, setSliderValue] = useState(0)

  const handleTouch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    setSliderValue(val)
    if (val > 95 && !isLoading) {
      setSliderValue(100)
      onConfirm()
    }
  }

  const handleRelease = () => {
    if (sliderValue < 95 && !isLoading) {
      setSliderValue(0)
    }
  }

  return (
    <div className="relative h-14 bg-card border border-border rounded-full overflow-hidden flex items-center shadow-inner @container">
      <div 
        className="absolute left-0 top-0 bottom-0 bg-primary/20 transition-all pointer-events-none" 
        style={{ width: `${sliderValue}%` }} 
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none font-semibold text-muted-foreground select-none">
        {isLoading ? 'Completing...' : 'Slide to Complete'}
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={isLoading ? 100 : sliderValue}
        onChange={handleTouch}
        onMouseUp={handleRelease}
        onTouchEnd={handleRelease}
        className="absolute inset-0 w-full opacity-0 cursor-ew-resize z-10 touch-none"
        disabled={isLoading}
      />
      <div 
        className="absolute left-1 h-12 w-12 bg-primary rounded-full flex items-center justify-center shadow transition-all pointer-events-none z-0"
        style={{ transform: `translateX(calc(${sliderValue / 100} * (100cqw - 56px)))` }}
      >
        <Check className="h-6 w-6 text-primary-foreground" />
      </div>
    </div>
  )
}

export function DriverClient({ initialOrders }: { initialOrders: OrderWithRelations[] }) {
  const [orders, setOrders] = useState<OrderWithRelations[]>(initialOrders)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(orders[0]?.id || null)
  const [isCompleting, setIsCompleting] = useState(false)
  const router = useRouter()

  const activeOrder = orders.find(o => o.id === activeOrderId)

  const handleComplete = async (orderId: string) => {
    setIsCompleting(true)
    try {
      const res = await completeDelivery(orderId)
      if (res.ok) {
        toast.add({ title: 'Delivered', description: 'Order marked as completed and SMS sent.', type: 'success' })
        setOrders(orders.filter(o => o.id !== orderId))
        const remaining = orders.filter(o => o.id !== orderId)
        if (remaining.length > 0) {
          setActiveOrderId(remaining[0].id)
        } else {
          setActiveOrderId(null)
        }
      }
    } catch (err) {
      toast.add({ title: 'Error', description: 'Failed to complete delivery', type: 'error' })
    } finally {
      setIsCompleting(false)
    }
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-card rounded-xl border border-border">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">All Caught Up!</h2>
        <p className="text-muted-foreground">There are no ready orders assigned for delivery right now.</p>
        <Button onClick={() => router.refresh()} variant="outline" className="mt-6">Refresh</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background md:flex-row gap-4">
      {/* Order List (Sidebar on desktop, horizontal scroll or hidden on mobile if map active) */}
      <div className={cn(
        "flex-shrink-0 md:w-80 flex flex-col gap-3 overflow-y-auto pb-4",
        activeOrder ? "hidden md:flex" : "flex w-full"
      )}>
        {orders.map(order => (
          <div 
            key={order.id}
            onClick={() => setActiveOrderId(order.id)}
            className={cn(
              "p-4 rounded-xl border cursor-pointer transition-colors",
              activeOrderId === order.id 
                ? "bg-primary/10 border-primary" 
                : "bg-card border-border hover:border-primary/50"
            )}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="font-mono-data font-bold text-lg text-primary">#{order.shortId}</span>
              <span className="text-xs font-medium bg-muted px-2 py-1 rounded-md">{order.dishes.length} items</span>
            </div>
            <p className="font-semibold">{order.customer.name || `#${order.customer.shortId}`}</p>
            {order.deliveryAddress ? (
              <p className="text-sm text-muted-foreground line-clamp-1 mt-1 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {order.deliveryAddress}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1 italic">No address provided</p>
            )}
          </div>
        ))}
      </div>

      {/* Active Order Detail & Map */}
      {activeOrder && (
        <div className="flex-1 flex flex-col min-h-0 bg-card rounded-xl border border-border overflow-hidden">
          {/* Mobile Back Button */}
          <div className="md:hidden p-4 border-b border-border bg-muted/30">
            <Button variant="ghost" size="sm" onClick={() => setActiveOrderId(null)} className="-ml-2">
              ← Back to List
            </Button>
          </div>

          <div className="flex-1 min-h-0 relative">
            <MapComponent address={activeOrder.deliveryAddress || ''} />
          </div>

          {/* Bottom Sheet Action Area */}
          <div className="p-5 border-t border-border bg-background flex flex-col gap-4 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.2)] z-10">
            <div>
              <div className="flex justify-between items-end mb-1">
                <h2 className="text-xl font-bold">Order #{activeOrder.shortId}</h2>
              </div>
              <p className="font-medium">{activeOrder.customer.name}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-muted/50 p-3 rounded-lg border border-border">
                <div className="text-muted-foreground flex items-center gap-1 mb-1"><MapPin className="h-4 w-4"/> Address</div>
                <div className="font-medium line-clamp-2">{activeOrder.deliveryAddress || 'None'}</div>
              </div>
              <div className="bg-muted/50 p-3 rounded-lg border border-border">
                <div className="text-muted-foreground flex items-center gap-1 mb-1"><Phone className="h-4 w-4"/> Phone</div>
                <div className="font-medium line-clamp-2 break-all">
                  {activeOrder.deliveryPhone || activeOrder.customer.phone ? (
                    <a href={`tel:${activeOrder.deliveryPhone || activeOrder.customer.phone}`} className="text-primary hover:underline">
                      {activeOrder.deliveryPhone || activeOrder.customer.phone}
                    </a>
                  ) : 'None'}
                </div>
              </div>
            </div>

            <div className="bg-muted/50 p-3 rounded-lg border border-border text-sm">
              <div className="text-muted-foreground flex items-center gap-1 mb-1"><PackageOpen className="h-4 w-4"/> Items</div>
              <div className="font-medium">{activeOrder.description || 'No description'}</div>
            </div>

            <div className="mt-2 @container">
              <SlideToConfirm 
                isLoading={isCompleting} 
                onConfirm={() => handleComplete(activeOrder.id)} 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
