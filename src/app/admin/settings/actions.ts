"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import {
  getLoginSettings,
  getMaskedNotificationSettings,
  getNotificationSettings,
  type MaskedNotificationSettings,
} from '@/lib/settings'
import { updateLoginSettingsSchema, updateNotificationSettingsSchema } from '@/lib/validation'
import type { LoginSettings } from '@prisma/client'
import { z } from 'zod'

/**
 * "Blank means keep, never clear."
 *
 * Applied to exactly the five secret fields whose stored values are never sent to the browser:
 * resendApiKey, arkeselApiKey, whatsappAccessToken, whatsappAppSecret, whatsappWebhookVerifyToken.
 *
 * The Settings UI cannot show a stored secret (getMaskedNotificationSettings deliberately doesn't
 * return one), so a secret input arrives empty on every save where the admin didn't retype it —
 * which is most saves. Writing '' in that case would silently wipe a working credential every time
 * the admin edited something unrelated on the same form. Returning undefined makes Prisma skip the
 * column entirely.
 *
 * Clearing a secret on purpose is therefore not expressible through this form, which is the right
 * trade: accidentally destroying a live credential is a far more likely and more damaging mistake
 * than being unable to blank one out from the UI.
 */
function keepIfBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export async function getSettings(): Promise<{
  notifications: MaskedNotificationSettings
  login: LoginSettings
}> {
  await requireAdmin() // throws AuthError — reads have no expected-error case, so no ActionResult
  const [notifications, login] = await Promise.all([
    getMaskedNotificationSettings(),
    getLoginSettings(),
  ])
  return { notifications, login }
}

export async function updateNotificationSettings(
  data: z.input<typeof updateNotificationSettingsSchema>
): Promise<ActionResult<MaskedNotificationSettings>> {
  await requireAdmin()

  let masked: MaskedNotificationSettings
  try {
    const input = updateNotificationSettingsSchema.parse(data)

    // Ensures the singleton row exists before updating it, and gives us its id.
    const existing = await getNotificationSettings()

    await prisma.notificationSettings.update({
      where: { id: existing.id },
      data: {
        // Secrets: blank leaves the stored value alone.
        resendApiKey: keepIfBlank(input.resendApiKey),
        arkeselApiKey: keepIfBlank(input.arkeselApiKey),
        whatsappAccessToken: keepIfBlank(input.whatsappAccessToken),
        whatsappAppSecret: keepIfBlank(input.whatsappAppSecret),
        whatsappWebhookVerifyToken: keepIfBlank(input.whatsappWebhookVerifyToken),
        // Non-secrets: round-trip in full through the UI, so the submitted value is authoritative
        // and blanking one is a legitimate edit.
        fromEmail: input.fromEmail || null,
        arkeselSenderId: input.arkeselSenderId || null,
        whatsappPhoneNumberId: input.whatsappPhoneNumberId || null,
        whatsappTemplateName: input.whatsappTemplateName || null,
        whatsappLowStockTemplateName: input.whatsappLowStockTemplateName || null,
        whatsappTemplateLanguage: input.whatsappTemplateLanguage || null,
        emailEnabled: input.emailEnabled,
        smsEnabled: input.smsEnabled,
        whatsappEnabled: input.whatsappEnabled,
      },
    })

    // Re-read through the masking projection: the caller is a browser, so it must never receive
    // the raw row this update just wrote.
    masked = await getMaskedNotificationSettings()
  } catch (err) {
    return toErrorResult(err, 'Could not save these notification settings. Please try again.')
  }

  revalidatePath('/admin/settings')
  return okResult(masked)
}

export async function updateLoginSettings(
  data: z.input<typeof updateLoginSettingsSchema>
): Promise<ActionResult<LoginSettings>> {
  await requireAdmin()

  let row: LoginSettings
  try {
    const input = updateLoginSettingsSchema.parse(data)
    const existing = await getLoginSettings()

    row = await prisma.loginSettings.update({
      where: { id: existing.id },
      data: {
        emailLoginEnabled: input.emailLoginEnabled,
        phoneLoginEnabled: input.phoneLoginEnabled,
      },
    })
  } catch (err) {
    return toErrorResult(err, 'Could not save these login settings. Please try again.')
  }

  revalidatePath('/admin/settings')
  return okResult(row)
}
