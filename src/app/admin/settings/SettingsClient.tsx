"use client"

import { useState } from "react"
import type { LoginSettings, NotificationSettings } from "@prisma/client"

import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs"
import { updateLoginSettings, updateNotificationSettings } from "./actions"

export function SettingsClient({
  initialNotifications,
  initialLogin,
  arkeselConfigured,
}: {
  initialNotifications: NotificationSettings
  initialLogin: LoginSettings
  arkeselConfigured: boolean
}) {
  const [notifications, setNotifications] = useState(initialNotifications)
  const [login, setLogin] = useState(initialLogin)
  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  // Phone login is only meaningful when a code can actually be delivered. This mirrors the same
  // condition the login page and both phone actions apply — but it is UI politeness only. The
  // server-side re-check in requestPhoneOtp/verifyPhoneOtp is the real enforcement boundary.
  const phoneLoginBlocked = !(notifications.smsEnabled && arkeselConfigured)

  async function handleNotificationToggle(next: Partial<Pick<NotificationSettings, "emailEnabled" | "smsEnabled" | "whatsappEnabled">>) {
    const merged = { ...notifications, ...next }
    setIsPending(true)
    setStatus(null)
    try {
      const result = await updateNotificationSettings({
        emailEnabled: merged.emailEnabled,
        smsEnabled: merged.smsEnabled,
        whatsappEnabled: merged.whatsappEnabled,
      })
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error })
        return
      }
      setNotifications(result.data)
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

  async function handleLoginToggle(next: Partial<Pick<LoginSettings, "emailLoginEnabled" | "phoneLoginEnabled">>) {
    const merged = { ...login, ...next }
    setIsPending(true)
    setStatus(null)
    try {
      const result = await updateLoginSettings({
        emailLoginEnabled: merged.emailLoginEnabled,
        phoneLoginEnabled: merged.phoneLoginEnabled,
      })
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error })
        return
      }
      setLogin(result.data)
      setStatus({ kind: "ok", text: "Login settings saved." })
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
          <TabsTrigger value="login">Login</TabsTrigger>
        </TabsList>

        <TabsPanel value="notifications">
          <div className="space-y-4">
            <section className="flex items-center justify-between rounded-lg border border-border bg-card p-5">
              <div>
                <h2 className="text-sm font-bold text-foreground">Email (Resend)</h2>
                <p className="meta-text mt-0.5">Order updates and account-creation links</p>
              </div>
              <Switch
                aria-label="Email notifications"
                checked={notifications.emailEnabled}
                disabled={isPending}
                onCheckedChange={(checked) => handleNotificationToggle({ emailEnabled: checked })}
              />
            </section>

            <section className="flex items-center justify-between rounded-lg border border-border bg-card p-5">
              <div>
                <h2 className="text-sm font-bold text-foreground">SMS (Arkesel)</h2>
                <p className="meta-text mt-0.5">Order updates, alerts, and phone login codes</p>
              </div>
              <Switch
                aria-label="SMS notifications"
                checked={notifications.smsEnabled}
                disabled={isPending}
                onCheckedChange={(checked) => handleNotificationToggle({ smsEnabled: checked })}
              />
            </section>

            <section className="flex items-center justify-between rounded-lg border border-border bg-card p-5">
              <div>
                <h2 className="text-sm font-bold text-foreground">WhatsApp (Meta Cloud API)</h2>
                <p className="meta-text mt-0.5">Order updates and low-stock alerts</p>
              </div>
              <Switch
                aria-label="WhatsApp notifications"
                checked={notifications.whatsappEnabled}
                disabled={isPending}
                onCheckedChange={(checked) => handleNotificationToggle({ whatsappEnabled: checked })}
              />
            </section>
          </div>
        </TabsPanel>

        <TabsPanel value="login">
          <div className="space-y-5">
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Email login</h2>
                  <p className="meta-text mt-0.5">Magic link sent to the customer&apos;s email</p>
                </div>
                <Switch
                  aria-label="Email login"
                  checked={login.emailLoginEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => handleLoginToggle({ emailLoginEnabled: checked })}
                />
              </div>
            </section>

            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Phone login</h2>
                  <p className="meta-text mt-0.5">6-digit code sent by SMS</p>
                </div>
                <Switch
                  aria-label="Phone login"
                  checked={login.phoneLoginEnabled}
                  disabled={isPending || phoneLoginBlocked}
                  onCheckedChange={(checked) => handleLoginToggle({ phoneLoginEnabled: checked })}
                />
              </div>
              {phoneLoginBlocked && (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {arkeselConfigured
                    ? "Turn on SMS notifications first — phone login needs a working SMS channel to deliver codes."
                    : "Arkesel isn't configured on the server yet — phone login needs a working SMS channel to deliver codes."}
                </p>
              )}
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
