import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getCurrentDbUser } from '@/lib/auth'
import { BUSINESS_LOCALE, formatCurrency } from '@/lib/currency'
import { ORDER_STATUS_CONFIG } from '@/lib/orderStatus'
import { Inbox, Package, ShoppingBag, TrendingUp, Clock } from 'lucide-react'
import { OrderActions } from './OrderActions'

export default async function CustomerDashboardPage() {
  const customer = await getCurrentDbUser()

  if (!customer) {
    redirect('/login')
  }

  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
    include: { dishes: true }
  })

  // Calculate quick stats
  const validOrders = orders.filter(o => o.status !== 'CANCELLED')
  const totalSpent = validOrders.reduce((sum, o) => sum + o.totalPrice, 0)
  const totalOrders = validOrders.length
  const activeOrders = validOrders.filter(o => !['COMPLETED', 'CANCELLED'].includes(o.status)).length

  return (
    <div className="flex-1 space-y-6">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, {customer.name || 'Customer'}. Track your orders and manage your account.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-6 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-lg">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Spent</p>
            <p className="text-2xl font-bold font-mono-data">{formatCurrency(totalSpent)}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-lg">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Orders</p>
            <p className="text-2xl font-bold font-mono-data">{totalOrders}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-primary/10 text-primary rounded-lg">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Active Orders</p>
            <p className="text-2xl font-bold font-mono-data">{activeOrders}</p>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold tracking-tight mb-4">Your Orders</h2>


      {orders.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Inbox className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="empty-state-title">No orders yet</p>
            <p className="empty-state-hint">
              When you place an order, it will appear here so you can track its progress.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const cfg = ORDER_STATUS_CONFIG[order.status]
            const StatusIcon = cfg.icon

            return (
              <div key={order.id} className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col">
                <div className="p-6 border-b bg-muted/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">Order #{order.shortId}</h3>
                      <span className={cfg.className}>
                        <StatusIcon className="h-3 w-3" aria-hidden="true" />
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Placed on {order.createdAt.toLocaleDateString(BUSINESS_LOCALE, { 
                        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' 
                      })}
                    </p>
                    {order.dueDate && (
                      <p className="text-sm text-muted-foreground">
                        Due: {order.dueDate.toLocaleDateString(BUSINESS_LOCALE, { 
                          weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' 
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-start sm:items-end gap-3 w-full sm:w-auto mt-2 sm:mt-0">
                    <OrderActions order={{
                      shortId: order.shortId,
                      customerName: customer.name,
                      status: order.status,
                      dishes: order.dishes.map(d => ({ quantity: d.quantity, dishName: d.dishName, unitPrice: d.unitPrice })),
                      totalPrice: order.totalPrice,
                      dueDate: order.dueDate
                    }} />
                  </div>
                </div>
                
                <div className="p-6">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground">
                    <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Order Details
                  </h4>
                  {order.description && (
                    <p className="text-sm text-muted-foreground mb-4 pb-4 border-b">
                      {order.description}
                    </p>
                  )}
                  
                  {order.dishes.length > 0 ? (
                    <div className="space-y-2">
                      {order.dishes.map((dish) => (
                        <div key={dish.id} className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">
                            <span className="font-medium text-foreground">{dish.quantity}x</span> {dish.dishName}
                          </span>
                          <span className="table-cell-num">{formatCurrency(dish.unitPrice * dish.quantity)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No specific dishes recorded.</p>
                  )}
                  
                  <div className="mt-4 pt-4 border-t flex justify-between items-center">
                    <span className="font-semibold">Total</span>
                    <span className="font-semibold text-lg table-cell-num">{formatCurrency(order.totalPrice)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
