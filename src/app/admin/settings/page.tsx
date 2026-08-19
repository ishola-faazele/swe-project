import { requireAdmin } from '@/lib/auth'
import { getLoginSettings, getMaskedNotificationSettings } from '@/lib/settings'
import { SettingsClient } from './SettingsClient'

export default async function SettingsPage() {
  // Intentionally redundant with admin/layout.tsx's own route-level gate. Every Settings mutation
  // re-verifies rather than trusting the layout alone, and the read path gets the same treatment —
  // this page hands the browser the full configuration shape, so it earns its own check.
  await requireAdmin()

  const [notifications, login] = await Promise.all([
    // Masked, never raw: this result is serialized into the page payload, so a stored secret must
    // not be in it. See getMaskedNotificationSettings.
    getMaskedNotificationSettings(),
    getLoginSettings(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="meta-text mt-0.5">
          Notification providers and customer login methods
        </p>
      </div>
      <SettingsClient initialNotifications={notifications} initialLogin={login} />
    </div>
  )
}
