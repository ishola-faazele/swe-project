import { login } from './actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoginSubmitButton } from '@/components/layout/LoginSubmitButton'
import { cn } from '@/lib/utils'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message: string }>
}) {
  const resolvedSearchParams = await searchParams
  const message = resolvedSearchParams?.message
  const isPositive = message ? message.toLowerCase().includes('check') : false

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Ambient glow behind the card — purely decorative */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,var(--amber-glow)_0%,transparent_70%)] opacity-40"
      />

      <div className="relative w-full max-w-sm space-y-7 overflow-hidden rounded-xl border border-border bg-card p-8">
        {/* Amber top accent */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
        />

        <div className="space-y-1">
          <p className="eyebrow text-primary">Chop with Rostty</p>
          <h1 className="page-title">Sign In</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ll send a magic link to your email.
          </p>
        </div>

        <form className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="eyebrow">
              Email Address
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              placeholder="you@example.com"
              required
              className="font-mono-data"
            />
          </div>

          <LoginSubmitButton formAction={login} />
        </form>

        {/* Announced to screen readers when the server action redirects back
            with a status or error message. */}
        <div role="status" aria-live="polite">
          {message && (
            <div
              className={cn(
                'rounded-lg border px-4 py-3 font-mono-data text-sm',
                isPositive
                  ? 'border-chart-3/30 bg-chart-3/12 text-chart-3'
                  : 'border-destructive/30 bg-destructive/12 text-destructive'
              )}
            >
              {message}
            </div>
          )}
        </div>

        <p className="meta-text text-center">SECURE · PASSWORDLESS · MAGIC LINK</p>
      </div>
    </div>
  )
}
