import { requireAdmin } from '@/lib/auth'
import { getLoginSettings, getNotificationSettings, isArkeselConfigured } from '@/lib/settings'
import { SettingsClient } from './SettingsClient'

export default async function SettingsPage() {
  // Intentionally redundant with admin/layout.tsx's own route-level gate. Every Settings mutation
  // re-verifies rather than trusting the layout alone, and the read path gets the same treatment.
  await requireAdmin()

  const [notifications, login] = await Promise.all([
    getNotificationSettings(),
    getLoginSettings(),
  ])
  // Computed server-side and passed down: a client component has no access to non-NEXT_PUBLIC
  // env vars, and this is exactly that — whether ARKESEL_API_KEY/ARKESEL_SENDER_ID are set.
  const arkeselConfigured = isArkeselConfigured()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="meta-text mt-0.5">
          Notification channels and customer login methods. Provider credentials (API keys,
          tokens) are configured in the server environment, not here.
        </p>
      </div>
      <SettingsClient
        initialNotifications={notifications}
        initialLogin={login}
        arkeselConfigured={arkeselConfigured}
      />
    </div>
  )
}
