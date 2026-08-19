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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Ambient glow — decorative */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_50%,var(--amber-glow)_0%,transparent_70%)] opacity-50"
      />
      {/* Grid overlay — decorative */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-16 px-8 py-16 lg:grid-cols-2">

          {/* Left: Branding */}
          <div className="space-y-8">
            <div className="flex items-center gap-3">
              <div className="h-px w-10 bg-primary" aria-hidden="true" />
              <span className="eyebrow text-primary">Kitchen Command Center</span>
            </div>

            <div>
              <h1 className="text-6xl font-extrabold leading-[0.95] tracking-tight text-foreground lg:text-7xl">
                CHOP
                <br />
                <span className="text-primary">WITH</span>
                <br />
                ROSTTY
              </h1>
            </div>

            <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
              Full-stack operations management for a West African food business.
              Track every order, every ingredient, every customer — in real time.
            </p>

            {/* Stats row */}
            <div className="flex items-center gap-8">
              {[
                { value: '6', label: 'Order Stages' },
                { value: '∞', label: 'Inventory Items' },
                { value: '24/7', label: 'Live Tracking' },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="font-mono-data text-2xl font-bold text-primary">{stat.value}</p>
                  <p className="meta-text mt-0.5 uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: CTA Card */}
          <div className="relative space-y-6 overflow-hidden rounded-xl border border-border bg-card p-8">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
            />

            <div>
              <h2 className="text-xl font-bold text-foreground">Access Portal</h2>
              <p className="mt-1 text-sm text-muted-foreground">Sign in to manage operations</p>
            </div>

            {/* Feature list */}
            <div className="space-y-3">
              {[
                ['Orders', 'Track from pending to delivery'],
                ['Inventory', 'Real-time ingredient stock'],
                ['Customers', 'Manage your client base'],
                ['Alerts', 'Low stock notifications'],
              ].map(([title, desc]) => (
                <div key={title} className="flex items-start gap-3">
                  <div
                    aria-hidden="true"
                    className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                  />
                  <div>
                    <span className="text-sm font-semibold text-foreground">{title} </span>
                    <span className="text-sm text-muted-foreground">— {desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/login"
              className="block w-full rounded-lg bg-primary py-3.5 text-center text-sm font-bold tracking-wide text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              SIGN IN →
            </Link>

            <p className="meta-text text-center">MAGIC LINK · NO PASSWORD REQUIRED</p>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative z-10 border-t border-border px-8 py-4">
        <p className="meta-text text-center">
          © 2026 CHOP WITH ROSTTY — ALL RIGHTS RESERVED
        </p>
      </div>
    </div>
  )
}
