"use client"

import { useState } from "react"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AdminSidebar } from "./Sidebar"

/**
 * Owns the mobile nav drawer's open state.
 *
 * This has to be its own Client Component because `Header.tsx` is an async
 * Server Component (it awaits `supabase.auth.getUser()`), so the state cannot
 * live there. A Server Component can render this as a child without itself
 * crossing the boundary.
 *
 * Built on the existing `Dialog` (Base UI). `modal` is true by default, which
 * gives the focus trap, body scroll lock, Escape-to-close, and focus-return to
 * the hamburger for free — all of which the manual QA checklist verifies.
 */
export function MobileNavTrigger({ userRole }: { userRole?: 'ADMIN' | 'KITCHEN_STAFF' | 'DELIVERY_DRIVER' | 'CUSTOMER' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-admin-nav"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="mobile-admin-nav"
          className="mobile-nav-drawer top-0 left-0 h-full w-[280px] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:max-w-[85vw] data-open:slide-in-from-left data-closed:slide-out-to-left"
        >
          {/* The drawer's accessible name — visually redundant next to the logo,
              but required for the dialog to announce itself. */}
        <DialogTitle className="sr-only">{userRole === 'KITCHEN_STAFF' ? 'Staff' : userRole === 'DELIVERY_DRIVER' ? 'Driver' : 'Admin'} navigation</DialogTitle>
          <AdminSidebar onNavigate={() => setOpen(false)} userRole={userRole} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
