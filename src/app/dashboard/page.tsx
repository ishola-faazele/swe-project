import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { BUSINESS_LOCALE, formatCurrency } from '@/lib/currency'
import { ORDER_STATUS_CONFIG } from '@/lib/orderStatus'
import { Inbox } from 'lucide-react'

export default async function CustomerDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Find the customer in the DB by email or phone
  const customer = await prisma.user.findFirst({
    where: {
      OR: [
        { email: user.email },
        ...(user.phone ? [{ phone: user.phone }] : []),
      ],
    },
  })

  if (!customer) {
    return (
      <div className="flex-1 space-y-6">
        <h1 className="page-title">Welcome!</h1>
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-lg text-muted-foreground">
            No customer profile found for your account yet.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Your profile will be created when you place your first order.
            Please contact us to get started!
          </p>
        </div>
      </div>
    )
  }

  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="flex-1 space-y-6">
      <div>
        <h1 className="page-title">Your Orders</h1>
        <p className="text-muted-foreground mt-1">Track the status of all your orders below.</p>
      </div>

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
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="rounded-xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-lg">Order #{order.shortId} - {order.description}</p>
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
                <div className="flex flex-col items-end gap-2">
                  {/* The same badge the admin sees — previously a lookalike
                      built from light-mode pastels on an otherwise-dark app. */}
                  <span className={ORDER_STATUS_CONFIG[order.status].className}>
                    {ORDER_STATUS_CONFIG[order.status].emoji} {ORDER_STATUS_CONFIG[order.status].label}
                  </span>
                  {order.totalPrice > 0 && (
                    <span className="table-cell-num text-sm font-medium">{formatCurrency(order.totalPrice)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
