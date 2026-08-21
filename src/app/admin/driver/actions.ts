"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { getCurrentDbUser } from '@/lib/auth'

export async function getDriverOrders() {
  const dbUser = await getCurrentDbUser()
  if (!dbUser || (dbUser.role !== 'ADMIN' && dbUser.role !== 'DELIVERY_DRIVER')) {
    throw new Error('Unauthorized')
  }

  // For now, fetch all READY orders as unassigned pool, or assigned if we add assignment later
  const orders = await prisma.order.findMany({
    where: {
      status: 'READY'
    },
    include: {
      customer: true,
      dishes: true
    },
    orderBy: {
      updatedAt: 'asc' // Oldest READY orders first
    }
  })

  return orders
}

export async function completeDelivery(orderId: string) {
  const dbUser = await getCurrentDbUser()
  if (!dbUser || (dbUser.role !== 'ADMIN' && dbUser.role !== 'DELIVERY_DRIVER')) {
    throw new Error('Unauthorized')
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'COMPLETED' },
    include: { customer: true }
  })

  revalidatePath('/admin/driver')
  revalidatePath('/admin/orders')
  revalidatePath('/dashboard')

  // Attempt to send an SMS
  try {
    const { sendSms } = await import('@/lib/notifications/sms')
    const phone = order.deliveryPhone || order.customer.phone
    if (phone) {
      await sendSms({ to: phone, message: `Your Chop with Rostty order #${order.shortId} has arrived! Enjoy your meal.` })
    }
  } catch (err) {
    console.error('Failed to send delivery SMS:', err)
  }

  return { ok: true }
}
