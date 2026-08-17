"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Package, ShoppingCart, Flame, UtensilsCrossed } from 'lucide-react'

const navItems = [
  { label: 'OPERATIONS', items: [
    { name: 'Dashboard', href: '/admin', icon: LayoutDashboard, exact: true },
    { name: 'Orders', href: '/admin/orders', icon: ShoppingCart, exact: false },
  ]},
  { label: 'MANAGEMENT', items: [
    { name: 'Inventory', href: '/admin/inventory', icon: Package, exact: false },
    { name: 'Menu', href: '/admin/menu', icon: UtensilsCrossed, exact: false },
    { name: 'Customers', href: '/admin/customers', icon: Users, exact: false },
  ]},
]

export function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{
        background: 'oklch(0.10 0.005 65)',
        borderRight: '1px solid oklch(0.20 0.008 65)',
      }}
    >
      {/* Logo */}
      <div
        className="flex h-[60px] items-center gap-3 px-5"
        style={{ borderBottom: '1px solid oklch(0.20 0.008 65)' }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded"
          style={{ background: 'oklch(0.72 0.15 65)', color: 'oklch(0.08 0.004 65)' }}
        >
          <Flame className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-xs font-bold tracking-widest uppercase" style={{ color: 'oklch(0.72 0.15 65)', letterSpacing: '0.12em' }}>
            Chop with
          </p>
          <p className="text-sm font-bold tracking-tight leading-none" style={{ color: 'oklch(0.93 0.008 65)' }}>
            ROSTY
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-6 px-3 space-y-6">
        {navItems.map((section) => (
          <div key={section.label}>
            <p
              className="px-3 mb-2 text-xs font-semibold tracking-widest"
              style={{ color: 'oklch(0.38 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.14em' }}
            >
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className="flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-all relative group"
                    style={{
                      background: active ? 'oklch(0.72 0.15 65 / 0.10)' : 'transparent',
                      color: active ? 'oklch(0.72 0.15 65)' : 'oklch(0.52 0.01 65)',
                      borderLeft: active ? '2px solid oklch(0.72 0.15 65)' : '2px solid transparent',
                    }}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <span>{item.name}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-4"
        style={{ borderTop: '1px solid oklch(0.20 0.008 65)' }}
      >
        <p
          className="text-xs"
          style={{ color: 'oklch(0.35 0.006 65)', fontFamily: 'var(--font-dm-mono)' }}
        >
          v1.0.0 — local
        </p>
      </div>
    </div>
  )
}
