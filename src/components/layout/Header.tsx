import { createClient } from '@/utils/supabase/server'
import Link from 'next/link'
import { LogOut, Circle } from 'lucide-react'

export async function Header() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <header
      className="flex h-[60px] items-center gap-4 px-6 justify-between w-full"
      style={{
        borderBottom: '1px solid oklch(0.20 0.008 65)',
        background: 'oklch(0.09 0.004 65)',
      }}
    >
      {/* Left: breadcrumb placeholder — pages override this via title */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold tracking-widest uppercase"
          style={{ color: 'oklch(0.40 0.008 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.12em' }}
        >
          Admin Portal
        </span>
      </div>

      {/* Right: user + status */}
      <div className="flex items-center gap-5">
        {/* Online indicator */}
        <div className="flex items-center gap-2">
          <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
          <span
            className="text-xs"
            style={{ color: 'oklch(0.52 0.01 65)', fontFamily: 'var(--font-dm-mono)' }}
          >
            ONLINE
          </span>
        </div>

        {user ? (
          <div className="flex items-center gap-4">
            {/* User email */}
            <div
              className="px-3 py-1 rounded text-xs"
              style={{
                background: 'oklch(0.15 0.005 65)',
                color: 'oklch(0.72 0.15 65)',
                fontFamily: 'var(--font-dm-mono)',
                border: '1px solid oklch(0.22 0.008 65)',
              }}
            >
              {user.email || user.phone}
            </div>
            {/* Sign out */}
            <form action="/auth/signout" method="post">
              <button
                className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: 'oklch(0.45 0.008 65)', fontFamily: 'var(--font-dm-mono)' }}
              >
                <LogOut className="h-3.5 w-3.5" />
                SIGN OUT
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-xs"
            style={{ color: 'oklch(0.72 0.15 65)', fontFamily: 'var(--font-dm-mono)' }}
          >
            SIGN IN →
          </Link>
        )}
      </div>
    </header>
  )
}
