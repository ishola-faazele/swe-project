"use client"

import { useState } from "react"
import type { NotificationSettings } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Mail, MessageSquare, Phone } from "lucide-react"
import { updateNotificationSettings } from "./actions"
import type { AuthDisplay } from "./actions"

type NotificationFormState = {
  emailEnabled: boolean
  alertEmail: string
  smsEnabled: boolean
  alertPhone: string
  whatsappEnabled: boolean
  alertWhatsapp: string
}

function toFormState(row: NotificationSettings): NotificationFormState {
  return {
    emailEnabled: row.emailEnabled,
    alertEmail: row.alertEmail ?? "",
    smsEnabled: row.smsEnabled,
    alertPhone: row.alertPhone ?? "",
    whatsappEnabled: row.whatsappEnabled,
    alertWhatsapp: row.alertWhatsapp ?? "",
  }
}

export function SettingsClient({
  initialNotifications,
  auth,
}: {
  initialNotifications: NotificationSettings
  auth: AuthDisplay
}) {
  const [form, setForm] = useState<NotificationFormState>(toFormState(initialNotifications))
  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  async function handleSave() {
    setIsPending(true)
    setStatus(null)
    try {
      const result = await updateNotificationSettings(form)
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error })
        return
      }
      setForm(toFormState(result.data))
      setStatus({ kind: "ok", text: "Notification settings saved." })
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save these settings.",
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your notification channels and owner login details.</p>
      </div>

      <div className="space-y-12">
        <section>
          <div className="border-b pb-4 mb-6">
            <h2 className="text-xl font-semibold">Notification Channels</h2>
            <p className="text-sm text-muted-foreground mt-1">Configure how and where you receive low-stock alerts.</p>
          </div>

          <div className="space-y-8">
            {/* Email Settings */}
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email Notifications
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Receive alerts straight to your inbox.</p>
              </div>
              <div className="md:col-span-2 space-y-4">
                <Switch
                  aria-label="Email notifications"
                  checked={form.emailEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, emailEnabled: checked }))}
                />
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="alertEmail" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Alert Email Address
                  </Label>
                  <div className="flex gap-2 text-sm">
                    <Input
                      id="alertEmail"
                      type="email"
                      placeholder="you@example.com"
                      value={form.alertEmail}
                      disabled={isPending}
                      onChange={(e) => setForm((f) => ({ ...f, alertEmail: e.target.value }))}
                      className="font-mono-data bg-transparent"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isPending || !auth.adminEmail}
                      onClick={() => setForm((f) => ({ ...f, alertEmail: auth.adminEmail || f.alertEmail }))}
                      className="shrink-0"
                    >
                      Use Login Email
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* SMS Settings */}
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  SMS Notifications
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Get text messages for critical stock alerts.</p>
              </div>
              <div className="md:col-span-2 space-y-4">
                <Switch
                  aria-label="SMS notifications"
                  checked={form.smsEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, smsEnabled: checked }))}
                />
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="alertPhone" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Alert Phone Number
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="alertPhone"
                      type="tel"
                      placeholder="024 123 4567"
                      value={form.alertPhone}
                      disabled={isPending}
                      onChange={(e) => setForm((f) => ({ ...f, alertPhone: e.target.value }))}
                      className="font-mono-data bg-transparent"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isPending || !auth.adminPhone}
                      onClick={() => setForm((f) => ({ ...f, alertPhone: auth.adminPhone || f.alertPhone }))}
                      className="shrink-0"
                    >
                      Use Login Phone
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* WhatsApp Settings */}
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  WhatsApp Notifications
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Receive alerts directly on WhatsApp.</p>
              </div>
              <div className="md:col-span-2 space-y-4">
                <Switch
                  aria-label="WhatsApp notifications"
                  checked={form.whatsappEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, whatsappEnabled: checked }))}
                />
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="alertWhatsapp" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Alert WhatsApp Number
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="alertWhatsapp"
                      type="tel"
                      value={form.alertWhatsapp}
                      disabled={isPending}
                      onChange={(e) => setForm((f) => ({ ...f, alertWhatsapp: e.target.value }))}
                      className="font-mono-data bg-transparent"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isPending || !form.alertPhone}
                      onClick={() => setForm((f) => ({ ...f, alertWhatsapp: f.alertPhone }))}
                      className="shrink-0"
                    >
                      Same As SMS Number
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="pt-4 flex justify-end">
              <Button type="button" onClick={handleSave} disabled={isPending} size="lg" className="w-full sm:w-auto">
                {isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </section>

        <section>
          <div className="border-b pb-4 mb-6">
            <h2 className="text-xl font-semibold">Authentication</h2>
            <p className="text-sm text-muted-foreground mt-1">Owner login details (configured via environment variables).</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold">Admin Credentials</h3>
              <p className="text-sm text-muted-foreground mt-1">These values are used to authenticate your access.</p>
            </div>
            <div className="md:col-span-2">
              <dl className="space-y-4 max-w-md bg-muted/30 p-4 rounded-lg border">
                <div className="flex items-center justify-between border-b pb-3">
                  <dt className="text-sm font-medium text-muted-foreground">Email</dt>
                  <dd className="font-mono-data text-foreground font-medium">{auth.adminEmail || "Not set"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm font-medium text-muted-foreground">Phone</dt>
                  <dd className="font-mono-data text-foreground font-medium">{auth.adminPhone || "Not set"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </div>

      <div role="status" aria-live="polite">
        {status && (
          <div
            className={
              status.kind === "ok"
                ? "rounded-lg border border-chart-3/30 bg-chart-3/12 px-4 py-3 font-mono-data text-sm text-chart-3"
                : "rounded-lg border border-destructive/30 bg-destructive/12 px-4 py-3 font-mono-data text-sm text-destructive"
            }
          >
            {status.text}
          </div>
        )}
      </div>
    </div>
  )
}
