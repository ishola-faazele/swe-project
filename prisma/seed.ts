import { PrismaClient, type OrderStatus } from '@prisma/client'
import { computeDishSubtotal, expandDishesToIngredients, type DishWithRecipe } from '../src/lib/recipe'

const prisma = new PrismaClient()

async function main() {
  // Children before parents — no `onDelete` is declared anywhere in schema.prisma, so every
  // relation is RESTRICT and this ordering is what makes a re-run of the seed succeed.
  console.log('Cleaning up existing data...')
  await prisma.orderIngredientLog.deleteMany()
  await prisma.orderDish.deleteMany()
  await prisma.dishIngredient.deleteMany()
  await prisma.dishMedia.deleteMany()
  await prisma.order.deleteMany()
  await prisma.dish.deleteMany()
  await prisma.user.deleteMany()
  await prisma.stockAdjustmentLog.deleteMany()
  await prisma.inventoryItem.deleteMany()

  console.log('Seeding Customers...')
  const customerData: { name: string, email: string, phone: string }[] = []

  const customers = []
  for (const data of customerData) {
    const user = await prisma.user.create({ data })
    customers.push(user)
  }

  console.log('Seeding Inventory Items...')
  await prisma.inventoryItem.createMany({
    data: [
      { name: 'Long Grain Rice', category: 'INGREDIENT', unit: 'kg', currentStock: 80, minimumThreshold: 15 },
      { name: 'Tomatoes', category: 'INGREDIENT', unit: 'kg', currentStock: 25, minimumThreshold: 8 },
      { name: 'Red Pepper', category: 'INGREDIENT', unit: 'kg', currentStock: 15, minimumThreshold: 5 },
      { name: 'Scotch Bonnet (Kpakposhito)', category: 'INGREDIENT', unit: 'kg', currentStock: 2, minimumThreshold: 1 },
      { name: 'Chicken', category: 'INGREDIENT', unit: 'kg', currentStock: 40, minimumThreshold: 10 },
      { name: 'Tilapia', category: 'INGREDIENT', unit: 'kg', currentStock: 20, minimumThreshold: 5 },
      { name: 'Palm Oil', category: 'INGREDIENT', unit: 'litres', currentStock: 30, minimumThreshold: 8 },
      { name: 'Groundnut Oil', category: 'INGREDIENT', unit: 'litres', currentStock: 20, minimumThreshold: 5 },
      { name: 'Onions', category: 'INGREDIENT', unit: 'kg', currentStock: 30, minimumThreshold: 8 },
      { name: 'Cassava Dough', category: 'INGREDIENT', unit: 'kg', currentStock: 50, minimumThreshold: 15 },
      { name: 'Corn Dough', category: 'INGREDIENT', unit: 'kg', currentStock: 50, minimumThreshold: 15 },
      { name: 'Beans (Red)', category: 'INGREDIENT', unit: 'kg', currentStock: 40, minimumThreshold: 10 },
      { name: 'Shito (Black Pepper Sauce)', category: 'INGREDIENT', unit: 'litres', currentStock: 10, minimumThreshold: 3 },
      { name: 'Maggi Seasoning', category: 'INGREDIENT', unit: 'cubes', currentStock: 400, minimumThreshold: 50 },
      { name: 'Plantain', category: 'INGREDIENT', unit: 'bunches', currentStock: 25, minimumThreshold: 8 },
      
      { name: 'Chilled Water', category: 'DRINK', unit: 'crates', currentStock: 20, minimumThreshold: 5 },
      { name: 'Soft Drinks', category: 'DRINK', unit: 'crates', currentStock: 15, minimumThreshold: 4 },
      { name: 'Malt Drinks', category: 'DRINK', unit: 'crates', currentStock: 5, minimumThreshold: 3 },
      
      { name: 'Food Packs', category: 'PACKAGING', unit: 'pieces', currentStock: 200, minimumThreshold: 50 },
      { name: 'Takeaway Bags', category: 'PACKAGING', unit: 'pieces', currentStock: 300, minimumThreshold: 80 },
      { name: 'Foil Trays', category: 'PACKAGING', unit: 'pieces', currentStock: 30, minimumThreshold: 40 },
    ]
  })

  const inventoryItems = await prisma.inventoryItem.findMany()
  const inventoryByName = new Map(inventoryItems.map(item => [item.name, item]))

  function recipeLine(itemName: string, quantityPerDish: number) {
    const item = inventoryByName.get(itemName)
    if (!item) throw new Error(`Seed error: no inventory item named "${itemName}"`)
    return { inventoryItemId: item.id, quantityPerDish }
  }

  console.log('Seeding Dishes...')
  const dishData = [
    {
      name: 'Ghana Jollof',
      price: 60,
      ingredients: [
        recipeLine('Long Grain Rice', 0.25),
        recipeLine('Tomatoes', 0.15),
        recipeLine('Red Pepper', 0.05),
        recipeLine('Groundnut Oil', 0.05),
        recipeLine('Onions', 0.05),
        recipeLine('Maggi Seasoning', 2),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1598514982205-f36b96d1e8d4?w=800&q=80', type: 'IMAGE' as const, position: 0 },
        { url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=800&q=80', type: 'IMAGE' as const, position: 1 },
      ]
    },
    {
      name: 'Banku & Tilapia',
      price: 80,
      ingredients: [
        recipeLine('Corn Dough', 0.3),
        recipeLine('Cassava Dough', 0.15),
        recipeLine('Tilapia', 0.3),
        recipeLine('Tomatoes', 0.1),
        recipeLine('Scotch Bonnet (Kpakposhito)', 0.02),
        recipeLine('Onions', 0.05),
        recipeLine('Shito (Black Pepper Sauce)', 0.05),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Red Red (Gob3)',
      price: 40,
      ingredients: [
        recipeLine('Beans (Red)', 0.2),
        recipeLine('Palm Oil', 0.08),
        recipeLine('Plantain', 0.1),
        recipeLine('Tomatoes', 0.05),
        recipeLine('Onions', 0.05),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1626200419111-39589d89776d?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Waakye',
      price: 45,
      ingredients: [
        recipeLine('Long Grain Rice', 0.2),
        recipeLine('Beans (Red)', 0.1),
        recipeLine('Shito (Black Pepper Sauce)', 0.05),
        recipeLine('Plantain', 0.1),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1623859763838-a304cbfd4901?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Kelewele',
      price: 30,
      ingredients: [
        recipeLine('Plantain', 0.2),
        recipeLine('Groundnut Oil', 0.05),
        recipeLine('Takeaway Bags', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Grilled Chicken',
      price: 35,
      ingredients: [
        recipeLine('Chicken', 0.3),
        recipeLine('Red Pepper', 0.02),
        recipeLine('Groundnut Oil', 0.03),
        recipeLine('Maggi Seasoning', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
  ]

  const dishes: DishWithRecipe[] = []
  for (const data of dishData) {
    const dish = await prisma.dish.create({
      data: {
        name: data.name,
        price: data.price,
        ingredients: { create: data.ingredients },
        media: { create: data.media }
      },
      include: { ingredients: true },
    })
    dishes.push(dish)
  }

  console.log('Seeding Orders...')
  const orderData: { customerIndex: number, description: string, status: string, totalPrice: number }[] = []

  // Only a subset of orders carries structured dish line items. The rest deliberately keep zero
  // OrderDish rows so a fresh local database exercises BOTH the new dish-based rendering path and
  // the legacy (pre-Menu) empty-dishes path side by side.
  const orderDishPlan: Record<number, { dishName: string; quantity: number }[]> = {
    0: [{ dishName: 'Ghana Jollof', quantity: 5 }, { dishName: 'Grilled Chicken', quantity: 10 }],
    2: [{ dishName: 'Ghana Jollof', quantity: 20 }, { dishName: 'Grilled Chicken', quantity: 20 }],
    4: [{ dishName: 'Red Red (Gob3)', quantity: 10 }],
    6: [{ dishName: 'Ghana Jollof', quantity: 10 }, { dishName: 'Grilled Chicken', quantity: 10 }],
    7: [
      { dishName: 'Ghana Jollof', quantity: 25 },
      { dishName: 'Banku & Tilapia', quantity: 25 },
      { dishName: 'Kelewele', quantity: 20 },
    ],
    9: [{ dishName: 'Waakye', quantity: 4 }],
  }

  for (const [index, data] of orderData.entries()) {
    const selections = (orderDishPlan[index] ?? []).map(planned => {
      const dish = dishes.find(d => d.name === planned.dishName)
      if (!dish) throw new Error(`Seed error: no dish named "${planned.dishName}"`)
      return { dish, quantity: planned.quantity }
    })
    const dishSelections = selections.map(s => ({ dishId: s.dish.id, quantity: s.quantity }))

    const order = await prisma.order.create({
      data: {
        customerId: customers[data.customerIndex].id,
        description: data.description,
        status: data.status as OrderStatus,
        // Dish-backed orders price themselves off the catalog, exactly as the create-order form does.
        totalPrice: selections.length > 0
          ? computeDishSubtotal(dishSelections, dishes)
          : data.totalPrice,
      }
    })

    if (selections.length > 0) {
      for (const selection of selections) {
        await prisma.orderDish.create({
          data: {
            orderId: order.id,
            dishId: selection.dish.id,
            dishName: selection.dish.name,
            unitPrice: selection.dish.price,
            quantity: selection.quantity,
          }
        })
      }

      // Ingredient logs for a dish-backed order are the merged expansion of its recipes — the same
      // shape createOrder writes — so seeded orders stay internally consistent.
      for (const line of expandDishesToIngredients(dishSelections, dishes)) {
        await prisma.orderIngredientLog.create({
          data: {
            orderId: order.id,
            inventoryItemId: line.inventoryItemId,
            quantityUsed: line.quantityUsed,
          }
        })
      }
    } else {
      const numLogs = Math.floor(Math.random() * 2) + 2
      for (let i = 0; i < numLogs; i++) {
        const item = inventoryItems[Math.floor(Math.random() * inventoryItems.length)]
        await prisma.orderIngredientLog.create({
          data: {
            orderId: order.id,
            inventoryItemId: item.id,
            quantityUsed: Math.floor(Math.random() * 5) + 1
          }
        })
      }
    }
  }

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
