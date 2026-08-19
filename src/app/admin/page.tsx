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
  Banknote,
  ArrowUpRight,
  ArrowDownRight,
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

  // Revenue Calculations
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
  const startOfDayBefore = new Date(startOfYesterday.getTime() - 24 * 60 * 60 * 1000)
  const startOfThisWeek = new Date(startOfToday.getTime() - now.getDay() * 24 * 60 * 60 * 1000)

  const [yesterdayOrders, dayBeforeOrders, thisWeekOrders] = await Promise.all([
    prisma.order.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfYesterday, lt: startOfToday } },
      select: { totalPrice: true }
    }),
    prisma.order.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfDayBefore, lt: startOfYesterday } },
      select: { totalPrice: true }
    }),
    prisma.order.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfThisWeek } },
      select: { totalPrice: true }
    })
  ])

  // Top Revenue Dishes (This Month)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const completedOrdersThisMonth = await prisma.order.findMany({
    where: { status: 'COMPLETED', updatedAt: { gte: startOfMonth } },
    include: { dishes: true }
  })

  const revenueByDish = new Map<string, { name: string; timesOrdered: number; totalRevenue: number }>()
  completedOrdersThisMonth.forEach(order => {
    order.dishes.forEach(dish => {
      const key = dish.dishName // grouping by snapshot name
      if (!revenueByDish.has(key)) {
        revenueByDish.set(key, { name: dish.dishName, timesOrdered: 0, totalRevenue: 0 })
      }
      const stat = revenueByDish.get(key)!
      stat.timesOrdered += dish.quantity
      stat.totalRevenue += dish.quantity * dish.unitPrice
    })
  })

  const topRevenueDishes = Array.from(revenueByDish.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 5)

  const yesterdayRevenue = yesterdayOrders.reduce((sum, o) => sum + o.totalPrice, 0)
  const dayBeforeRevenue = dayBeforeOrders.reduce((sum, o) => sum + o.totalPrice, 0)
  const thisWeekRevenue = thisWeekOrders.reduce((sum, o) => sum + o.totalPrice, 0)

  const revenueDiff = yesterdayRevenue - dayBeforeRevenue
  const revenueTrend = revenueDiff > 0 ? 'up' : revenueDiff < 0 ? 'down' : 'flat'
  const revenueTrendText = dayBeforeRevenue === 0 
    ? (yesterdayRevenue > 0 ? '+100%' : '0%') 
    : `${revenueDiff > 0 ? '+' : ''}${Math.round((revenueDiff / dayBeforeRevenue) * 100)}%`

  const formatCurrency = (val: number) => new Intl.NumberFormat(BUSINESS_LOCALE, { style: 'currency', currency: process.env.NEXT_PUBLIC_CURRENCY || 'USD' }).format(val)

  const stats = [
    {
      label: 'Revenue (This Week)',
      value: formatCurrency(thisWeekRevenue),
      icon: Banknote,
      sub: 'completed orders since Sunday',
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
    {
      label: 'Customers',
      value: totalCustomers,
      icon: Users,
      sub: 'registered accounts',
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
      </div>

      {/* Hero: Daily Revenue Snapshot */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-sm font-semibold tracking-wide text-primary/80 uppercase mb-2">Daily Revenue Snapshot</h2>
        <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
          <p className="text-4xl sm:text-5xl font-black text-foreground tabular-nums tracking-tight">
            {formatCurrency(yesterdayRevenue)}
          </p>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <span className="text-muted-foreground">yesterday</span>
            <div className={`flex items-center rounded-full px-2 py-0.5 ${revenueTrend === 'up' ? 'bg-primary/20 text-primary' : revenueTrend === 'down' ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`}>
              {revenueTrend === 'up' && <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" />}
              {revenueTrend === 'down' && <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />}
              {revenueTrendText} vs day prior
            </div>
          </div>
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

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Recent orders table */}
        <div>
          <h2 className="eyebrow mb-3">Recent Orders</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-popover">
                  {['Order', 'Customer', 'Status'].map(col => (
                    <th key={col} className="table-head-cell">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
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
                    const StatusIcon = cfg.icon
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
                        <td className="px-4 py-3">
                          <span className={cfg.className}>
                            <StatusIcon className="h-3 w-3" aria-hidden="true" />
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Revenue Dishes */}
        <div>
          <h2 className="eyebrow mb-3">Top Dishes by Revenue (This Month)</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-popover">
                  {['Dish', 'Times Ordered', 'Revenue'].map(col => (
                    <th key={col} className={col === 'Revenue' || col === 'Times Ordered' ? "table-head-cell text-right" : "table-head-cell"}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topRevenueDishes.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty-state py-8">
                        <p className="empty-state-title text-sm">No completed orders this month</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  topRevenueDishes.map((dish, idx) => (
                    <tr
                      key={dish.name}
                      className={`table-row ${idx % 2 === 0 ? 'bg-card/40' : ''}`}
                    >
                      <td className="px-4 py-3 text-foreground/90 font-medium">
                        {dish.name}
                      </td>
                      <td className="px-4 py-3 font-mono-data tabular-nums text-muted-foreground text-right">
                        {dish.timesOrdered}
                      </td>
                      <td className="px-4 py-3 font-mono-data tabular-nums font-bold text-primary text-right">
                        {formatCurrency(dish.totalRevenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
