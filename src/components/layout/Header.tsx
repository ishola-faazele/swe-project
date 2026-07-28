import { createClient } from '@/utils/supabase/server'
import Link from 'next/link'

export async function Header() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6 justify-between w-full">
      <div className="w-full flex-1">
        <h1 className="text-lg font-semibold md:text-2xl">Dashboard</h1>
      </div>
      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user.email || user.phone}</span>
            <form action="/auth/signout" method="post">
              <button className="text-sm font-medium hover:underline">Sign out</button>
            </form>
          </div>
        ) : (
          <Link href="/login" className="text-sm font-medium hover:underline">
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
