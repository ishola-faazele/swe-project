import { prisma } from '@/lib/prisma'
import {
  TrendingUp,
  Users,
  ShoppingCart,
  Clock,
  ChefHat,
  CheckCircle,
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Inbox,
} from 'lucide-react'
import { ACTIVE_ORDER_STATUSES, getDueUrgency } from '@/lib/dueDate'
import { ORDER_STATUS_CONFIG } from '@/lib/orderStatus'
import { BUSINESS_LOCALE } from '@/lib/currency'

export default async function AdminDashboardPage() {
  // Fetch real data from DB
  const [
    totalOrders,
    totalCustomers,
    activeOrders,
    allInventory,
    recentOrders,
    ordersByStatus,
    activeOrdersForDueCheck,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count({ where: { status: { in: ACTIVE_ORDER_STATUSES } } }),
    // Direct query, deliberately not routed through getInventoryItems() — so it needs its own
    // isActive filter. An ingredient the business has retired sits at or near zero stock forever
    // and would otherwise nag the Low Stock Alerts count with a restock that will never happen.
    prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { currentStock: true, minimumThreshold: true },
    }),
    prisma.order.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, email: true, shortId: true } } },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    // Only orders still in the kitchen queue can be late — a COMPLETED order
    // with a past due date was delivered, not missed.
    prisma.order.findMany({
      where: { status: { in: ACTIVE_ORDER_STATUSES } },
      select: { dueDate: true },
    }),
  ])

  const lowStockItems = allInventory.filter(i => i.currentStock <= i.minimumThreshold).length
  const statusCounts = Object.fromEntries(
    ordersByStatus.map(s => [s.status, s._count.status])
  )

  // Server-evaluated `now` (the default) is correct here: this is a Server
  // Component, so there is no client render to disagree with it.
  const dueTodayCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'due-today').length
  const overdueCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'overdue').length

  const stats = [
    {
      label: 'Total Orders',
      value: totalOrders,
      icon: ShoppingCart,
      sub: `${activeOrders} active`,
    },
    {
      label: 'Customers',
      value: totalCustomers,
      icon: Users,
      sub: 'registered accounts',
    },
    {
      label: 'Active Orders',
      value: activeOrders,
      icon: ChefHat,
      sub: 'in kitchen',
    },
    {
      label: 'Due Today',
      value: dueTodayCount,
      icon: CalendarClock,
      sub: 'active orders due today',
    },
    {
      label: 'Overdue',
      value: overdueCount,
      icon: CalendarX,
      sub: 'past their due date',
      alert: overdueCount > 0,
    },
    {
      label: 'Low Stock Alerts',
      value: lowStockItems,
      icon: AlertTriangle,
      sub: 'items need restocking',
      alert: lowStockItems > 0,
    },
  ]

  const pipeline = [
    { key: 'PENDING', label: 'PENDING', icon: Clock, tone: 'text-muted-foreground' },
    { key: 'PREPPING', label: 'PREPPING', icon: TrendingUp, tone: 'text-chart-4' },
    { key: 'COOKING', label: 'COOKING', icon: ChefHat, tone: 'text-primary' },
    { key: 'READY', label: 'READY', icon: CheckCircle, tone: 'text-chart-3' },
  ]

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Dashboard</h1>
          <p className="meta-text mt-0.5">
            {new Date().toLocaleDateString(BUSINESS_LOCALE, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="shrink-0 rounded border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-mono-data text-primary">
          LIVE DATA
        </div>
      </div>

      {/* Stat cards — 2×3 at lg, since the due-date pair grew this from 4 to 6 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">{stat.label}</p>
                <p className={`stat-value mt-2 ${stat.alert ? 'text-destructive' : 'text-primary'}`}>
                  {stat.value}
                </p>
                <p className="meta-text mt-1.5">{stat.sub}</p>
              </div>
              <div
                className={`shrink-0 rounded p-2 ${
                  stat.alert ? 'bg-destructive/12 text-destructive' : 'bg-primary/10 text-primary'
                }`}
              >
                <stat.icon className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Order pipeline */}
      <div>
        <h2 className="eyebrow mb-3">Order Pipeline</h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {pipeline.map(({ key, label, icon: Icon, tone }) => (
            <div
              key={key}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
            >
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wider font-mono-data text-muted-foreground">
                  {label}
                </p>
                <p className="mt-0.5 text-2xl font-bold leading-none font-mono-data tabular-nums text-foreground">
                  {statusCounts[key] || 0}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent orders table */}
      <div>
        <h2 className="eyebrow mb-3">Recent Orders</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-popover">
                {['Order', 'Customer', 'Description', 'Status', 'Date'].map(col => (
                  <th key={col} className="table-head-cell">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <Inbox className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <p className="empty-state-title">No orders yet</p>
                      <p className="empty-state-hint">
                        New orders will appear here as soon as they are booked.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                recentOrders.map((order, idx) => {
                  const cfg = ORDER_STATUS_CONFIG[order.status]
                  return (
                    <tr
                      key={order.id}
                      className={`table-row ${idx % 2 === 0 ? 'bg-card/40' : ''}`}
                    >
                      <td className="px-4 py-3 font-bold font-mono-data tabular-nums text-primary">
                        #{order.shortId}
                      </td>
                      <td className="px-4 py-3 text-foreground/90">
                        {order.customer.name || order.customer.email || `#${order.customer.shortId}`}
                      </td>
                      <td
                        className="max-w-[220px] truncate px-4 py-3 text-muted-foreground"
                        title={order.description}
                      >
                        {order.description}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cfg.className}>
                          {cfg.emoji} {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 meta-text">
                        {order.createdAt.toLocaleDateString(BUSINESS_LOCALE, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
