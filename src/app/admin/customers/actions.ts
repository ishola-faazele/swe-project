"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { type LoginMethod } from '@prisma/client'
import { requireAdmin, requireStaffOrAdmin } from '@/lib/auth'
import { createAdminClient } from '@/utils/supabase/admin'
import { notifyAccountCreated } from '@/lib/notifications'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { createCustomerSchema, idSchema, updateCustomerSchema } from '@/lib/validation'
import type { ClientSafeUser } from '@/lib/user'

// authEmail is an internal Supabase-identity detail that must never reach the browser. Every
// query in this file that returns a User row feeds CustomerClient as initialData, and RSC props
// are inspectable client-side regardless of what gets rendered — so it is excluded at the query.
// See src/lib/user.ts for why this is per-query rather than a global Prisma omit.
const OMIT_AUTH_EMAIL = { authEmail: true } as const

export async function getCustomers() {
  await requireStaffOrAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return await prisma.user.findMany({
    where: {
      role: 'CUSTOMER'
    },
    omit: OMIT_AUTH_EMAIL,
    include: {
      _count: {
        select: { orders: true }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })
}

/**
 * Builds the click-to-log-in URL for a new email-preferred customer.
 *
 * Points at /auth/confirm, NOT at generateLink's own `action_link`: that field is an implicit-flow
 * URL delivering credentials in the fragment, which a browser never sends to a server, so it
 * cannot be redeemed by a server-rendered app. See src/app/auth/confirm/route.ts.
 *
 * ⚠ `type` is read back from the response's own `verification_type` — never a hard-coded literal.
 * Supabase reports "signup" when generateLink auto-creates an identity that didn't exist yet
 * (the normal case for a customer the admin just created) and "magiclink" afterwards; redeeming
 * one as the other 403s.
 *
 * Returns null rather than throwing on any failure: a customer must still be created successfully
 * even if their welcome link could not be minted.
 */
export async function buildAccountMagicLink(email: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (error || !data?.properties) {
      console.error('[Customers] Could not generate a sign-in link:', error?.message)
      return null
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const params = new URLSearchParams({
      token_hash: data.properties.hashed_token,
      type: data.properties.verification_type,
    })
    return `${siteUrl}/auth/confirm?${params.toString()}`
  } catch (err) {
    console.error('[Customers] Could not generate a sign-in link:', err)
    return null
  }
}

export async function createCustomer(
  data: { name: string, email?: string, phone?: string, notes?: string }
): Promise<ActionResult<ClientSafeUser>> {
  await requireAdmin()

  let item: ClientSafeUser
  let magicLink: string | null = null
  let preferredLoginMethod: LoginMethod
  try {
    const input = createCustomerSchema.parse(data)

    // Always computed explicitly. The schema's EMAIL column default is a safe fallback for the
    // name-only customer only — never the source of truth for someone who does have contact info.
    preferredLoginMethod = input.email ? 'EMAIL' : input.phone ? 'PHONE' : 'EMAIL'

    if (input.email) {
      magicLink = await buildAccountMagicLink(input.email)
    }

    item = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        preferredLoginMethod,
        role: 'CUSTOMER',
        isActive: true,
        notes: input.notes,
      },
      omit: OMIT_AUTH_EMAIL,
    })
  } catch (err) {
    return toErrorResult(err, 'Could not create this customer. Please try again.')
  }

  // Fire-and-forget, matching every other notification call site in this app: the customer row is
  // created and returned regardless of what happens to the welcome message. A name-only customer
  // no-ops cleanly inside notifyAccountCreated rather than erroring here.
  notifyAccountCreated({
    customerName: item.name,
    customerEmail: item.email,
    customerPhone: item.phone,
    magicLink,
  })

  revalidatePath('/admin/customers')
  return okResult(item)
}

export async function deleteCustomer(id: string): Promise<ActionResult<{ archived: boolean }>> {
  await requireAdmin()

  try {
    const parsedId = idSchema.parse(id)

    // Pre-check gives a specific, useful count instead of relying only on the P2003 catch.
    // Order.customer has no onDelete clause (Prisma defaults to Restrict), so without this the
    // delete surfaces as a raw 500. The small TOCTOU window between this count and the delete is
    // accepted for a single-admin tool; toErrorResult's P2003 branch backstops it.
    const orderCount = await prisma.order.count({ where: { customerId: parsedId } })
    if (orderCount > 0) {
      await prisma.user.update({
        where: { id: parsedId },
        data: { isActive: false }
      })
      revalidatePath('/admin/customers')
      return okResult({ archived: true })
    }

    await prisma.user.delete({
      where: { id: parsedId }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not delete this customer. Please try again.')
  }

  revalidatePath('/admin/customers')
  return okResult({ archived: false })
}

/**
 * Deliberately does NOT accept email or phone — see validation.ts's updateCustomerSchema for why
 * contact info is write-once by the admin. Only `name` and `preferredLoginMethod` are editable.
 *
 * `imageUrl` is deliberately NOT writable here either, for a different reason: a customer's photo
 * is self-service only. The admin keeps read access (the customer table's avatar column) but has
 * no write path to it at all — see the PRD's Non-Goals. dashboard/actions.ts's updateProfilePhoto
 * is the column's sole writer.
 */
export async function updateCustomer(
  id: string,
  data: { name: string, notes?: string }
): Promise<ActionResult<ClientSafeUser>> {
  await requireAdmin()

  let item: ClientSafeUser
  try {
    const input = updateCustomerSchema.parse({ id, ...data })

    item = await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name,
        notes: input.notes,
      },
      omit: OMIT_AUTH_EMAIL,
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this customer. Please try again.')
  }

  revalidatePath('/admin/customers')
  return okResult(item)
}

export async function toggleCustomerActive(id: string, isActive: boolean): Promise<ActionResult<ClientSafeUser>> {
  await requireAdmin()

  let item: ClientSafeUser
  try {
    const parsedId = idSchema.parse(id)

    item = await prisma.user.update({
      where: { id: parsedId },
      data: { isActive },
      omit: OMIT_AUTH_EMAIL,
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this customer. Please try again.')
  }

  revalidatePath('/admin/customers')
  return okResult(item)
}
