"use client"

import { useState } from "react"
import type { User } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { updateNotificationPreferences } from "./actions"

type FormState = {
  notifyByEmail: boolean
  alertEmail: string
  notifyBySms: boolean
  alertPhone: string
  notifyByWhatsapp: boolean
  alertWhatsapp: string
}

function toFormState(
  row: Pick<User, "notifyByEmail" | "alertEmail" | "notifyBySms" | "alertPhone" | "notifyByWhatsapp" | "alertWhatsapp">
): FormState {
  return {
    notifyByEmail: row.notifyByEmail,
    alertEmail: row.alertEmail ?? "",
    notifyBySms: row.notifyBySms,
    alertPhone: row.alertPhone ?? "",
    notifyByWhatsapp: row.notifyByWhatsapp,
    alertWhatsapp: row.alertWhatsapp ?? "",
  }
}

/**
 * Mirrors the admin's Notifications tab at /admin/settings exactly — a toggle PLUS a
 * destination-contact input per channel, scoped to the customer's own row. Deliberately NOT tied
 * to login email/phone: a customer can route alerts to a different address or number than the one
 * they sign in with, via the "Same as login…" shortcut buttons below.
 */
export function NotificationPreferences({
  initialPrefs,
  loginEmail,
  loginPhone,
}: {
  initialPrefs: Pick<
    User,
    "notifyByEmail" | "alertEmail" | "notifyBySms" | "alertPhone" | "notifyByWhatsapp" | "alertWhatsapp"
  >
  loginEmail: string | null
  loginPhone: string | null
}) {
  const [form, setForm] = useState<FormState>(toFormState(initialPrefs))
  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  async function handleSave() {
    setIsPending(true)
    setStatus(null)
    try {
      const result = await updateNotificationPreferences(form)
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error })
        return
      }
      setForm(toFormState(result.data))
      setStatus({ kind: "ok", text: "Preferences saved." })
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save your preferences.",
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="space-y-2 mt-8">

      <div className="space-y-12">
        <section>
          <div className="border-b pb-4 mb-6">
            <h2 className="text-xl font-semibold">Notification Preferences</h2>
            <p className="text-sm text-muted-foreground mt-1">Choose how you want to hear about your order updates.</p>
          </div>

          <div className="space-y-8">
            {/* Email Settings */}
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <div className="p-1.5 bg-primary/10 rounded-md">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  </div>
                  Email
                </h3>
              </div>
              <div className="md:col-span-2 space-y-4">
                <Switch
                  aria-label="Email notifications"
                  checked={form.notifyByEmail}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, notifyByEmail: checked }))}
                />
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="alertEmail" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Alert email
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="alertEmail"
                      type="email"
                      placeholder="ama@example.com"
                      value={form.alertEmail}
                      disabled={isPending}
                      onChange={(e) => setForm((f) => ({ ...f, alertEmail: e.target.value }))}
                      className="font-mono-data bg-transparent"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="default"
                      disabled={isPending || !loginEmail}
                      onClick={() => setForm((f) => ({ ...f, alertEmail: loginEmail || f.alertEmail }))}
                      className="shrink-0"
                    >
                      Use login email
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
                  <div className="p-1.5 bg-primary/10 rounded-md">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
                  </div>
                  SMS
                </h3>
              </div>
              <div className="md:col-span-2 space-y-4">
                <Switch
                  aria-label="SMS notifications"
                  checked={form.notifyBySms}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, notifyBySms: checked }))}
                />
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="alertPhone" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                      className="font-mono-data bg-transparent"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="default"
                      disabled={isPending || !loginPhone}
                      onClick={() => setForm((f) => ({ ...f, alertPhone: loginPhone || f.alertPhone }))}
                      className="shrink-0"
                    >
                      Use login number
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
                  <div className="p-1.5 bg-primary/10 rounded-md">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  </div>
                  WhatsApp
                </h3>
              </div>
              <div className="md:col-span-2 space-y-4">
                <Switch
                  aria-label="WhatsApp notifications"
                  checked={form.notifyByWhatsapp}
                  disabled={isPending}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, notifyByWhatsapp: checked }))}
                />
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="alertWhatsapp" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Alert WhatsApp number
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
                      size="default"
                      disabled={isPending || !form.alertPhone}
                      onClick={() => setForm((f) => ({ ...f, alertWhatsapp: f.alertPhone }))}
                      className="shrink-0"
                    >
                      Same as SMS number
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="pt-4 flex justify-end">
              <Button type="button" onClick={handleSave} disabled={isPending} size="lg" className="w-full sm:w-auto">
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <div role="status" aria-live="polite" className="mt-3">
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
