import { login } from './actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoginSubmitButton } from '@/components/layout/LoginSubmitButton'
import { Tabs, TabsList, TabsPanel, TabsTrigger } from '@/components/ui/tabs'
import { PhoneLoginForm } from './PhoneLoginForm'
import { getLoginSettings, getNotificationSettings, isArkeselConfigured } from '@/lib/settings'
import { cn } from '@/lib/utils'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message: string }>
}) {
  const resolvedSearchParams = await searchParams
  const message = resolvedSearchParams?.message
  const isPositive = message ? message.toLowerCase().includes('check') : false

  // Read the settings DIRECTLY, not through getSettings() in admin/settings/actions.ts — that one
  // is requireAdmin()-gated and would reject every visitor to this public, pre-auth page.
  const [loginSettings, notifSettings] = await Promise.all([
    getLoginSettings(),
    getNotificationSettings(),
  ])

  // Gated on SMS being genuinely deliverable, not just on the login toggle: a Phone tab that can
  // collect a number but never send a code is worse than no tab at all.
  //
  // Decided HERE, server-side, so the tab is absent from the rendered HTML entirely rather than
  // hidden by a client-side conditional — a customer with dev tools open never finds a route to
  // nowhere. The server actions re-check this independently regardless; this is the UX half.
  const phoneLoginAvailable = Boolean(
    loginSettings.phoneLoginEnabled && notifSettings.smsEnabled && isArkeselConfigured()
  )

  const emailForm = (
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
  )

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
            {phoneLoginAvailable
              ? 'Sign in with your email or your phone number.'
              : 'We’ll send a magic link to your email.'}
          </p>
        </div>

        {phoneLoginAvailable ? (
          <Tabs defaultValue="email">
            <TabsList>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="phone">Phone</TabsTrigger>
            </TabsList>
            <TabsPanel value="email">{emailForm}</TabsPanel>
            <TabsPanel value="phone">
              <PhoneLoginForm />
            </TabsPanel>
          </Tabs>
        ) : (
          emailForm
        )}

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

        <p className="meta-text text-center">SECURE · PASSWORDLESS · NO PASSWORD REQUIRED</p>
      </div>
    </div>
  )
}
