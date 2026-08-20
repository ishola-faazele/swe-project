import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { CustomerLayout } from '@/components/layout/CustomerLayout'
import { CustomerHeader } from '@/components/layout/CustomerHeader'

export default async function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <CustomerLayout header={<CustomerHeader />}>
      {children}
    </CustomerLayout>
  )
}
