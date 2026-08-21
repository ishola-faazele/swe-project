"use server"

import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export async function getAuditLogs() {
  await requireAdmin()
  
  return await prisma.auditLog.findMany({
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          shortId: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 500 // Limit to last 500 actions for simple viewing
  })
}
