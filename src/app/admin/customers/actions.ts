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

export async function createCustomer(data: { name?: string, email?: string, phone?: string }) {
  const item = await prisma.user.create({
    data: {
      name: data.name || null,
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

export async function updateCustomer(id: string, data: { name?: string, email?: string, phone?: string }) {
  const item = await prisma.user.update({
    where: { id },
    data: {
      name: data.name || null,
      email: data.email || null,
      phone: data.phone || null,
    }
  })
  
  revalidatePath('/admin/customers')
  return item
}
