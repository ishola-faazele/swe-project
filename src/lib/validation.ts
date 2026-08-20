import { z } from 'zod'
import { Category, LoginMethod, OrderStatus } from '@prisma/client'
import { toGhanaE164 } from '@/lib/phone'

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
 * supplied value. Trim first, then normalize "" (and whitespace-only) to undefined.
 */
const optionalContactField = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)

export const ingredientInputSchema = z.object({
  inventoryItemId: z.uuid('Select a valid inventory item.'),
  // Non-negative rather than positive: updateOrderItems deliberately skips zero-quantity
  // lines rather than rejecting them. Negatives must never pass — a negative "decrement" would
  // silently inflate stock.
  quantityUsed: z
    .number('Enter a quantity for each ingredient.')
    .nonnegative('Ingredient quantity cannot be negative.'),
})

const ingredientArraySchema = z
  .array(ingredientInputSchema)
  .max(MAX_INGREDIENT_LINES, 'An order cannot list more than 50 distinct ingredient lines.')

// A dish line on an order (as opposed to a DishIngredient, which is a line in a dish's recipe).
export const dishSelectionSchema = z.object({
  dishId: z.uuid('Select a valid dish.'),
  quantity: z
    .number('Enter a quantity for each dish.')
    .int('Dish quantity must be a whole number.')
    .positive('Dish quantity must be greater than zero.'),
})

const dishSelectionArraySchema = z
  .array(dishSelectionSchema)
  .max(MAX_INGREDIENT_LINES, 'An order cannot list more than 50 distinct dish lines.')

export const orderStatusSchema = z.enum(OrderStatus)

export const idSchema = z.uuid('That record reference is not valid.')

export const deleteByIdSchema = idSchema

export const createOrderSchema = z.object({
  customerId: z.uuid('Select a customer for this order.'),
  // Free-text notes, not a required description — dishes now carry the structured "what was
  // ordered" data. An empty string is a valid value for the non-nullable description column.
  description: z.string().trim(),
  notes: z.string().trim().optional().nullable(),
  totalPrice: z.number('Enter a total price for this order.').nonnegative('Total price cannot be negative.'),
  dueDate: z.date().nullish(),
  dishes: dishSelectionArraySchema,
  // When the admin reviews and adjusts ingredients at order creation time (bulk orders),
  // these overrides replace the auto-calculated recipe expansion entirely.
  ingredientOverrides: ingredientArraySchema.optional(),
})

export const updateOrderInfoSchema = z.object({
  id: idSchema,
  description: z.string().trim(),
  notes: z.string().trim().optional().nullable(),
})

export const updateOrderStatusSchema = z.object({
  id: idSchema,
  status: orderStatusSchema,
})

/**
 * Due date is nullish by design: clearing the date input is a legitimate edit
 * that sets the column back to NULL, not a validation failure.
 */
export const updateOrderDueDateSchema = z.object({
  id: idSchema,
  dueDate: z.date().nullish(),
})

/**
 * updateOrderItems replaced the old ingredients-only updateOrderIngredients action once orders
 * moved to dish-based line items. `extraIngredients` covers one-off manual deductions (e.g. a
 * customization not captured by any dish's recipe) alongside the dish-derived ones.
 */
export const updateOrderItemsSchema = z.object({
  orderId: idSchema,
  dishes: dishSelectionArraySchema,
  extraIngredients: ingredientArraySchema,
  totalPrice: z.number('Enter a total price for this order.').nonnegative('Total price cannot be negative.'),
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
    name: z.string().trim().min(1, 'A contact name is required.'),
    email: optionalContactField,
    phone: optionalContactField,
    notes: z.string().trim().optional(),
  })

export const updateCustomerSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'A contact name is required.'),
  notes: z.string().trim().optional(),
})

/**
 * Settings-page schema — per-channel toggle PLUS the owner's alert-destination contact for that
 * channel. Provider credentials still live in .env and are never admin-editable; see
 * src/lib/settings.ts's header for why. An alert contact is optional (a channel can be toggled on
 * before its destination is filled in — the sender simply has nothing to send to yet, the same
 * "configured vs enabled" independence every sender already applies) but must be well-formed when
 * present. Blank/whitespace-only clears the field back to unset, same convention as
 * optionalContactField above.
 */
const optionalAlertEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => v || undefined)
  .pipe(z.email('Enter a valid email address.').optional())

const optionalAlertPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? toGhanaE164(v) : undefined))
  .refine((v) => v !== null, { message: 'Enter a valid Ghanaian phone number.' })

export const updateNotificationSettingsSchema = z.object({
  emailEnabled: z.boolean(),
  alertEmail: optionalAlertEmail,
  smsEnabled: z.boolean(),
  alertPhone: optionalAlertPhone,
  whatsappEnabled: z.boolean(),
  alertWhatsapp: optionalAlertPhone,
})

/**
 * Used by the customer-dashboard "add a missing email" flow (src/app/dashboard/actions.ts).
 * Trimmed and lowercased before the format check so "  Ama@Example.com  " and "ama@example.com"
 * are recognized as the same address — matters here specifically because this value ends up
 * stored as a unique column.
 */
export const addEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'))

/**
 * The customer-dashboard notification-preferences form (src/app/dashboard/actions.ts) — same
 * shape as updateNotificationSettingsSchema above: a toggle PLUS an alert-destination contact per
 * channel, reusing the same optional/normalizing building blocks. A blank alert field clears it
 * back to unset, letting the customer's login email/phone serve as the fallback destination (see
 * User.alertEmail's schema comment).
 */
export const updateNotificationPreferencesSchema = z.object({
  notifyByEmail: z.boolean(),
  alertEmail: optionalAlertEmail,
  notifyBySms: z.boolean(),
  alertPhone: optionalAlertPhone,
  notifyByWhatsapp: z.boolean(),
  alertWhatsapp: optionalAlertPhone,
})
