import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-muted/40">
        <div className="max-w-4xl mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-lg">
            🍽️ Chop with Rosty
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user.email || user.phone}</span>
            <form action="/auth/signout" method="post">
              <button className="text-sm font-medium hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-4 lg:p-6">
        {children}
      </main>
    </div>
  )
}
