"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { getNotificationSettings } from '@/lib/settings'
import { updateNotificationSettingsSchema } from '@/lib/validation'
import type { NotificationSettings } from '@prisma/client'
import { z } from 'zod'

/**
 * The Auth tab's read-only display data — the admin's own login identity (ADMIN_EMAIL/
 * ADMIN_PHONE, set at deploy time via env, never editable here). Nothing here is a toggle: it's
 * purely informational.
 */
export type AuthDisplay = {
  adminEmail: string | null
  adminPhone: string | null
}

export async function getSettings(): Promise<{
  notifications: NotificationSettings
  auth: AuthDisplay
}> {
  await requireAdmin() // throws AuthError — reads have no expected-error case, so no ActionResult
  const notifications = await getNotificationSettings()
  return {
    notifications,
    auth: {
      adminEmail: process.env.ADMIN_EMAIL || null,
      adminPhone: process.env.ADMIN_PHONE || null,
    },
  }
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
        alertEmail: input.alertEmail ?? null,
        smsEnabled: input.smsEnabled,
        alertPhone: input.alertPhone ?? null,
        whatsappEnabled: input.whatsappEnabled,
        alertWhatsapp: input.alertWhatsapp ?? null,
      },
    })
  } catch (err) {
    return toErrorResult(err, 'Could not save these notification settings. Please try again.')
  }

  revalidatePath('/admin/settings')
  revalidatePath('/login')
  return okResult(row)
}
