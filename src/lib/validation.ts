import { z } from 'zod'
import { Category, OrderStatus } from '@prisma/client'

/**
 * An order cannot list more than this many distinct ingredient lines. Not a real product
 * constraint — the UI adds ingredient rows one at a time and real orders are single-digit —
 * purely a sanity ceiling so a malformed or abusive payload can't reach the per-ingredient
 * transaction loop.
 */
const MAX_INGREDIENT_LINES = 50

/**
 * FormData.get() returns "" (never null/undefined) for a present-but-blank field, so
 * .optional() alone is not enough to model "not provided" — an empty string would pass as a
 * supplied value. Trim first, then normalize "" (and whitespace-only) to undefined so the
 * at-least-one-contact-method refinement below can't be satisfied by "   ".
 */
const optionalContactField = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)

const hasAtLeastOneContactMethod = (v: {
  name?: string
  email?: string
  phone?: string
}) => Boolean(v.name || v.email || v.phone)

const AT_LEAST_ONE_CONTACT_MESSAGE = 'At least one contact method (name, email, or phone) is required.'

export const ingredientInputSchema = z.object({
  inventoryItemId: z.uuid('Select a valid inventory item.'),
  // Non-negative rather than positive: updateOrderIngredients deliberately skips zero-quantity
  // lines rather than rejecting them. Negatives must never pass — a negative "decrement" would
  // silently inflate stock.
  quantityUsed: z
    .number('Enter a quantity for each ingredient.')
    .nonnegative('Ingredient quantity cannot be negative.'),
})

const ingredientArraySchema = z
  .array(ingredientInputSchema)
  .max(MAX_INGREDIENT_LINES, 'An order cannot list more than 50 distinct ingredient lines.')

export const orderStatusSchema = z.enum(OrderStatus)

export const idSchema = z.uuid('That record reference is not valid.')

export const deleteByIdSchema = idSchema

export const createOrderSchema = z.object({
  customerId: z.uuid('Select a customer for this order.'),
  description: z.string().trim().min(1, 'Order details are required.'),
  totalPrice: z.number('Enter a total price for this order.').nonnegative('Total price cannot be negative.'),
  dueDate: z.date().nullish(),
  ingredients: ingredientArraySchema,
})

export const updateOrderStatusSchema = z.object({
  id: idSchema,
  status: orderStatusSchema,
})

export const updateOrderIngredientsSchema = z.object({
  orderId: idSchema,
  ingredients: ingredientArraySchema,
})

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1, 'An item name is required.'),
  currentStock: z.number('Enter the current stock level.').nonnegative('Stock cannot be negative.'),
  unit: z.string().trim().min(1, 'A unit (e.g. kg, pieces) is required.'),
  minimumThreshold: z
    .number('Enter a valid low-stock threshold.')
    .nonnegative('The low-stock threshold cannot be negative.')
    .nullish(),
  category: z.enum(Category, 'Select a valid category.'),
})

export const updateInventoryItemSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'An item name is required.').optional(),
  currentStock: z.number('Enter the current stock level.').nonnegative('Stock cannot be negative.').optional(),
  unit: z.string().trim().min(1, 'A unit (e.g. kg, pieces) is required.').optional(),
  minimumThreshold: z
    .number('Enter a valid low-stock threshold.')
    .nonnegative('The low-stock threshold cannot be negative.')
    .optional(),
  category: z.enum(Category, 'Select a valid category.').optional(),
})

export const createCustomerSchema = z
  .object({
    name: optionalContactField,
    email: optionalContactField,
    phone: optionalContactField,
  })
  .refine(hasAtLeastOneContactMethod, { message: AT_LEAST_ONE_CONTACT_MESSAGE })

/**
 * updateCustomer overwrites all three fields on every call (preserved from the existing
 * implementation), so the incoming payload *is* the resulting row state — the same
 * at-least-one-contact-method refinement therefore also prevents an edit that blanks a
 * customer's every contact method.
 */
export const updateCustomerSchema = z
  .object({
    id: idSchema,
    name: optionalContactField,
    email: optionalContactField,
    phone: optionalContactField,
  })
  .refine(hasAtLeastOneContactMethod, { message: AT_LEAST_ONE_CONTACT_MESSAGE })
