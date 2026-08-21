import { redirect } from 'next/navigation'
import { getCurrentDbUser } from '@/lib/auth'
import { NotificationPreferences } from '../NotificationPreferences'
import { AddContactForm } from '../AddContactForm'
import { CustomerNotes } from '../CustomerNotes'
import { ProfilePhoto } from '../ProfilePhoto'

export const metadata = {
  title: 'Settings | Chop with Rostty',
}

export default async function SettingsPage() {
  const customer = await getCurrentDbUser()

  if (!customer) {
    redirect('/login')
  }

  const missingChannel = !customer.email ? 'email' : !customer.phone ? 'phone' : null

  return (
    <div className="flex-1 max-w-4xl space-y-6">
      <div className="border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your account details and notification preferences.</p>
      </div>

      <div className="space-y-12 mt-8">
        <section>
          {/* Unconditional, deliberately NOT gated the way "add a missing contact" below is — a
              photo is always optional and always changeable, never a one-time fill-in-the-blank. */}
          <ProfilePhoto initialImageUrl={customer.imageUrl} />
        </section>

        <section>
          <div className="border-b pb-4 mb-6">
            <h2 className="text-xl font-semibold">Account Security</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage the contact methods you use to log in to Chop with Rostty.</p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold">Login Credentials</h3>
              <p className="text-sm text-muted-foreground mt-1">We use passwordless magic links for security. Ensure your details are up to date.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              <dl className="space-y-4 max-w-md bg-muted/30 p-4 rounded-lg border">
                <div className="flex items-center justify-between border-b pb-3">
                  <dt className="text-sm font-medium text-muted-foreground">Email</dt>
                  <dd className="font-mono-data text-foreground font-medium">{customer.email || "Not set"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm font-medium text-muted-foreground">Phone</dt>
                  <dd className="font-mono-data text-foreground font-medium">{customer.phone || "Not set"}</dd>
                </div>
              </dl>

              {missingChannel && (
                <div className="rounded-xl border bg-card p-6 shadow-sm max-w-md">
                  <h3 className="text-sm font-bold text-foreground">
                    Add your {missingChannel === 'email' ? 'email' : 'phone number'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
                    {missingChannel === 'email'
                      ? "You signed up with a phone number. Add an email so you can also sign in via email."
                      : "You signed up with an email. Add a phone number so you can also sign in via SMS."}
                  </p>
                  <AddContactForm channel={missingChannel} />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* The NotificationPreferences component handles its own layout headers internally now */}
      <NotificationPreferences
        initialPrefs={{
          notifyByEmail: customer.notifyByEmail,
          alertEmail: customer.alertEmail,
          notifyBySms: customer.notifyBySms,
          alertPhone: customer.alertPhone,
          notifyByWhatsapp: customer.notifyByWhatsapp,
          alertWhatsapp: customer.alertWhatsapp,
        }}
        loginEmail={customer.email}
        loginPhone={customer.phone}
      />

      <CustomerNotes initialNotes={customer.notes} />
    </div>
  )
}
