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
    <div className="relative flex flex-col min-h-screen overflow-hidden" style={{ background: 'oklch(0.08 0.004 65)' }}>
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 70% 50%, oklch(0.72 0.15 65 / 0.06) 0%, transparent 70%)',
        }}
      />
      {/* Grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(oklch(0.93 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(0.93 0 0) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 flex flex-1 items-center">
        <div className="max-w-6xl mx-auto px-8 w-full grid lg:grid-cols-2 gap-16 items-center py-16">

          {/* Left: Branding */}
          <div className="space-y-8">
            {/* Eyebrow */}
            <div className="flex items-center gap-3">
              <div
                className="h-px w-10"
                style={{ background: 'oklch(0.72 0.15 65)' }}
              />
              <span
                className="text-xs font-semibold tracking-widest uppercase"
                style={{ color: 'oklch(0.72 0.15 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.16em' }}
              >
                Kitchen Command Center
              </span>
            </div>

            {/* Wordmark */}
            <div>
              <h1
                className="text-6xl lg:text-7xl font-extrabold leading-[0.95] tracking-tight"
                style={{ color: 'oklch(0.93 0.008 65)' }}
              >
                CHOP
                <br />
                <span style={{ color: 'oklch(0.72 0.15 65)' }}>WITH</span>
                <br />
                ROSTY
              </h1>
            </div>

            <p
              className="text-base leading-relaxed max-w-sm"
              style={{ color: 'oklch(0.52 0.01 65)' }}
            >
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
                  <p
                    className="text-2xl font-bold"
                    style={{ color: 'oklch(0.72 0.15 65)', fontFamily: 'var(--font-dm-mono)' }}
                  >
                    {stat.value}
                  </p>
                  <p
                    className="text-xs uppercase tracking-wider mt-0.5"
                    style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}
                  >
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: CTA Card */}
          <div
            className="rounded-xl p-8 space-y-6 relative overflow-hidden"
            style={{
              background: 'oklch(0.11 0.005 65)',
              border: '1px solid oklch(0.22 0.008 65)',
            }}
          >
            {/* Top amber line */}
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent, oklch(0.72 0.15 65), transparent)' }}
            />

            <div>
              <h2 className="text-xl font-bold" style={{ color: 'oklch(0.93 0.008 65)' }}>
                Access Portal
              </h2>
              <p className="text-sm mt-1" style={{ color: 'oklch(0.45 0.008 65)' }}>
                Sign in to manage operations
              </p>
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
                    className="mt-0.5 h-2 w-2 rounded-full flex-shrink-0"
                    style={{ background: 'oklch(0.72 0.15 65)' }}
                  />
                  <div>
                    <span className="text-sm font-semibold" style={{ color: 'oklch(0.85 0.008 65)' }}>
                      {title}{' '}
                    </span>
                    <span className="text-sm" style={{ color: 'oklch(0.45 0.008 65)' }}>
                      — {desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/login"
              className="block w-full text-center py-3.5 rounded-lg text-sm font-bold tracking-wide transition-all"
              style={{
                background: 'oklch(0.72 0.15 65)',
                color: 'oklch(0.08 0.004 65)',
                letterSpacing: '0.05em',
              }}
            >
              SIGN IN →
            </Link>

            <p
              className="text-center text-xs"
              style={{ color: 'oklch(0.35 0.006 65)', fontFamily: 'var(--font-dm-mono)' }}
            >
              MAGIC LINK · NO PASSWORD REQUIRED
            </p>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className="relative z-10 border-t py-4 px-8"
        style={{ borderColor: 'oklch(0.18 0.006 65)' }}
      >
        <p
          className="text-xs text-center"
          style={{ color: 'oklch(0.30 0.005 65)', fontFamily: 'var(--font-dm-mono)' }}
        >
          © 2025 CHOP WITH ROSTY — ALL RIGHTS RESERVED
        </p>
      </div>
    </div>
  )
}
