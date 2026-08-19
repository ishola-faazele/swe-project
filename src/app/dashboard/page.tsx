import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getCurrentDbUser } from '@/lib/auth'
import { BUSINESS_LOCALE, formatCurrency } from '@/lib/currency'
import { ORDER_STATUS_CONFIG } from '@/lib/orderStatus'
import { AddContactForm } from './AddContactForm'
import { Inbox } from 'lucide-react'

export default async function CustomerDashboardPage() {
  // The canonical id → authEmail → email resolver (src/lib/auth.ts) — replaces this page's own
  // former ad-hoc OR-lookup, which predates that resolver and duplicated its logic incompletely
  // (it never checked authEmail, so a phone-only customer's synthetic identity email would never
  // match anything here).
  const customer = await getCurrentDbUser()

  if (!customer) {
    redirect('/login')
  }

  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
  })

  // Never both — createCustomerSchema requires at least one contact method, so a customer can be
  // missing at most one of the two. Nothing renders once both are set; there's nothing left to add.
  const missingChannel = !customer.email ? 'email' : !customer.phone ? 'phone' : null

  return (
    <div className="flex-1 space-y-6">
      <div>
        <h1 className="page-title">Your Orders</h1>
        <p className="text-muted-foreground mt-1">Track the status of all your orders below.</p>
      </div>

      {missingChannel && (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-sm font-bold text-foreground">
            Add your {missingChannel === 'email' ? 'email' : 'phone number'}
          </h2>
          <p className="meta-text mt-0.5 mb-4">
            {missingChannel === 'email'
              ? "You signed up with a phone number. Add an email so you can also sign in that way."
              : "You signed up with an email. Add a phone number so you can also sign in that way."}
          </p>
          <AddContactForm channel={missingChannel} />
        </div>
      )}

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
