import { AdminLayout } from '@/components/layout/AdminLayout'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/utils/supabase/server'
import { getCurrentDbUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Route-level half of authorization. Shares getCurrentDbUser() with requireAdmin() so the
  // id-or-email lockout fallback stays defined in exactly one place.
  const dbUser = await getCurrentDbUser()
  if (!dbUser || dbUser.role !== 'ADMIN') {
    redirect('/dashboard')
  }

  return (
    <AdminLayout header={<Header />}>
      {children}
    </AdminLayout>
  )
}
