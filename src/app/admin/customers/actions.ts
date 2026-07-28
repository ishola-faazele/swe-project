"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function getCustomers() {
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

export async function createCustomer(data: { email?: string, phone?: string }) {
  const item = await prisma.user.create({
    data: {
      email: data.email || null,
      phone: data.phone || null,
      role: 'CUSTOMER'
    }
  })
  
  revalidatePath('/admin/customers')
  return item
}

export async function deleteCustomer(id: string) {
  await prisma.user.delete({
    where: { id }
  })
  
  revalidatePath('/admin/customers')
}
