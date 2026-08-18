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

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
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
      className="grid min-h-screen w-full transition-[grid-template-columns] duration-200 ease-in-out"
      style={{
        gridTemplateColumns: mounted ? `${sidebarWidth} 1fr` : '280px 1fr',
      }}
    >
      {/* Desktop sidebar — hidden below md */}
      <div className="hidden md:block">
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
