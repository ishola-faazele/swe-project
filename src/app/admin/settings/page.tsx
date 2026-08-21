import { requireAdmin } from '@/lib/auth'
import { getNotificationSettings } from '@/lib/settings'
import { SettingsClient } from './SettingsClient'
import type { AuthDisplay } from './actions'

export default async function SettingsPage() {
  // Intentionally redundant with admin/layout.tsx's own route-level gate. Every Settings mutation
  // re-verifies rather than trusting the layout alone, and the read path gets the same treatment.
  await requireAdmin()

  const notifications = await getNotificationSettings()
  // Computed server-side and passed down: a client component has no access to non-NEXT_PUBLIC
  // env vars, and ADMIN_EMAIL/ADMIN_PHONE are exactly that.
  const auth: AuthDisplay = {
    adminEmail: process.env.ADMIN_EMAIL || null,
    adminPhone: process.env.ADMIN_PHONE || null,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="meta-text mt-0.5">
          Manage your notification channels and owner login details.
        </p>
      </div>
      <SettingsClient initialNotifications={notifications} auth={auth} />
    </div>
  )
}
