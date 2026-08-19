import { z } from 'zod'
import { Category, LoginMethod, OrderStatus } from '@prisma/client'

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
  totalPrice: z.number('Enter a total price for this order.').nonnegative('Total price cannot be negative.'),
  dueDate: z.date().nullish(),
  dishes: dishSelectionArraySchema,
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

/**
 * A customer must not prefer a login channel they have no contact info for — an EMAIL preference
 * with no email on file would produce an account-creation notification with nowhere to send it,
 * and a phone-login attempt that can never resolve.
 *
 * Left optional so callers that don't supply the field at all still pass; createCustomer computes
 * an explicit value in that case rather than leaning on the column default.
 */
const preferredLoginMethodMatchesContactField = (v: {
  email?: string
  phone?: string
  preferredLoginMethod?: LoginMethod
}) =>
  !v.preferredLoginMethod ||
  (v.preferredLoginMethod === 'EMAIL' ? Boolean(v.email) : Boolean(v.phone))

const PREFERRED_LOGIN_METHOD_MESSAGE =
  'Preferred login method must match a contact field that is actually filled in.'

const preferredLoginMethodField = z.enum(LoginMethod, 'Select a valid preferred login method.').optional()

export const createCustomerSchema = z
  .object({
    name: optionalContactField,
    email: optionalContactField,
    phone: optionalContactField,
    preferredLoginMethod: preferredLoginMethodField,
  })
  .refine(hasAtLeastOneContactMethod, { message: AT_LEAST_ONE_CONTACT_MESSAGE })
  .refine(preferredLoginMethodMatchesContactField, { message: PREFERRED_LOGIN_METHOD_MESSAGE })

/**
 * updateCustomer overwrites all three fields on every call (preserved from the existing
 * implementation), so the incoming payload *is* the resulting row state — the same
 * at-least-one-contact-method refinement therefore also prevents an edit that blanks a
 * customer's every contact method.
 *
 * That same "the payload is the resulting state" property is what makes the preferred-login-method
 * refinement meaningful on an edit: it stops a save from leaving preferredLoginMethod pointing at
 * a channel the very same edit just blanked out.
 */
export const updateCustomerSchema = z
  .object({
    id: idSchema,
    name: optionalContactField,
    email: optionalContactField,
    phone: optionalContactField,
    preferredLoginMethod: preferredLoginMethodField,
  })
  .refine(hasAtLeastOneContactMethod, { message: AT_LEAST_ONE_CONTACT_MESSAGE })
  .refine(preferredLoginMethodMatchesContactField, { message: PREFERRED_LOGIN_METHOD_MESSAGE })

/**
 * Settings-page schemas — toggles only. Provider credentials live in .env and are never
 * admin-editable; see src/lib/settings.ts's header for why.
 */
export const updateNotificationSettingsSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
})

/** Required booleans, not a partial patch — this is an explicit admin toggle write. */
export const updateLoginSettingsSchema = z.object({
  emailLoginEnabled: z.boolean(),
  phoneLoginEnabled: z.boolean(),
})
