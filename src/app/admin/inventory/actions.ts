"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { Category } from '@prisma/client'

export async function getInventoryItems() {
  return await prisma.inventoryItem.findMany({
    orderBy: {
      name: 'asc'
    }
  })
}

export async function createInventoryItem(data: { name: string, currentStock: number, unit: string, minimumThreshold?: number | null, category: Category }) {
  const item = await prisma.inventoryItem.create({
    data: {
      name: data.name,
      currentStock: data.currentStock,
      unit: data.unit,
      category: data.category,
      minimumThreshold: data.minimumThreshold || 0,
    }
  })
  
  revalidatePath('/admin/inventory')
  return item
}

export async function updateInventoryItem(id: string, data: { name?: string, currentStock?: number, unit?: string, minimumThreshold?: number | null, category?: Category }) {
  const item = await prisma.inventoryItem.update({
    where: { id },
    data
  })
  
  revalidatePath('/admin/inventory')
  return item
}

export async function deleteInventoryItem(id: string) {
  await prisma.inventoryItem.delete({
    where: { id }
  })
  
  revalidatePath('/admin/inventory')
}
