"use client"

import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'

interface AdminLayoutProps {
  children: React.ReactNode
  /** Header is passed as a slot so it can stay a Server Component (async). */
  header: React.ReactNode
}

/**
 * AdminLayout is a Client Component so it can own the sidebar-collapsed state
 * and pass it down to Sidebar (which switches to icon-only mode when collapsed).
 *
 * Header is received as a render prop (`header`) so it stays a Server Component
 * — AdminLayout must never import anything from utils/supabase/server directly.
 *
 * The collapsed state is persisted to localStorage under `sidebar-collapsed`
 * so it survives page navigations without flashing back to expanded.
 */
export function AdminLayout({ children, header }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Hydrate from localStorage after mount to avoid SSR mismatch. This is syncing React state
  // FROM an external system (localStorage) on mount — the documented, correct use of an effect
  // — not deriving state from props/state already available during render.
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'true') setCollapsed(true)
    setMounted(true)
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  const sidebarWidth = collapsed ? '64px' : '280px'

  return (
    <div
      className="grid min-h-screen w-full transition-[grid-template-columns] duration-200 ease-in-out md:grid-cols-[var(--sidebar-width)_1fr]"
      style={
        {
          '--sidebar-width': mounted ? sidebarWidth : '280px',
        } as React.CSSProperties
      }
    >
      {/* Desktop sidebar — hidden below md, sticky so the toggle button is
          always visible in the viewport without scrolling. overflow-y-auto
          lets the nav scroll independently if there are many items. */}
      <div className="hidden md:block sticky top-0 h-screen overflow-y-auto">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggle} />
      </div>

      <div className="flex flex-col min-w-0">
        {/* Server Component header rendered via slot */}
        {header}
        <main
          id="main-content"
          className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
