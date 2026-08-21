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
  await prisma.inventoryItem.deleteMany()

  console.log('Seeding Customers...')
  const customerData = [
    { name: 'Adaeze Okonkwo', email: 'adaeze.okonkwo@gmail.com', phone: '+2348012345671' },
    { name: 'Emeka Nwachukwu', email: 'emeka.nwachukwu@gmail.com', phone: '+2348012345672' },
    { name: 'Fatima Aliyu', email: 'fatima.aliyu@gmail.com', phone: '+2348012345673' },
    { name: 'Bola Adesanya', email: 'bola.adesanya@gmail.com', phone: '+2348012345674' },
    { name: 'Tunde Bakare', email: 'tunde.bakare@gmail.com', phone: '+2348012345675' },
    { name: 'Ngozi Eze', email: 'ngozi.eze@gmail.com', phone: '+2348012345676' },
    { name: 'Chidi Okafor', email: 'chidi.okafor@gmail.com', phone: '+2348012345677' },
    { name: 'Aisha Musa', email: 'aisha.musa@gmail.com', phone: '+2348012345678' },
    { name: 'Seun Adeyemi', email: 'seun.adeyemi@gmail.com', phone: '+2348012345679' },
    { name: 'Kemi Obi', email: 'kemi.obi@gmail.com', phone: '+2348012345680' },
  ]

  const customers = []
  for (const data of customerData) {
    const user = await prisma.user.create({ data })
    customers.push(user)
  }

  console.log('Seeding Inventory Items...')
  await prisma.inventoryItem.createMany({
    data: [
      { name: 'Jollof Rice', category: 'INGREDIENT', unit: 'kg', currentStock: 50, minimumThreshold: 10 },
      { name: 'Long Grain Rice', category: 'INGREDIENT', unit: 'kg', currentStock: 80, minimumThreshold: 15 },
      { name: 'Tomatoes', category: 'INGREDIENT', unit: 'kg', currentStock: 25, minimumThreshold: 8 },
      { name: 'Red Pepper', category: 'INGREDIENT', unit: 'kg', currentStock: 15, minimumThreshold: 5 },
      { name: 'Scotch Bonnet', category: 'INGREDIENT', unit: 'kg', currentStock: 1.5, minimumThreshold: 2 },
      { name: 'Chicken', category: 'INGREDIENT', unit: 'kg', currentStock: 40, minimumThreshold: 10 },
      { name: 'Turkey', category: 'INGREDIENT', unit: 'kg', currentStock: 4, minimumThreshold: 5 },
      { name: 'Palm Oil', category: 'INGREDIENT', unit: 'litres', currentStock: 30, minimumThreshold: 8 },
      { name: 'Groundnut Oil', category: 'INGREDIENT', unit: 'litres', currentStock: 20, minimumThreshold: 5 },
      { name: 'Onions', category: 'INGREDIENT', unit: 'kg', currentStock: 30, minimumThreshold: 8 },
      { name: 'Egusi', category: 'INGREDIENT', unit: 'kg', currentStock: 12, minimumThreshold: 3 },
      { name: 'Stock Cubes', category: 'INGREDIENT', unit: 'packs', currentStock: 100, minimumThreshold: 20 },
      { name: 'Maggi Seasoning', category: 'INGREDIENT', unit: 'packs', currentStock: 80, minimumThreshold: 20 },
      { name: 'Plantain', category: 'INGREDIENT', unit: 'bunches', currentStock: 15, minimumThreshold: 4 },
      
      { name: 'Chilled Water', category: 'DRINK', unit: 'crates', currentStock: 20, minimumThreshold: 5 },
      { name: 'Soft Drinks', category: 'DRINK', unit: 'crates', currentStock: 15, minimumThreshold: 4 },
      { name: 'Malt Drinks', category: 'DRINK', unit: 'crates', currentStock: 2, minimumThreshold: 3 },
      
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
      name: 'Jollof Rice',
      price: 1200,
      ingredients: [
        recipeLine('Long Grain Rice', 0.25),
        recipeLine('Tomatoes', 0.15),
        recipeLine('Red Pepper', 0.05),
        recipeLine('Groundnut Oil', 0.05),
        recipeLine('Onions', 0.05),
        recipeLine('Stock Cubes', 1),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1598514982205-f36b96d1e8d4?w=800&q=80', type: 'IMAGE' as const, position: 0 },
        { url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=800&q=80', type: 'IMAGE' as const, position: 1 },
      ]
    },
    {
      name: 'Fried Rice',
      price: 1300,
      ingredients: [
        recipeLine('Long Grain Rice', 0.25),
        recipeLine('Chicken', 0.1),
        recipeLine('Groundnut Oil', 0.06),
        recipeLine('Onions', 0.04),
        recipeLine('Maggi Seasoning', 1),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Meat Pie',
      price: 350,
      ingredients: [
        recipeLine('Chicken', 0.05),
        recipeLine('Onions', 0.02),
        recipeLine('Groundnut Oil', 0.02),
        recipeLine('Takeaway Bags', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1626200419111-39589d89776d?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Waakye',
      price: 1000,
      ingredients: [
        recipeLine('Long Grain Rice', 0.2),
        recipeLine('Palm Oil', 0.05),
        recipeLine('Onions', 0.03),
        recipeLine('Stock Cubes', 1),
        recipeLine('Food Packs', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1623859763838-a304cbfd4901?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Egusi Soup & Pounded Yam',
      price: 1800,
      ingredients: [
        recipeLine('Egusi', 0.15),
        recipeLine('Palm Oil', 0.08),
        recipeLine('Turkey', 0.12),
        recipeLine('Scotch Bonnet', 0.01),
        recipeLine('Foil Trays', 1),
      ],
      media: [
        { url: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80', type: 'IMAGE' as const, position: 0 }
      ]
    },
    {
      name: 'Grilled Chicken',
      price: 900,
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
  const orderData = [
    { customerIndex: 0, description: '5 large jollof rice packs + 10 fried chicken', status: 'PENDING', totalPrice: 3500 },
    { customerIndex: 1, description: '3 family-size egusi soup packs', status: 'PENDING', totalPrice: 7200 },
    { customerIndex: 2, description: '20 small packs jollof + 20 grilled chicken thighs', status: 'PENDING', totalPrice: 15000 },
    { customerIndex: 3, description: '2 large pots jollof rice + 4 whole turkey', status: 'PREPPING', totalPrice: 25000 },
    { customerIndex: 4, description: '10 plates pounded yam and egusi', status: 'PREPPING', totalPrice: 8000 },
    { customerIndex: 5, description: '15 soft drinks and 15 meat pies', status: 'COOKING', totalPrice: 5500 },
    { customerIndex: 6, description: 'Office lunch: 10 jollof rice, 10 chicken, 10 water', status: 'COOKING', totalPrice: 12000 },
    { customerIndex: 7, description: 'Birthday party: 50 packs assorted rice and chicken', status: 'READY', totalPrice: 45000 },
    { customerIndex: 8, description: '1 large tray plantain, 1 large tray fried turkey', status: 'READY', totalPrice: 18000 },
    { customerIndex: 9, description: 'Family dinner: 4 plates of rice, 4 drinks', status: 'COMPLETED', totalPrice: 6500 },
    { customerIndex: 0, description: '2 portions egusi soup', status: 'COMPLETED', totalPrice: 3000 },
    { customerIndex: 1, description: '3 jollof rice packs with extra turkey', status: 'COMPLETED', totalPrice: 5000 },
    { customerIndex: 2, description: '5 malt drinks, 5 chilled water', status: 'COMPLETED', totalPrice: 1500 },
    { customerIndex: 3, description: '10 takeaway bags of rice and stew', status: 'CANCELLED', totalPrice: 9000 },
    { customerIndex: 4, description: '1 pot of party jollof', status: 'CANCELLED', totalPrice: 20000 },
  ]

  // Only a subset of orders carries structured dish line items. The rest deliberately keep zero
  // OrderDish rows so a fresh local database exercises BOTH the new dish-based rendering path and
  // the legacy (pre-Menu) empty-dishes path side by side.
  const orderDishPlan: Record<number, { dishName: string; quantity: number }[]> = {
    0: [{ dishName: 'Jollof Rice', quantity: 5 }, { dishName: 'Grilled Chicken', quantity: 10 }],
    2: [{ dishName: 'Jollof Rice', quantity: 20 }, { dishName: 'Grilled Chicken', quantity: 20 }],
    4: [{ dishName: 'Egusi Soup & Pounded Yam', quantity: 10 }],
    6: [{ dishName: 'Jollof Rice', quantity: 10 }, { dishName: 'Grilled Chicken', quantity: 10 }],
    7: [
      { dishName: 'Jollof Rice', quantity: 25 },
      { dishName: 'Fried Rice', quantity: 25 },
      { dishName: 'Meat Pie', quantity: 20 },
    ],
    9: [{ dishName: 'Fried Rice', quantity: 4 }],
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
