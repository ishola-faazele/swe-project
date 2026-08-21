import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentDbUser } from '@/lib/auth'
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
import { BUSINESS_LOCALE, formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'

function getRelativeTimeString(date: Date): string {
  const diffInMinutes = Math.round((date.getTime() - Date.now()) / (1000 * 60))
  if (diffInMinutes < 0) {
    const past = Math.abs(diffInMinutes)
    if (past < 60) return `due ${past} min ago`
    return `due ${Math.floor(past / 60)}h ${past % 60}m ago`
  }
  if (diffInMinutes < 60) return `in ${diffInMinutes} min`
  const hours = Math.floor(diffInMinutes / 60)
  const mins = diffInMinutes % 60
  return `in ${hours}h ${mins > 0 ? `${mins}m` : ''}`
}

export default async function AdminDashboardPage() {
  const user = await getCurrentDbUser()
  const isAdmin = user?.role === 'ADMIN'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Fetch real data from DB
  const [
    totalOrders,
    totalCustomers,
    activeOrders,
    allInventory,
    recentOrders,
    ordersByStatus,
    activeOrdersForDueCheck,
    activeLogs,
    upcomingOrders,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count({ where: { status: { in: ACTIVE_ORDER_STATUSES } } }),
    prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { id: true, currentStock: true, minimumThreshold: true },
    }),
    prisma.order.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, email: true, shortId: true } } },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.order.findMany({
      where: { status: { in: ACTIVE_ORDER_STATUSES } },
      select: { dueDate: true },
    }),
    prisma.orderIngredientLog.findMany({
      where: {
        order: { status: { in: ACTIVE_ORDER_STATUSES } }
      },
      select: { orderId: true, inventoryItemId: true }
    }),
    prisma.order.findMany({
      where: { 
        status: { in: ACTIVE_ORDER_STATUSES },
        dueDate: { not: null }
      },
      take: 5,
      orderBy: { dueDate: 'asc' },
      include: { customer: { select: { name: true, email: true, shortId: true } } },
    })
  ])

  const lowStockItems = allInventory.filter(i => i.currentStock <= i.minimumThreshold)
  const lowStockCount = lowStockItems.length
  const statusCounts = Object.fromEntries(
    ordersByStatus.map(s => [s.status, s._count.status])
  )
  
  const lowStockItemIds = new Set(lowStockItems.map(i => i.id))
  
  const uniqueActiveOrdersWithLowStock = new Set(
    activeLogs.filter(log => lowStockItemIds.has(log.inventoryItemId)).map(log => log.orderId)
  ).size

  const dueTodayCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'due-today').length
  const overdueCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'overdue').length

  const readyCount = statusCounts['READY'] || 0
  const completionRate = activeOrders > 0 ? Math.round((readyCount / activeOrders) * 100) : 0

  // Revenue Calculations
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
  const startOfDayBefore = new Date(startOfYesterday.getTime() - 24 * 60 * 60 * 1000)
  
  const [todayOrders, yesterdayOrders, dayBeforeOrders] = await Promise.all([
    prisma.order.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfToday } },
      select: { totalPrice: true }
    }),
    prisma.order.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfYesterday, lt: startOfToday } },
      select: { totalPrice: true }
    }),
    prisma.order.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfDayBefore, lt: startOfYesterday } },
      select: { totalPrice: true }
    })
  ])

  const todayRevenue = todayOrders.reduce((sum, o) => sum + o.totalPrice, 0)
  const todayCompletedOrders = todayOrders.length
  const yesterdayRevenue = yesterdayOrders.reduce((sum, o) => sum + o.totalPrice, 0)
  const dayBeforeRevenue = dayBeforeOrders.reduce((sum, o) => sum + o.totalPrice, 0)

  const yesterdayTrend = dayBeforeRevenue === 0 ? (yesterdayRevenue > 0 ? 100 : 0) : ((yesterdayRevenue - dayBeforeRevenue) / dayBeforeRevenue) * 100
  const weekTrend = yesterdayRevenue === 0 ? (todayRevenue > 0 ? 100 : 0) : ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100

  // Top Revenue Dishes (This Month)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const completedOrdersThisMonth = await prisma.order.findMany({
    where: { status: 'COMPLETED', updatedAt: { gte: startOfMonth } },
    include: { dishes: true }
  })

  const revenueByDish = new Map<string, { id: string; name: string; timesOrdered: number; totalRevenue: number }>()
  completedOrdersThisMonth.forEach(order => {
    order.dishes.forEach(dish => {
      const key = dish.dishName
      if (!revenueByDish.has(key)) {
        revenueByDish.set(key, { id: dish.dishName, name: dish.dishName, timesOrdered: 0, totalRevenue: 0 })
      }
      const stat = revenueByDish.get(key)!
      stat.timesOrdered += dish.quantity
      stat.totalRevenue += dish.quantity * dish.unitPrice
    })
  })

  const topDishes = Array.from(revenueByDish.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 4)

  const stats = [
    {
      label: 'Active Orders',
      value: activeOrders,
      icon: ChefHat,
      sub: 'in kitchen',
      tone: 'text-blue-500',
      bgTone: 'bg-blue-500/10',
      href: '/admin/orders'
    },
    {
      label: 'Due Today',
      value: dueTodayCount,
      icon: CalendarClock,
      sub: 'active orders due today',
      tone: dueTodayCount > 0 ? 'text-amber-500' : 'text-muted-foreground',
      bgTone: dueTodayCount > 0 ? 'bg-amber-500/10' : 'bg-muted',
      href: '/admin/orders?status=PENDING,PREPPING,COOKING,READY'
    },
    {
      label: 'Overdue',
      value: overdueCount,
      icon: CalendarX,
      sub: 'past their due date',
      alert: overdueCount > 0,
      tone: overdueCount > 0 ? 'text-destructive-foreground' : 'text-muted-foreground',
      bgTone: overdueCount > 0 ? 'bg-white/20' : 'bg-muted',
      href: '/admin/orders?status=PENDING,PREPPING,COOKING,READY'
    },
    {
      label: 'Low Stock Alerts',
      value: lowStockCount,
      icon: AlertTriangle,
      sub: lowStockCount > 0 && uniqueActiveOrdersWithLowStock > 0 
        ? `needed by ${uniqueActiveOrdersWithLowStock} active order${uniqueActiveOrdersWithLowStock === 1 ? '' : 's'}`
        : 'items need restocking',
      alert: lowStockCount > 0,
      tone: lowStockCount > 0 ? 'text-destructive-foreground' : 'text-muted-foreground',
      bgTone: lowStockCount > 0 ? 'bg-white/20' : 'bg-muted',
      href: '/admin/inventory'
    },
    ...(isAdmin ? [{
      label: 'Customers',
      value: totalCustomers,
      icon: Users,
      sub: 'registered accounts',
      tone: 'text-purple-500',
      bgTone: 'bg-purple-500/10',
      href: '/admin/customers'
    }] : []),
  ]

  const pipeline = [
    { key: 'PENDING', label: 'PENDING', icon: Clock, tone: 'text-slate-500', bgTone: 'bg-slate-500/10', borderTone: 'border-slate-500/20' },
    { key: 'PREPPING', label: 'PREPPING', icon: TrendingUp, tone: 'text-blue-500', bgTone: 'bg-blue-500/10', borderTone: 'border-blue-500/30' },
    { key: 'COOKING', label: 'COOKING', icon: ChefHat, tone: 'text-amber-500', bgTone: 'bg-amber-500/10', borderTone: 'border-amber-500/30' },
    { key: 'READY', label: 'READY', icon: CheckCircle, tone: 'text-emerald-500', bgTone: 'bg-emerald-500/10', borderTone: 'border-emerald-500/30' },
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
      {isAdmin && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-primary">
                <Banknote className="h-5 w-5" />
                <h2 className="font-semibold tracking-wide uppercase text-sm">Today's Revenue</h2>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black tracking-tight text-foreground">
                  {formatCurrency(todayRevenue)}
                </span>
                <span className="text-muted-foreground font-medium">from {todayCompletedOrders} completed orders</span>
              </div>
            </div>
            
            {/* Quick Comparisons */}
            <div className="flex flex-row sm:flex-col gap-4 sm:gap-2">
              <div className="flex items-center gap-2">
                <div className={cn("p-1 rounded-full", yesterdayTrend > 0 ? "bg-emerald-500/20 text-emerald-500" : yesterdayTrend < 0 ? "bg-red-500/20 text-red-500" : "bg-muted text-muted-foreground")}>
                  {yesterdayTrend > 0 ? <ArrowUpRight className="h-3 w-3" /> : yesterdayTrend < 0 ? <ArrowDownRight className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                </div>
                <div className="text-sm">
                  <span className={cn("font-bold", yesterdayTrend > 0 ? "text-emerald-500" : yesterdayTrend < 0 ? "text-red-500" : "text-muted-foreground")}>
                    {yesterdayTrend === Infinity ? '∞' : Math.abs(Math.round(yesterdayTrend))}%
                  </span>
                  <span className="text-muted-foreground ml-1">vs yesterday</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={cn("p-1 rounded-full", weekTrend > 0 ? "bg-emerald-500/20 text-emerald-500" : weekTrend < 0 ? "bg-red-500/20 text-red-500" : "bg-muted text-muted-foreground")}>
                  {weekTrend > 0 ? <ArrowUpRight className="h-3 w-3" /> : weekTrend < 0 ? <ArrowDownRight className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                </div>
                <div className="text-sm">
                  <span className={cn("font-bold", weekTrend > 0 ? "text-emerald-500" : weekTrend < 0 ? "text-red-500" : "text-muted-foreground")}>
                    {weekTrend === Infinity ? '∞' : Math.abs(Math.round(weekTrend))}%
                  </span>
                  <span className="text-muted-foreground ml-1">vs day before</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stat cards — 2×3 at lg */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => {
          const content = (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">{stat.label}</p>
                <p className={`stat-value mt-2 ${stat.tone}`}>
                  {stat.value}
                </p>
                <p className={`meta-text mt-1.5 ${stat.alert ? 'text-destructive-foreground/80' : ''}`}>{stat.sub}</p>
              </div>
              <div
                className={`shrink-0 rounded p-2 ${stat.bgTone} ${stat.tone}`}
              >
                <stat.icon className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
          )

          const className = `stat-card block relative overflow-hidden transition-all ${
            stat.alert 
              ? 'bg-destructive text-destructive-foreground ring-1 ring-destructive hover:bg-destructive/90 hover:shadow-lg' 
              : 'hover:border-primary/30 hover:shadow-md'
          }`

          if (stat.href) {
            return (
              <Link key={stat.label} href={stat.href} className={className}>
                {content}
              </Link>
            )
          }

          return (
            <div key={stat.label} className={className}>
              {content}
            </div>
          )
        })}
      </div>

      {/* Order pipeline */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="eyebrow mb-1">Kitchen Load & Pipeline</h2>
            <p className="text-sm text-muted-foreground font-medium">
              {activeOrders > 0 ? (
                <>
                  <span className="text-foreground font-bold">{readyCount}</span> of <span className="text-foreground font-bold">{activeOrders}</span> active orders are ready
                </>
              ) : (
                "No active orders in kitchen"
              )}
            </p>
          </div>
          <div className="w-full sm:max-w-[200px] h-3 bg-muted rounded-full overflow-hidden shrink-0 mt-2 sm:mt-0">
            <div 
              className="h-full bg-emerald-500 transition-all duration-1000 ease-out" 
              style={{ width: `${completionRate}%` }} 
            />
          </div>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {pipeline.map(({ key, label, icon: Icon, tone, bgTone, borderTone }) => (
            <div
              key={key}
              className={`flex items-center gap-4 rounded-xl border ${borderTone} bg-card p-5 shadow-sm transition-all hover:shadow-md`}
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${bgTone}`}>
                <Icon className={`h-6 w-6 ${tone}`} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wider font-mono-data text-muted-foreground">
                  {label}
                </p>
                <p className={`mt-1 text-3xl font-black leading-none font-mono-data tabular-nums ${tone}`}>
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

        <div className="space-y-8">
          {/* Top Revenue Dishes */}
          {isAdmin && topDishes.length > 0 && (
            <div className="pt-4 border-t border-border">
              <h2 className="eyebrow mb-6">Top Revenue Dishes (This Month)</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {topDishes.map((dish, i) => (
                  <div key={dish.id} className="p-4 rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                        #{i + 1}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Revenue</p>
                        <p className="font-bold text-foreground">{formatCurrency(dish.totalRevenue)}</p>
                      </div>
                    </div>
                    <h3 className="font-semibold text-foreground line-clamp-1 mb-1">{dish.name}</h3>
                    <p className="text-sm text-muted-foreground">{dish.timesOrdered}x ordered</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming Due Orders */}
          <div>
            <h2 className="eyebrow mb-3">Upcoming Due Orders</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-popover">
                    {['Order', 'Customer', 'Due Date'].map(col => (
                      <th key={col} className="table-head-cell">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upcomingOrders.length === 0 ? (
                    <tr>
                      <td colSpan={3}>
                        <div className="empty-state py-8">
                          <p className="empty-state-title text-sm">No upcoming due orders</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    upcomingOrders.map((order, idx) => {
                      const dueText = order.dueDate ? new Date(order.dueDate).toLocaleString(BUSINESS_LOCALE, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                      }) : '—'
                      const urgency = order.dueDate ? getDueUrgency(order.dueDate) : 'none'
                      const isDueSoon = urgency === 'due-today' || urgency === 'overdue'

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
                            <span className={cn("font-medium", isDueSoon ? 'text-destructive' : 'text-muted-foreground')}>
                              {dueText}
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
        </div>
      </div>
    </div>
  )
}
