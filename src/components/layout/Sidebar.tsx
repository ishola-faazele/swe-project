"use client"

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Package, ShoppingCart, UtensilsCrossed } from 'lucide-react'
import { cn } from '@/lib/utils'

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

/**
 * `onNavigate` lets the mobile drawer close itself when a link is tapped. It is
 * optional, so the desktop `<Sidebar />` call site in AdminLayout needs no
 * change at all.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname()

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <div className="flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-[60px] items-center gap-3 border-b border-sidebar-border px-5">
        {/* The source JPEG has an opaque white background baked in, so it sits
            on its own white chip rather than bleeding a grey square into the
            dark sidebar. */}
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-white p-1">
          <Image src="/rosty-logo.jpeg" alt="Chop with Rostty" fill className="object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-sidebar-primary">
            Chop with
          </p>
          <p className="text-sm font-bold leading-none tracking-tight text-sidebar-foreground">
            ROSTTY
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Admin navigation" className="flex-1 space-y-6 px-3 py-6">
        {navItems.map((section) => (
          <div key={section.label}>
            <p className="eyebrow mb-2 px-3">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => onNavigate?.()}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded border-l-2 px-3 py-2.5 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50',
                      active
                        ? 'border-sidebar-primary bg-sidebar-accent text-sidebar-primary'
                        : 'border-transparent text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.name}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-4 py-4">
        <p className="meta-text">v1.0.0 — local</p>
      </div>
    </div>
  )
}
