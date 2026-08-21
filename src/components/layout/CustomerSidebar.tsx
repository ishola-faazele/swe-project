"use client"

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  UtensilsCrossed,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'CUSTOMER PORTAL', items: [
    { name: 'Menu',      href: '/dashboard/menu', icon: UtensilsCrossed, exact: false },
    { name: 'My Orders', href: '/dashboard/orders', icon: LayoutDashboard, exact: true },
  ]},
]

interface CustomerSidebarProps {
  /** Called by the mobile drawer to close itself when a link is tapped. */
  onNavigate?: () => void
  /** Desktop collapsed state — hides labels and shows icon-only rail. */
  collapsed?: boolean
  /** Callback to toggle the collapsed state. */
  onToggleCollapse?: () => void
}

export function CustomerSidebar({ onNavigate, collapsed = false, onToggleCollapse }: CustomerSidebarProps) {
  const pathname = usePathname()

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out overflow-hidden',
        collapsed ? 'w-16' : 'w-full'
      )}
    >
      {/* ── Logo ──────────────────────────────────────────────────────── */}
      <Link
        href="/dashboard"
        className={cn(
          'flex h-[60px] shrink-0 items-center border-b border-sidebar-border transition-all duration-200 hover:bg-sidebar-accent/50',
          collapsed ? 'justify-center px-0' : 'gap-3 px-5'
        )}
      >
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-white p-1">
          <Image src="/rosty-logo.jpeg" alt="Chop with Rostty" fill sizes="48px" className="object-contain" />
        </div>

        {/* Brand text — hidden in collapsed mode */}
        <div
          className={cn(
            'min-w-0 overflow-hidden transition-[max-width,opacity] duration-200',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'
          )}
        >
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-sidebar-primary whitespace-nowrap">
            Chop with
          </p>
          <p className="text-sm font-bold leading-none tracking-tight text-sidebar-foreground whitespace-nowrap">
            ROSTTY
          </p>
        </div>
      </Link>

      {/* ── Nav ───────────────────────────────────────────────────────── */}
      <nav
        aria-label="Customer navigation"
        className={cn(
          'flex-1 space-y-6 py-6',
          collapsed ? 'px-2' : 'px-3'
        )}
      >
        {navItems.map((section) => (
          <div key={section.label}>
            {/* Section label — only shown when expanded */}
            <div
              className={cn(
                'overflow-hidden transition-[max-height,opacity] duration-200',
                collapsed ? 'max-h-0 opacity-0' : 'max-h-8 opacity-100'
              )}
            >
              <p className="eyebrow mb-2 px-3">{section.label}</p>
            </div>

            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => onNavigate?.()}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      'flex items-center rounded border-l-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50',
                      collapsed
                        ? 'justify-center px-2 py-2.5 border-transparent'
                        : 'gap-3 px-3 py-2.5',
                      active
                        ? 'border-sidebar-primary bg-sidebar-accent text-sidebar-primary'
                        : 'border-transparent text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {/* Link label — hidden in collapsed mode */}
                    <span
                      className={cn(
                        'truncate overflow-hidden transition-[max-width,opacity] duration-200',
                        collapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'
                      )}
                    >
                      {item.name}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer / collapse toggle ───────────────────────────────────── */}
      <div
        className={cn(
          'border-t border-sidebar-border',
          collapsed ? 'flex justify-center p-3' : 'flex items-center justify-between px-4 py-3'
        )}
      >
        {/* Version string — hidden when collapsed */}
        <div
          className={cn(
            'overflow-hidden transition-[max-width,opacity] duration-200',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'
          )}
        >
          <p className="meta-text whitespace-nowrap">v1.0.0 — local</p>
        </div>

        {/* Collapse / expand toggle button — only renders on desktop (parent is hidden md:block) */}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors',
              'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
              'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50'
            )}
          >
            {collapsed
              ? <PanelLeftOpen  className="h-4 w-4" aria-hidden="true" />
              : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            }
          </button>
        )}
      </div>
    </div>
  )
}
