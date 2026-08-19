"use client"

import { useState } from "react"
import type { LoginSettings } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs"
import type { MaskedNotificationSettings } from "@/lib/settings"
import { updateLoginSettings, updateNotificationSettings } from "./actions"

/**
 * Placeholder shown in a secret field that already has a stored value.
 *
 * The real value is never sent to the browser (getMaskedNotificationSettings returns only a
 * boolean), so there is nothing to render even if we wanted to. Leaving such a field blank on save
 * keeps the stored secret — see keepIfBlank in actions.ts.
 */
const SAVED_SECRET_PLACEHOLDER = "•••• saved"

function secretPlaceholder(isSet: boolean) {
  return isSet ? SAVED_SECRET_PLACEHOLDER : "Not set"
}

export function SettingsClient({
  initialNotifications,
  initialLogin,
}: {
  initialNotifications: MaskedNotificationSettings
  initialLogin: LoginSettings
}) {
  const [notifications, setNotifications] = useState(initialNotifications)
  const [login, setLogin] = useState(initialLogin)
  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  // Phone login is only meaningful when a code can actually be delivered. This mirrors the same
  // condition the login page and both phone actions apply — but it is UI politeness only. The
  // server-side re-check in requestPhoneOtp/verifyPhoneOtp is the real enforcement boundary.
  const phoneLoginBlocked = !(notifications.smsEnabled && notifications.arkeselApiKeySet)

  async function handleNotificationsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setIsPending(true)
    setStatus(null)
    try {
      const result = await updateNotificationSettings({
        // Secrets: an untouched field submits blank, which means "keep the stored value".
        resendApiKey: String(formData.get("resendApiKey") ?? ""),
        arkeselApiKey: String(formData.get("arkeselApiKey") ?? ""),
        whatsappAccessToken: String(formData.get("whatsappAccessToken") ?? ""),
        whatsappAppSecret: String(formData.get("whatsappAppSecret") ?? ""),
        whatsappWebhookVerifyToken: String(formData.get("whatsappWebhookVerifyToken") ?? ""),
        // Non-secrets round-trip in full, so the submitted value is authoritative.
        fromEmail: String(formData.get("fromEmail") ?? ""),
        arkeselSenderId: String(formData.get("arkeselSenderId") ?? ""),
        whatsappPhoneNumberId: String(formData.get("whatsappPhoneNumberId") ?? ""),
        whatsappTemplateName: String(formData.get("whatsappTemplateName") ?? ""),
        whatsappLowStockTemplateName: String(formData.get("whatsappLowStockTemplateName") ?? ""),
        whatsappTemplateLanguage: String(formData.get("whatsappTemplateLanguage") ?? ""),
        emailEnabled: notifications.emailEnabled,
        smsEnabled: notifications.smsEnabled,
        whatsappEnabled: notifications.whatsappEnabled,
      })
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error })
        return
      }
      // Re-seed from the server's masked shape, so the *Set booleans reflect what was actually
      // stored rather than what was typed.
      setNotifications(result.data)
      setStatus({ kind: "ok", text: "Notification settings saved." })
      event.currentTarget.reset()
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save these settings.",
      })
    } finally {
      setIsPending(false)
    }
  }

  async function handleLoginSave(next: Partial<Pick<LoginSettings, "emailLoginEnabled" | "phoneLoginEnabled">>) {
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
          <form onSubmit={handleNotificationsSubmit} className="space-y-5">
            <p className="text-xs text-muted-foreground">
              Secret fields show <span className="font-mono-data">{SAVED_SECRET_PLACEHOLDER}</span>{" "}
              once configured and are never displayed again. Leave one blank to keep the stored
              value — only type in it to replace it.
            </p>

            {/* Email */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Email (Resend)</h2>
                  <p className="meta-text mt-0.5">Order updates and account-creation links</p>
                </div>
                <Switch
                  checked={notifications.emailEnabled}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({ ...prev, emailEnabled: checked }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resendApiKey">API key</Label>
                <Input
                  id="resendApiKey"
                  name="resendApiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={secretPlaceholder(notifications.resendApiKeySet)}
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fromEmail">From address</Label>
                <Input
                  id="fromEmail"
                  name="fromEmail"
                  defaultValue={notifications.fromEmail ?? ""}
                  placeholder="Chop with Rostty <orders@example.com>"
                  className="font-mono-data"
                />
              </div>
            </section>

            {/* SMS */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">SMS (Arkesel)</h2>
                  <p className="meta-text mt-0.5">Order updates, alerts, and phone login codes</p>
                </div>
                <Switch
                  checked={notifications.smsEnabled}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({ ...prev, smsEnabled: checked }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arkeselApiKey">API key</Label>
                <Input
                  id="arkeselApiKey"
                  name="arkeselApiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={secretPlaceholder(notifications.arkeselApiKeySet)}
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arkeselSenderId">Sender ID</Label>
                <Input
                  id="arkeselSenderId"
                  name="arkeselSenderId"
                  defaultValue={notifications.arkeselSenderId ?? ""}
                  placeholder="Rostty"
                  className="font-mono-data"
                />
              </div>
            </section>

            {/* WhatsApp */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">WhatsApp (Meta Cloud API)</h2>
                  <p className="meta-text mt-0.5">Order updates and low-stock alerts</p>
                </div>
                <Switch
                  checked={notifications.whatsappEnabled}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({ ...prev, whatsappEnabled: checked }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappAccessToken">Access token</Label>
                <Input
                  id="whatsappAccessToken"
                  name="whatsappAccessToken"
                  type="password"
                  autoComplete="off"
                  placeholder={secretPlaceholder(notifications.whatsappAccessTokenSet)}
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappPhoneNumberId">Phone number ID</Label>
                <Input
                  id="whatsappPhoneNumberId"
                  name="whatsappPhoneNumberId"
                  defaultValue={notifications.whatsappPhoneNumberId ?? ""}
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappAppSecret">App secret</Label>
                <Input
                  id="whatsappAppSecret"
                  name="whatsappAppSecret"
                  type="password"
                  autoComplete="off"
                  placeholder={secretPlaceholder(notifications.whatsappAppSecretSet)}
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappWebhookVerifyToken">Webhook verify token</Label>
                <Input
                  id="whatsappWebhookVerifyToken"
                  name="whatsappWebhookVerifyToken"
                  type="password"
                  autoComplete="off"
                  placeholder={secretPlaceholder(notifications.whatsappWebhookVerifyTokenSet)}
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappTemplateName">Order-status template</Label>
                <Input
                  id="whatsappTemplateName"
                  name="whatsappTemplateName"
                  defaultValue={notifications.whatsappTemplateName ?? ""}
                  placeholder="order_status_update"
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappLowStockTemplateName">Low-stock template</Label>
                <Input
                  id="whatsappLowStockTemplateName"
                  name="whatsappLowStockTemplateName"
                  defaultValue={notifications.whatsappLowStockTemplateName ?? ""}
                  placeholder="low_stock_alert"
                  className="font-mono-data"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappTemplateLanguage">Template language</Label>
                <Input
                  id="whatsappTemplateLanguage"
                  name="whatsappTemplateLanguage"
                  defaultValue={notifications.whatsappTemplateLanguage ?? ""}
                  placeholder="en"
                  className="font-mono-data"
                />
                <p className="text-xs text-muted-foreground">
                  Use the exact code the template is registered under in WhatsApp Manager — often
                  <span className="font-mono-data"> en</span>, not
                  <span className="font-mono-data"> en_US</span>.
                </p>
              </div>
            </section>

            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save notification settings"}
            </Button>
          </form>
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
                  checked={login.emailLoginEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => handleLoginSave({ emailLoginEnabled: checked })}
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
                  checked={login.phoneLoginEnabled}
                  disabled={isPending || phoneLoginBlocked}
                  onCheckedChange={(checked) => handleLoginSave({ phoneLoginEnabled: checked })}
                />
              </div>
              {phoneLoginBlocked && (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Turn on SMS and save an Arkesel API key first — phone login needs a working SMS
                  channel to deliver codes.
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
