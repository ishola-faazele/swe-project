"use client"

import { useState } from "react"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { CustomerSidebar } from "./CustomerSidebar"

export function CustomerMobileNavTrigger() {
  const [open, setOpen] = useState(false)

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-customer-nav"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="mobile-customer-nav"
          className="mobile-nav-drawer top-0 left-0 h-full w-[280px] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:max-w-[85vw] data-open:slide-in-from-left data-closed:slide-out-to-left"
        >
          <DialogTitle className="sr-only">Customer navigation</DialogTitle>
          <CustomerSidebar onNavigate={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
