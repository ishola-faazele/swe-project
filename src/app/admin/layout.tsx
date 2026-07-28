import { AdminLayout } from '@/components/layout/AdminLayout'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // NOTE: For now, everyone logging in goes to admin. 
  // We can add role checks here later (e.g. if (user.role !== 'ADMIN') redirect('/dashboard'))

  return (
    <AdminLayout>
      {children}
    </AdminLayout>
  )
}
