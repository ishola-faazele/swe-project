import { prisma } from '@/lib/prisma'
import { TrendingUp, Package, Users, ShoppingCart, Clock, ChefHat, CheckCircle, AlertTriangle } from 'lucide-react'

const statusConfig: Record<string, { label: string; icon: string; className: string }> = {
  PENDING:   { label: 'Pending',   icon: '⏳', className: 'status-pending' },
  PREPPING:  { label: 'Prepping',  icon: '🔪', className: 'status-prepping' },
  COOKING:   { label: 'Cooking',   icon: '🍳', className: 'status-cooking' },
  READY:     { label: 'Ready',     icon: '✅', className: 'status-ready' },
  COMPLETED: { label: 'Completed', icon: '🎉', className: 'status-completed' },
  CANCELLED: { label: 'Cancelled', icon: '❌', className: 'status-cancelled' },
}

export default async function AdminDashboardPage() {
  // Fetch real data from DB
  const [
    totalOrders,
    totalCustomers,
    activeOrders,
    allInventory,
    recentOrders,
    ordersByStatus,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'PREPPING', 'COOKING', 'READY'] } } }),
    prisma.inventoryItem.findMany({ select: { currentStock: true, minimumThreshold: true } }),
    prisma.order.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, email: true, shortId: true } } },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
  ])

  const lowStockItems = allInventory.filter(i => i.currentStock <= i.minimumThreshold).length
  const statusCounts = Object.fromEntries(
    ordersByStatus.map(s => [s.status, s._count.status])
  )

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
      label: 'Low Stock Alerts',
      value: lowStockItems,
      icon: AlertTriangle,
      sub: 'items need restocking',
      alert: lowStockItems > 0,
    },
  ]

  const pipeline = [
    { key: 'PENDING',  label: 'PENDING',  icon: Clock,        color: 'oklch(0.52 0.01 65)' },
    { key: 'PREPPING', label: 'PREPPING', icon: TrendingUp,   color: 'oklch(0.60 0.15 240)' },
    { key: 'COOKING',  label: 'COOKING',  icon: ChefHat,      color: 'oklch(0.70 0.18 55)' },
    { key: 'READY',    label: 'READY',    icon: CheckCircle,  color: 'oklch(0.70 0.15 150)' },
  ]

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'oklch(0.93 0.008 65)' }}>
            Dashboard
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'oklch(0.45 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div
          className="px-3 py-1.5 rounded text-xs"
          style={{
            background: 'oklch(0.72 0.15 65 / 0.10)',
            border: '1px solid oklch(0.72 0.15 65 / 0.30)',
            color: 'oklch(0.72 0.15 65)',
            fontFamily: 'var(--font-dm-mono)',
          }}
        >
          LIVE DATA
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.12em' }}
                >
                  {stat.label}
                </p>
                <p
                  className="text-4xl font-extrabold mt-2 leading-none"
                  style={{
                    color: stat.alert ? 'oklch(0.70 0.18 25)' : 'oklch(0.72 0.15 65)',
                    fontFamily: 'var(--font-dm-mono)',
                  }}
                >
                  {stat.value}
                </p>
                <p className="text-xs mt-1.5" style={{ color: 'oklch(0.40 0.008 65)' }}>
                  {stat.sub}
                </p>
              </div>
              <div
                className="p-2 rounded"
                style={{
                  background: stat.alert
                    ? 'oklch(0.62 0.22 25 / 0.12)'
                    : 'oklch(0.72 0.15 65 / 0.10)',
                }}
              >
                <stat.icon
                  className="h-5 w-5"
                  style={{ color: stat.alert ? 'oklch(0.70 0.18 25)' : 'oklch(0.72 0.15 65)' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Order pipeline */}
      <div>
        <h2
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.14em' }}
        >
          Order Pipeline
        </h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {pipeline.map(({ key, label, icon: Icon, color }) => (
            <div
              key={key}
              className="rounded-lg p-4 flex items-center gap-3"
              style={{
                background: 'oklch(0.11 0.005 65)',
                border: '1px solid oklch(0.20 0.008 65)',
              }}
            >
              <Icon className="h-4 w-4 flex-shrink-0" style={{ color }} />
              <div>
                <p
                  className="text-xs font-semibold tracking-wider"
                  style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}
                >
                  {label}
                </p>
                <p
                  className="text-2xl font-bold leading-none mt-0.5"
                  style={{ color: 'oklch(0.85 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}
                >
                  {statusCounts[key] || 0}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent orders table */}
      <div>
        <h2
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.14em' }}
        >
          Recent Orders
        </h2>
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid oklch(0.20 0.008 65)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'oklch(0.13 0.005 65)', borderBottom: '1px solid oklch(0.20 0.008 65)' }}>
                {['Order', 'Customer', 'Description', 'Status', 'Date'].map(col => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest"
                    style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.10em' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'oklch(0.40 0.008 65)' }}
                  >
                    No orders yet.
                  </td>
                </tr>
              ) : (
                recentOrders.map((order, idx) => {
                  const cfg = statusConfig[order.status]
                  return (
                    <tr
                      key={order.id}
                      style={{
                        background: idx % 2 === 0 ? 'oklch(0.10 0.004 65)' : 'transparent',
                        borderBottom: '1px solid oklch(0.16 0.005 65)',
                      }}
                    >
                      <td
                        className="px-4 py-3 font-bold"
                        style={{ color: 'oklch(0.72 0.15 65)', fontFamily: 'var(--font-dm-mono)' }}
                      >
                        #{order.shortId}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'oklch(0.80 0.006 65)' }}>
                        {order.customer.name || order.customer.email || `#${order.customer.shortId}`}
                      </td>
                      <td
                        className="px-4 py-3 max-w-[220px] truncate"
                        style={{ color: 'oklch(0.55 0.008 65)' }}
                        title={order.description}
                      >
                        {order.description}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cfg?.className || 'status-pending'}>
                          {cfg?.icon} {cfg?.label || order.status}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-xs"
                        style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}
                      >
                        {order.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
