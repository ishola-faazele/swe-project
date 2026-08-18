import { createClient } from '@/utils/supabase/server'
import Image from 'next/image'
import Link from 'next/link'
import { LogOut, Circle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MobileNavTrigger } from './MobileNavTrigger'

// Stays an async Server Component — MobileNavTrigger is a Client Component
// child, which does not pull this file across the boundary.
export async function Header() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <header className="flex h-[60px] w-full items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNavTrigger />

        {/* Below md the sidebar is hidden, so this is the only persistently
            visible brand mark. */}
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-white p-0.5 md:hidden">
          <Image src="/rosty-logo.jpeg" alt="Chop with Rostty" fill className="object-contain" />
        </div>

        <span className="eyebrow truncate">Admin Portal</span>
      </div>

      {/* Right: user + status */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        <div className="hidden items-center gap-2 sm:flex">
          <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" aria-hidden="true" />
          <span className="meta-text">ONLINE</span>
        </div>

        {user ? (
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden max-w-[220px] truncate rounded border border-border bg-muted px-3 py-1 font-mono-data text-xs text-primary sm:block">
              {user.email || user.phone}
            </div>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm" className="font-mono-data text-muted-foreground">
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                SIGN OUT
              </Button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded font-mono-data text-xs text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            SIGN IN →
          </Link>
        )}
      </div>
    </header>
  )
}
