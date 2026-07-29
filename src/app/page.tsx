import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

export default async function Home(props: { searchParams: Promise<{ code?: string }> }) {
  const searchParams = await props.searchParams
  if (searchParams.code) {
    redirect(`/auth/callback?code=${searchParams.code}`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // Check if user is in Prisma
    let dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: user.email },
          ...(user.phone ? [{ phone: user.phone }] : []),
        ],
      },
    })

    const isAdmin = 
      (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL) || 
      (process.env.ADMIN_PHONE && user.phone === process.env.ADMIN_PHONE)

    if (!dbUser && user.email) {
      dbUser = await prisma.user.create({
        data: {
          id: user.id,
          email: user.email,
          role: isAdmin ? 'ADMIN' : 'CUSTOMER',
        }
      })
    } else if (dbUser && isAdmin && dbUser.role !== 'ADMIN') {
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: { role: 'ADMIN' }
      })
    }

    if (dbUser?.role === 'ADMIN' || isAdmin) {
      redirect('/admin')
    } else {
      redirect('/dashboard')
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900">
      <main className="flex flex-col items-center gap-8 text-center px-6">
        <div className="text-6xl">🍽️</div>
        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
          Chop with Rosty
        </h1>
        <p className="max-w-md text-lg text-slate-300">
          Manage your orders, track inventory, and delight your customers — all in one place.
        </p>
        <Link
          href="/login"
          className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold text-slate-900 shadow-lg transition-all hover:bg-slate-100 hover:shadow-xl hover:scale-105"
        >
          Sign In
        </Link>
      </main>
    </div>
  )
}
