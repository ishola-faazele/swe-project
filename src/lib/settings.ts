/**
 * DB-backed settings accessors — on/off toggles for notification channels and login methods.
 *
 * Provider credentials are NOT here — they live in `.env`, exactly as they always have. This
 * file only ever held toggles; a broader "credentials in the DB too" version briefly shipped and
 * was reverted (see docs/ROADMAP.md for why) — every sender module reads its own credentials
 * from `process.env` directly, and only checks these toggles for the enabled/disabled decision.
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
  return prisma.notificationSettings.create({ data: {} })
}

export async function getLoginSettings() {
  const existing = await prisma.loginSettings.findFirst()
  if (existing) return existing
  return prisma.loginSettings.create({ data: {} })
}

/**
 * Whether Arkesel is configured at all, independent of whether SMS is toggled on. Used to warn
 * the admin in Settings/Login UI that turning phone login on won't do anything useful yet, and
 * by the login page to hide the phone option entirely when no code could actually be delivered.
 */
export function isArkeselConfigured(): boolean {
  return Boolean(process.env.ARKESEL_API_KEY && process.env.ARKESEL_SENDER_ID)
}
