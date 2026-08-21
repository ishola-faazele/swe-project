"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { buildAccountMagicLink } from '@/app/admin/customers/actions'
import { notifyAccountCreated } from '@/lib/notifications'

export async function getTeam() {
  await requireAdmin()
  return await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'KITCHEN_STAFF', 'DELIVERY_DRIVER'] }
    },
    omit: { authEmail: true },
    orderBy: { createdAt: 'desc' }
  })
}

import { toGhanaE164 } from '@/lib/phone'

export async function addStaff(
  data: { name: string; email: string; phone: string; role: 'KITCHEN_STAFF' | 'DELIVERY_DRIVER' },
  confirmPromote: boolean = false
): Promise<ActionResult<{ promoted: boolean }>> {
  const admin = await requireAdmin()
  
  const email = data.email.trim()
  const rawPhone = data.phone.trim()
  const phone = rawPhone ? toGhanaE164(rawPhone) : null
  const name = data.name.trim()

  if (rawPhone && !phone) {
    return toErrorResult(new Error('Enter a valid Ghanaian phone number.'), 'Invalid input')
  }

  if (!name || (!email && !phone)) {
    return toErrorResult(new Error('Name and either Email or Phone are required.'), 'Invalid input')
  }

  try {
    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : [])
        ]
      }
    })
    
    if (targetUser) {
      if (targetUser.role === 'ADMIN') throw new Error('Cannot modify an ADMIN account.')
      if (targetUser.role === 'KITCHEN_STAFF' || targetUser.role === 'DELIVERY_DRIVER') throw new Error('User is already STAFF or DRIVER.')

      if (!confirmPromote) {
        return toErrorResult(new Error('CUSTOMER_EXISTS'), 'CUSTOMER_EXISTS')
      }

      await prisma.user.update({
        where: { id: targetUser.id },
        data: { 
          role: data.role,
          name: name || targetUser.name,
          email: email || targetUser.email,
          phone: phone || targetUser.phone
        }
      })
      
      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'ROLE_UPDATED',
          details: `Promoted existing customer ${name} to ${data.role}`
        }
      })
      
      revalidatePath('/admin/team')
      return okResult({ promoted: true })
    } else {
      const preferredLoginMethod = email ? 'EMAIL' : phone ? 'PHONE' : 'EMAIL'
      let magicLink: string | null = null
      if (email) {
        magicLink = await buildAccountMagicLink(email)
      }

      await prisma.user.create({
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: data.role,
          createdAsRole: data.role,
          preferredLoginMethod
        }
      })

      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'USER_CREATED',
          details: `Created new ${data.role} member ${name}`
        }
      })
      
      notifyAccountCreated({
        customerName: name,
        customerEmail: email || null,
        customerPhone: phone || null,
        magicLink,
      })

      revalidatePath('/admin/team')
      return okResult({ promoted: false })
    }
  } catch (err) {
    return toErrorResult(err, 'Could not add staff.')
  }
}

export async function demoteToCustomer(id: string): Promise<ActionResult<void>> {
  const user = await requireAdmin()
  try {
    const targetUser = await prisma.user.findUnique({ where: { id } })
    if (!targetUser) throw new Error('User not found.')
    if (targetUser.role === 'ADMIN') throw new Error('Cannot demote an ADMIN account.')
    if (targetUser.createdAsRole === 'KITCHEN_STAFF' || targetUser.createdAsRole === 'DELIVERY_DRIVER') throw new Error('Cannot demote a dedicated STAFF/DRIVER account.')
    
    await prisma.user.update({
      where: { id },
      data: { role: 'CUSTOMER' }
    })
    
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'ROLE_UPDATED',
        details: `Demoted ${targetUser.name || targetUser.email || targetUser.phone} to CUSTOMER`
      }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not demote user.')
  }
  
  revalidatePath('/admin/team')
  return okResult(undefined)
}

export async function deleteStaff(id: string): Promise<ActionResult<void>> {
  const user = await requireAdmin()
  try {
    const targetUser = await prisma.user.findUnique({ where: { id } })
    if (!targetUser) throw new Error('User not found.')
    if (targetUser.role === 'ADMIN') throw new Error('Cannot delete an ADMIN account.')
    if (targetUser.createdAsRole !== 'KITCHEN_STAFF' && targetUser.createdAsRole !== 'DELIVERY_DRIVER') throw new Error('Cannot directly delete a promoted customer.')
    
    await prisma.user.delete({
      where: { id }
    })
    
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_DELETED',
        details: `Deleted ${targetUser.role} member ${targetUser.name || targetUser.email || targetUser.phone}`
      }
    })
  } catch (err) {
    return toErrorResult(err, 'Could not delete staff.')
  }
  
  revalidatePath('/admin/team')
  return okResult(undefined)
}

