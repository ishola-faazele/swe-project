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

/**
 * Media uploads (MinIO). The image allowlist deliberately excludes image/heic and image/heif — the
 * default capture format on recent iPhones — because nothing in this app transcodes them and a
 * stored HEIC would not render in most desktop browsers. iOS Safari's file picker commonly
 * re-encodes camera photos to JPEG before handing them to <input type="file">, which is what
 * makes this allowlist workable on a phone-first admin device (flagged for manual QA).
 *
 * This is the SERVER-side gate on which content types may be presigned at all; the actual PUT is
 * then bound to the signed content type byte-for-byte (see storage/client.ts's signableHeaders).
 */
const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** Dish media only — video is never valid for a customer photo. See the .refine() below. */
const DISH_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const

const ALL_MEDIA_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...DISH_VIDEO_CONTENT_TYPES] as const

/**
 * Renamed from imageUploadRequestSchema — "image" stopped being accurate the moment dish uploads
 * can be video/mp4.
 *
 * The .refine() below is the REAL, server-side gate on video: a plain z.enum() can't express
 * "video/* is only valid when entityType is 'dish'", so customer uploads are additionally
 * constrained here, not just by the client's accept= attribute (which is only ever a UX hint —
 * see media-upload.tsx's MEDIA_CONFIG).
 */
export const mediaUploadRequestSchema = z
  .object({
    entityType: z.enum(['dish', 'customer']),
    contentType: z.enum(ALL_MEDIA_CONTENT_TYPES, 'Unsupported file type.'),
  })
  .refine(
    (val) =>
      val.entityType === 'dish' ||
      IMAGE_CONTENT_TYPES.includes(val.contentType as (typeof IMAGE_CONTENT_TYPES)[number]),
    { message: 'Customer photos must be JPEG, PNG, or WebP.', path: ['contentType'] }
  )

/**
 * Used by updateProfilePhotoSchema below — the ONLY remaining consumer. The dish and customer
 * admin schemas no longer carry an imageUrl field at all: Dish's scalar was replaced by the
 * DishMedia relation, and a customer's photo is now written exclusively by the customer
 * themselves (src/app/dashboard/actions.ts's updateProfilePhoto), never by the admin.
 *
 * `.nullish()` — not `.optional()` alone — is load-bearing, and the two states are NOT
 * interchangeable at the Prisma call site: `undefined` means "field not sent, leave the column
 * exactly as it is" while an explicit `null` means "clear the photo". Prisma applies precisely
 * that distinction to an `imageUrl: input.imageUrl` property, which is why the write can pass the
 * value through unconditionally with no branching. Dropping `.nullable()` here would make
 * clearing a photo impossible to express.
 */
const imageUrlField = z.url("That image URL doesn't look valid.").nullish()

/** The customer's own self-service photo write — dashboard/actions.ts's updateProfilePhoto. */
export const updateProfilePhotoSchema = z.object({ imageUrl: imageUrlField })

/** admin/menu/[id]/actions.ts's addDishMedia. */
export const addDishMediaSchema = z.object({
  dishId: idSchema,
  url: z.url('That media URL does not look valid.'),
  type: z.enum(['IMAGE', 'VIDEO']),
})

/** admin/menu/[id]/actions.ts's reorderDishMedia. */
export const reorderDishMediaSchema = z.object({
  dishId: idSchema,
  mediaId: idSchema,
  direction: z.enum(['up', 'down']),
})

/**
 * A line in a DISH's recipe — how much of an InventoryItem one unit of the dish consumes.
 * Deliberately separate from ingredientInputSchema above, which is a line on an ORDER
 * (quantityUsed, non-negative). A recipe quantity must be strictly positive: a zero-quantity
 * recipe line is meaningless, unlike a zero-quantity order line, which updateOrderItems skips.
 */
export const dishIngredientInputSchema = z.object({
  inventoryItemId: z.uuid('Select a valid inventory item.'),
  quantityPerDish: z
    .number('Enter a quantity for each ingredient.')
    .positive('Ingredient quantity must be greater than zero.'),
})

const dishIngredientArraySchema = z
  .array(dishIngredientInputSchema)
  .max(MAX_INGREDIENT_LINES, 'A dish cannot list more than 50 distinct ingredient lines.')

/**
 * createDish/updateDish had ZERO input validation before the MinIO image-upload feature — a
 * negative price or an empty name reached Prisma unchecked. These schemas close that gap as part
 * of migrating both actions onto this codebase's newer zod + ActionResult convention.
 *
 * `ingredients` is `.optional()` here even though the TS param type and every real call site
 * (MenuClient's recipePayload) always supply an array, possibly empty. That looseness is
 * intentional, not an oversight: mergeDuplicateIngredients(input.ingredients ?? []) already
 * handles the undefined case, and it keeps a name/price-only payload valid.
 */
export const createDishSchema = z.object({
  name: z.string().trim().min(1, 'A dish name is required.'),
  price: z.number('Enter a price for this dish.').nonnegative('Price cannot be negative.'),
  servingSize: z
    .number('Enter a serving size.')
    .int('Serving size must be a whole number.')
    .positive('Serving size must be greater than zero.')
    .optional(),
  ingredients: dishIngredientArraySchema.optional(),
  media: z.array(z.object({
    url: z.url('Media URL is invalid.'),
    type: z.enum(['IMAGE', 'VIDEO'])
  })).optional(),
})

/** Mirrors createDishSchema with every field optional except `id`. */
export const updateDishSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'A dish name is required.').optional(),
  price: z.number('Enter a price for this dish.').nonnegative('Price cannot be negative.').optional(),
  servingSize: z
    .number('Enter a serving size.')
    .int('Serving size must be a whole number.')
    .positive('Serving size must be greater than zero.')
    .optional(),
  ingredients: dishIngredientArraySchema.optional(),
})

export const createCustomerSchema = z
  .object({
    name: z.string().trim().min(1, 'A contact name is required.'),
    email: optionalContactField.pipe(z.email('Enter a valid email address.').optional()),
    phone: z.string().trim().optional().transform((v) => (v ? toGhanaE164(v) : undefined)).refine((v) => v !== null, { message: 'Enter a valid Ghanaian phone number.' }),
    notes: z.string().trim().optional(),
  })

/**
 * updateCustomer deliberately does NOT accept email or phone — once the admin sets a contact
 * method at creation, it's write-once. Only the customer themselves, logged in, can fill a
 * missing slot (see src/app/dashboard/actions.ts), and never change one that's already set. Only
 * `name` and `preferredLoginMethod` are editable here.
 *
 * `imageUrl` is deliberately absent: a customer's photo is self-service only. The admin keeps
 * read access (the customer table's avatar column) but has no write path to it at all — see the
 * PRD's Non-Goals. updateProfilePhoto is the column's sole writer.
 *
 * `preferredLoginMethod` still can't be validated against "a contact field that's actually
 * filled in" at the schema level, since the payload no longer carries email/phone at all — that
 * check happens in updateCustomer itself, against the row's EXISTING stored values.
 */
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
