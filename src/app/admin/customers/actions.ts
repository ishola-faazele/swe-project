"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { type User } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { createCustomerSchema, idSchema, updateCustomerSchema } from '@/lib/validation'

export async function getCustomers() {
  await requireAdmin() // throws AuthError — no ActionResult wrapping; reads have no expected-error case
  return await prisma.user.findMany({
    where: {
      role: 'CUSTOMER'
    },
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

export async function createCustomer(data: { name: string, email?: string, phone?: string }): Promise<ActionResult<User>> {
  await requireAdmin()

  let item: User
  try {
    const input = createCustomerSchema.parse(data)

    item = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        role: 'CUSTOMER',
        isActive: true
      }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not create this customer. Please try again.')
  }

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

export async function updateCustomer(id: string, data: { name: string, email?: string, phone?: string }): Promise<ActionResult<User>> {
  await requireAdmin()

  let item: User
  try {
    const input = updateCustomerSchema.parse({ id, ...data })

    // All three fields are overwritten on every call, preserving existing behavior — which is
    // why updateCustomerSchema's at-least-one-contact-method refinement also prevents an edit
    // that would blank out every way of reaching this customer.
    item = await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
      }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not update this customer. Please try again.')
  }

  revalidatePath('/admin/customers')
  return okResult(item)
}
