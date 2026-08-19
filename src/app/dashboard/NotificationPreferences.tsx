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
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-sm font-bold text-foreground">Notifications</h2>
      <p className="meta-text mt-0.5 mb-4">Choose how you want to hear about your order updates.</p>

      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Email</span>
            <Switch
              aria-label="Email notifications"
              checked={form.notifyByEmail}
              disabled={isPending}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, notifyByEmail: checked }))}
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
                placeholder="ama@example.com"
                value={form.alertEmail}
                disabled={isPending}
                onChange={(e) => setForm((f) => ({ ...f, alertEmail: e.target.value }))}
                className="font-mono-data"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending || !loginEmail}
                onClick={() => setForm((f) => ({ ...f, alertEmail: loginEmail || f.alertEmail }))}
                className="shrink-0"
              >
                Same as login email
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">SMS</span>
            <Switch
              aria-label="SMS notifications"
              checked={form.notifyBySms}
              disabled={isPending}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, notifyBySms: checked }))}
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
                disabled={isPending || !loginPhone}
                onClick={() => setForm((f) => ({ ...f, alertPhone: loginPhone || f.alertPhone }))}
                className="shrink-0"
              >
                Same as login number
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">WhatsApp</span>
            <Switch
              aria-label="WhatsApp notifications"
              checked={form.notifyByWhatsapp}
              disabled={isPending}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, notifyByWhatsapp: checked }))}
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
