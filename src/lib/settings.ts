/**
 * DB-backed settings accessors — the single source of truth for every notification provider's
 * credentials and for which login methods are available.
 *
 * There is deliberately NO env-var fallback here. A stray value left in a .env could otherwise
 * keep a channel sending after the admin explicitly toggled it off in /admin/settings, which is
 * exactly the failure mode moving these into the database was meant to end. The cost is a real
 * one and is accepted: on a freshly-reset database every channel is silent until the admin
 * re-enters credentials once through the UI.
 *
 * Both tables are application-level singletons (findFirst, create-if-absent) rather than
 * DB-enforced ones. The narrow race on a very first read — two concurrent requests both finding
 * no row and both creating one — is accepted and self-healing: subsequent reads take whichever
 * row findFirst returns, and the fields are admin-authored, not derived. Deliberately no locking
 * or transaction here; that would be more machinery than a single-admin tool warrants, and this
 * codebase already accepts the same class of trade-off in deleteCustomer's count-then-delete gap.
 */
import { prisma } from '@/lib/prisma'

export async function getNotificationSettings() {
  const existing = await prisma.notificationSettings.findFirst()
  if (existing) return existing
  // Empty create — every column's default lives in the schema, so there is exactly one place
  // defining what an unconfigured install looks like.
  return prisma.notificationSettings.create({ data: {} })
}

export async function getLoginSettings() {
  const existing = await prisma.loginSettings.findFirst()
  if (existing) return existing
  return prisma.loginSettings.create({ data: {} })
}

/**
 * The browser-safe projection of NotificationSettings.
 *
 * Secret fields collapse to a `*Set` boolean — the raw value is NEVER returned, because anything
 * this function returns ends up serialized into the page's RSC payload and is readable from the
 * browser regardless of whether any component chooses to render it. Non-secret configuration
 * (from-email, sender id, template names/language, the three enabled flags) round-trips in full:
 * it isn't sensitive and the admin needs to see and edit the current values directly.
 */
export async function getMaskedNotificationSettings() {
  const s = await getNotificationSettings()
  return {
    fromEmail: s.fromEmail,
    arkeselSenderId: s.arkeselSenderId,
    whatsappPhoneNumberId: s.whatsappPhoneNumberId,
    whatsappTemplateName: s.whatsappTemplateName,
    whatsappLowStockTemplateName: s.whatsappLowStockTemplateName,
    whatsappTemplateLanguage: s.whatsappTemplateLanguage,
    emailEnabled: s.emailEnabled,
    smsEnabled: s.smsEnabled,
    whatsappEnabled: s.whatsappEnabled,
    resendApiKeySet: Boolean(s.resendApiKey),
    arkeselApiKeySet: Boolean(s.arkeselApiKey),
    whatsappAccessTokenSet: Boolean(s.whatsappAccessToken),
    whatsappAppSecretSet: Boolean(s.whatsappAppSecret),
    whatsappWebhookVerifyTokenSet: Boolean(s.whatsappWebhookVerifyToken),
  }
}

export type MaskedNotificationSettings = Awaited<ReturnType<typeof getMaskedNotificationSettings>>
