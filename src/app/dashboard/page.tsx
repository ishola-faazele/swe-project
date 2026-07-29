import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PREPPING: 'bg-blue-100 text-blue-800',
  COOKING: 'bg-orange-100 text-orange-800',
  READY: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-gray-100 text-gray-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

const statusEmojis: Record<string, string> = {
  PENDING: '⏳',
  PREPPING: '🔪',
  COOKING: '🍳',
  READY: '✅',
  COMPLETED: '🎉',
  CANCELLED: '❌',
}

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
        <h1 className="text-3xl font-bold">Welcome!</h1>
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
        <h1 className="text-3xl font-bold">Your Orders</h1>
        <p className="text-muted-foreground mt-1">Track the status of all your orders below.</p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-lg text-muted-foreground">No orders yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            When you place an order, it will appear here so you can track its progress.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="rounded-xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-lg">Order #{order.shortId} - {order.description}</p>
                  <p className="text-sm text-muted-foreground">
                    Placed on {order.createdAt.toLocaleDateString('en-US', { 
                      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' 
                    })}
                  </p>
                  {order.dueDate && (
                    <p className="text-sm text-muted-foreground">
                      Due: {order.dueDate.toLocaleDateString('en-US', { 
                        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' 
                      })}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                    {statusEmojis[order.status] || ''} {order.status}
                  </span>
                  {order.totalPrice > 0 && (
                    <span className="text-sm font-medium">${order.totalPrice.toFixed(2)}</span>
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
