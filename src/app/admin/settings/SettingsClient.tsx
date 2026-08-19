"use client"

import { useState } from "react"
import type { NotificationSettings } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs"
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
    <div className="space-y-5">
      <Tabs defaultValue="notifications">
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
        </TabsList>

        <TabsPanel value="notifications">
          <div className="space-y-4">
            <section className="space-y-3 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Email</h2>
                  <p className="meta-text mt-0.5">Where your own low-stock alerts are emailed</p>
                </div>
                <Switch
                  aria-label="Email notifications"
                  checked={form.emailEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, emailEnabled: checked }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alertEmail" className="eyebrow">
                  Alert email
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="alertEmail"
                    type="email"
                    placeholder="you@example.com"
                    value={form.alertEmail}
                    disabled={isPending}
                    onChange={(e) => setForm((f) => ({ ...f, alertEmail: e.target.value }))}
                    className="font-mono-data"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending || !auth.adminEmail}
                    onClick={() => setForm((f) => ({ ...f, alertEmail: auth.adminEmail || f.alertEmail }))}
                    className="shrink-0"
                  >
                    Same as owner email
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">SMS</h2>
                  <p className="meta-text mt-0.5">Where your own low-stock alerts are texted</p>
                </div>
                <Switch
                  aria-label="SMS notifications"
                  checked={form.smsEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, smsEnabled: checked }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alertPhone" className="eyebrow">
                  Alert phone
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="alertPhone"
                    type="tel"
                    placeholder="024 123 4567"
                    value={form.alertPhone}
                    disabled={isPending}
                    onChange={(e) => setForm((f) => ({ ...f, alertPhone: e.target.value }))}
                    className="font-mono-data"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending || !auth.adminPhone}
                    onClick={() => setForm((f) => ({ ...f, alertPhone: auth.adminPhone || f.alertPhone }))}
                    className="shrink-0"
                  >
                    Same as owner phone
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">WhatsApp</h2>
                  <p className="meta-text mt-0.5">Where your own low-stock alerts arrive on WhatsApp</p>
                </div>
                <Switch
                  aria-label="WhatsApp notifications"
                  checked={form.whatsappEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, whatsappEnabled: checked }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alertWhatsapp" className="eyebrow">
                  Alert WhatsApp number
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="alertWhatsapp"
                    type="tel"
                    value={form.alertWhatsapp}
                    disabled={isPending}
                    onChange={(e) => setForm((f) => ({ ...f, alertWhatsapp: e.target.value }))}
                    className="font-mono-data"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending || !form.alertPhone}
                    onClick={() => setForm((f) => ({ ...f, alertWhatsapp: f.alertPhone }))}
                    className="shrink-0"
                  >
                    Same as alert phone
                  </Button>
                </div>
              </div>
            </section>

            <Button type="button" onClick={handleSave} disabled={isPending} className="w-full">
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </TabsPanel>

        <TabsPanel value="auth">
          <div className="space-y-4">
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div>
                <h2 className="text-sm font-bold text-foreground">Owner login</h2>
                <p className="meta-text mt-0.5">
                  Set via the server environment at deploy time. Cannot be changed here.
                </p>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-mono-data text-foreground">{auth.adminEmail || "Not set"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-mono-data text-foreground">{auth.adminPhone || "Not set"}</dd>
                </div>
              </dl>
            </section>
          </div>
        </TabsPanel>
      </Tabs>

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
