"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { getLoginSettings, getNotificationSettings } from '@/lib/settings'
import { updateLoginSettingsSchema, updateNotificationSettingsSchema } from '@/lib/validation'
import type { LoginSettings, NotificationSettings } from '@prisma/client'
import { z } from 'zod'

export async function getSettings(): Promise<{
  notifications: NotificationSettings
  login: LoginSettings
}> {
  await requireAdmin() // throws AuthError — reads have no expected-error case, so no ActionResult
  const [notifications, login] = await Promise.all([
    getNotificationSettings(),
    getLoginSettings(),
  ])
  return { notifications, login }
}

export async function updateNotificationSettings(
  data: z.input<typeof updateNotificationSettingsSchema>
): Promise<ActionResult<NotificationSettings>> {
  await requireAdmin()

  let row: NotificationSettings
  try {
    const input = updateNotificationSettingsSchema.parse(data)
    const existing = await getNotificationSettings()

    row = await prisma.notificationSettings.update({
      where: { id: existing.id },
      data: {
        emailEnabled: input.emailEnabled,
        smsEnabled: input.smsEnabled,
        whatsappEnabled: input.whatsappEnabled,
      },
    })
  } catch (err) {
    return toErrorResult(err, 'Could not save these notification settings. Please try again.')
  }

  revalidatePath('/admin/settings')
  return okResult(row)
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
