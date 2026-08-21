import { createClient } from '@/utils/supabase/server'
import Image from 'next/image'
import Link from 'next/link'
import { LogOut, User, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'
import { MobileNavTrigger } from './MobileNavTrigger'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { OfflineIndicator } from './OfflineIndicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Stays an async Server Component — MobileNavTrigger is a Client Component
// child, which does not pull this file across the boundary.
export async function Header({ userRole }: { userRole?: 'ADMIN' | 'KITCHEN_STAFF' | 'DELIVERY_DRIVER' | 'CUSTOMER' }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let displayLogin = ''
  let dbUser = null
  if (user) {
    const rawLogin = user.email || user.phone || ''
    displayLogin = rawLogin.endsWith('@internal.chopwithrostty.app') 
      ? rawLogin.replace('phone-', '').replace('@internal.chopwithrostty.app', '') 
      : rawLogin

    dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, imageUrl: true }
    })
  }

  const isAdmin = userRole === 'ADMIN'
  const displayName = isAdmin ? 'Admin' : (dbUser?.name || user?.user_metadata?.name || 'Staff')
  const initials = !isAdmin && displayName !== 'Staff' ? displayName.substring(0, 2).toUpperCase() : ''

  return (
    <header className="sticky top-0 z-10 flex h-[60px] w-full items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6 print:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNavTrigger userRole={userRole} />

        {/* Below md the sidebar is hidden, so this is the only persistently
            visible brand mark. */}
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-white p-0.5 md:hidden">
          <Image src="/rosty-logo.jpeg" alt="Chop with Rostty" fill sizes="48px" className="object-contain" />
        </div>

        <span className="eyebrow truncate">{userRole === 'KITCHEN_STAFF' ? 'Staff Portal' : userRole === 'DELIVERY_DRIVER' ? 'Driver Portal' : 'Admin Portal'}</span>
      </div>

      {/* Right: user + status */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-5">

        {user ? (
          <div className="flex items-center gap-2 sm:gap-4">
            <OfflineIndicator />
            <ThemeToggle />
            
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/50 p-1 pr-3 transition-colors border border-transparent hover:border-border">
                {isAdmin ? (
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-white p-0.5 border">
                    <Image src="/rosty-logo.jpeg" alt="Admin" fill sizes="32px" className="object-contain" />
                  </div>
                ) : dbUser?.imageUrl ? (
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                    <Image src={dbUser.imageUrl} alt={displayName} fill sizes="32px" className="object-cover" />
                  </div>
                ) : initials ? (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs uppercase tracking-widest">
                    {initials}
                  </div>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                )}
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-medium leading-none text-foreground">{displayName}</p>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">Account</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {displayLogin}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="p-0" render={<Link href="/admin/settings" />}>
                  <div className="flex w-full items-center px-2 py-1.5 cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="p-0 text-destructive focus:bg-destructive/10 focus:text-destructive" render={<form action="/auth/signout" method="post" className="w-full" />}>
                  <button type="submit" className="flex w-full items-center px-2 py-1.5 cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign out</span>
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
