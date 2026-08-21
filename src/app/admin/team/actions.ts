"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'

export async function getTeam() {
  await requireAdmin()
  return await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'STAFF'] }
    },
    omit: { authEmail: true },
    orderBy: { createdAt: 'desc' }
  })
}

export async function addStaff(data: { name: string; email: string; phone: string }): Promise<ActionResult<void>> {
  const admin = await requireAdmin()
  
  const email = data.email.trim()
  const phone = data.phone.trim()
  const name = data.name.trim()

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
      if (targetUser.role === 'STAFF') throw new Error('User is already STAFF.')

      await prisma.user.update({
        where: { id: targetUser.id },
        data: { 
          role: 'STAFF',
          name: name || targetUser.name,
          email: email || targetUser.email,
          phone: phone || targetUser.phone
        }
      })
      
      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'ROLE_UPDATED',
          details: `Promoted existing customer ${name} to STAFF`
        }
      })
    } else {
      await prisma.user.create({
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: 'STAFF'
        }
      })

      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'USER_CREATED',
          details: `Created new STAFF member ${name}`
        }
      })
    }
  } catch (err) {
    return toErrorResult(err, 'Could not add staff.')
  }
  
  revalidatePath('/admin/team')
  return okResult(undefined)
}

export async function demoteToCustomer(id: string): Promise<ActionResult<void>> {
  const user = await requireAdmin()
  try {
    const targetUser = await prisma.user.findUnique({ where: { id } })
    if (!targetUser) throw new Error('User not found.')
    if (targetUser.role === 'ADMIN') throw new Error('Cannot demote an ADMIN account.')
    
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
