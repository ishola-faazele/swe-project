import { login } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message: string }>
}) {
  const resolvedSearchParams = await searchParams

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'oklch(0.08 0.004 65)' }}
    >
      {/* Ambient glow behind card */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 50% 50% at 50% 50%, oklch(0.72 0.15 65 / 0.05) 0%, transparent 70%)',
        }}
      />

      <div
        className="relative w-full max-w-sm rounded-xl p-8 space-y-7 overflow-hidden"
        style={{
          background: 'oklch(0.11 0.005 65)',
          border: '1px solid oklch(0.22 0.008 65)',
        }}
      >
        {/* Amber top accent */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, oklch(0.72 0.15 65), transparent)' }}
        />

        {/* Logo */}
        <div className="space-y-1">
          <p
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: 'oklch(0.72 0.15 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.14em' }}
          >
            Chop with Rosty
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'oklch(0.93 0.008 65)' }}>
            Sign In
          </h1>
          <p className="text-sm" style={{ color: 'oklch(0.45 0.008 65)' }}>
            We&apos;ll send a magic link to your email.
          </p>
        </div>

        <form className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'oklch(0.52 0.01 65)', fontFamily: 'var(--font-dm-mono)', letterSpacing: '0.12em' }}
            >
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all"
              style={{
                background: 'oklch(0.15 0.005 65)',
                border: '1px solid oklch(0.25 0.008 65)',
                color: 'oklch(0.93 0.008 65)',
                fontFamily: 'var(--font-dm-mono)',
              }}
            />
          </div>

          <button
            formAction={login}
            className="w-full rounded-lg py-3 text-sm font-bold tracking-wide transition-all"
            style={{
              background: 'oklch(0.72 0.15 65)',
              color: 'oklch(0.08 0.004 65)',
              letterSpacing: '0.05em',
            }}
          >
            SEND MAGIC LINK →
          </button>
        </form>

        {resolvedSearchParams?.message && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{
              background: resolvedSearchParams.message.toLowerCase().includes('check')
                ? 'oklch(0.65 0.12 150 / 0.12)'
                : 'oklch(0.62 0.22 25 / 0.12)',
              border: resolvedSearchParams.message.toLowerCase().includes('check')
                ? '1px solid oklch(0.65 0.12 150 / 0.30)'
                : '1px solid oklch(0.62 0.22 25 / 0.30)',
              color: resolvedSearchParams.message.toLowerCase().includes('check')
                ? 'oklch(0.75 0.12 150)'
                : 'oklch(0.75 0.20 25)',
              fontFamily: 'var(--font-dm-mono)',
            }}
          >
            {resolvedSearchParams.message}
          </div>
        )}

        <p
          className="text-center text-xs"
          style={{ color: 'oklch(0.32 0.005 65)', fontFamily: 'var(--font-dm-mono)' }}
        >
          SECURE · PASSWORDLESS · MAGIC LINK
        </p>
      </div>
    </div>
  )
}
