/**
 * DB-backed settings accessor — on/off toggles (+ the owner's alert-destination contacts) for
 * notification channels.
 *
 * Provider credentials are NOT here — they live in `.env`, exactly as they always have. This
 * file only ever held toggles; a broader "credentials in the DB too" version briefly shipped and
 * was reverted (see docs/ROADMAP.md for why) — every sender module reads its own credentials
 * from `process.env` directly, and only checks these toggles for the enabled/disabled decision.
 *
 * The table is an application-level singleton (findFirst, create-if-absent) rather than a
 * DB-enforced one. The narrow race on a very first read — two concurrent requests both finding
 * no row and both creating one — is accepted and self-healing: subsequent reads take whichever
 * row findFirst returns, and the fields are admin-authored, not derived. Deliberately no locking
 * or transaction here; that would be more machinery than a single-admin tool warrants, and this
 * codebase already accepts the same class of trade-off in deleteCustomer's count-then-delete gap.
 *
 * There is no separate LoginSettings table (removed) — login availability isn't a toggle anyone
 * sets. Email login is unconditionally available, exactly as it always was before phone login
 * existed; phone login is available whenever it's actually deliverable (see
 * isPhoneLoginAvailable below), never gated behind a manual switch.
 */
import { prisma } from '@/lib/prisma'

export async function getNotificationSettings() {
  const existing = await prisma.notificationSettings.findFirst()
  if (existing) return existing
  return prisma.notificationSettings.create({ data: {} })
}

/**
 * Whether Arkesel is configured at all, independent of whether SMS is toggled on. Used by the
 * login page and Settings' read-only Auth display to explain why phone login isn't showing.
 */
export function isArkeselConfigured(): boolean {
  return Boolean(process.env.ARKESEL_API_KEY && process.env.ARKESEL_SENDER_ID)
}

/**
 * Phone login is available whenever a code could actually be delivered — the SMS channel is
 * toggled on AND Arkesel is configured. No separate "phone login enabled" switch: that would be a
 * toggle with no real second state (an admin who wants phone login off just turns SMS off, which
 * already kills every other SMS-dependent thing at once).
 *
 * Shared by the login page (to decide whether to render the Phone tab), both phone-login Server
 * Actions (re-checked independently — every Server Action is an independently POST-able
 * endpoint, so hiding the UI is not an enforcement boundary), and the Settings page's read-only
 * Auth display.
 */
export async function isPhoneLoginAvailable(): Promise<boolean> {
  const settings = await getNotificationSettings()
  return Boolean(settings.smsEnabled && isArkeselConfigured())
}
