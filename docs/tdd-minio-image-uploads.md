# TDD/RFC: Dish & Customer Photo Uploads (MinIO)

## Status
Draft (revised — scope expanded before initial implementation was committed)

**Revision note**: the section below and everything about the underlying presigned-PUT mechanism,
CORS findings, and MinIO compose setup is carried over unchanged from the original design, which
was fully implemented and tested (0 tsc errors, 469 unit + 141 integration tests, clean build)
before three scope changes were requested and none of it was committed. What changed: (1) customer
photos move from admin-set to customer self-service — the admin loses write access but keeps
read access; (2) the admin dish table is replaced with a card gallery + a per-dish detail page;
(3) `Dish.imageUrl` (a single scalar) is replaced by a real one-to-many `DishMedia` model
supporting multiple photos and video. Every section below has been re-audited against these three
changes; sections not called out as changed are carried forward as-is.

## Context & Motivation
See `docs/prd-minio-image-uploads.md`. This codebase had zero image/upload infrastructure before
the original pass of this feature — no `@aws-sdk/*` packages, no `docker-compose.yml`, no image
field on any Prisma model, no file-input or avatar/preview component anywhere in
`src/components/ui/`. That groundwork (the MinIO integration itself) is unchanged by this
revision; what's new is the shape of what sits on top of it.

The product ask has one hard, explicit UX constraint, carried over unchanged: uploads must start
on file *selection*, not on form *submission* ("Instagram flow"). That constraint is what shaped
almost every technical decision in the original design, and it still does here — it rules out
proxying file bytes through a Server Action, and it means an upload's resulting URL is tracked in
client state and applied independently of any surrounding form. The revision actually makes this
constraint *more* load-bearing, not less: dish media management now has **no surrounding form at
all** to defer to — each media add/remove/reorder is its own standalone, immediately-persisted
action, closer to the "Instagram flow" ideal than the original single-photo-field-inside-a-bigger-
form implementation ever was.

## Proposed Design

### High-level flow (revised)
The base mechanism — presign, PUT directly to MinIO, get back a stable public URL — is unchanged.
What now differs by caller:

1. A file is picked in the (renamed) `MediaUpload` component (`src/components/ui/media-upload.tsx`,
   was `image-upload.tsx`/`ImageUpload` — see Frontend Changes for why it's renamed).
2. `MediaUpload` immediately shows a local preview (`URL.createObjectURL`) and calls the (renamed)
   `getMediaUploadUrl` Server Action (`src/lib/storage/actions.ts`, was `getImageUploadUrl`),
   which returns a **presigned PUT URL** and a **stable public URL**, exactly as before.
   **Its authorization gate is now conditional on `entityType`, which is a required correction,
   not a stylistic rename** — see "Authorization gate must become entityType-conditional" below.
3. The browser PUTs directly to MinIO, exactly as before.
4. **What happens next now forks into three different shapes, one per caller**, instead of the
   original single "merge into a form's save payload" pattern:
   - **Dish media** (`/admin/menu/[id]`, admin-only): a successful upload is NOT merged into any
     form. It's immediately handed to a new Server Action, `addDishMedia`, which attaches it to
     the dish as a new `DishMedia` row. The uploader slot then resets (remounted via a `key`
     bump) so the admin can add another item right away. There is no "Save" button gating dish
     media at all — each add is already saved the moment it succeeds.
   - **Customer self-service photo** (`/dashboard`, any authenticated customer): a successful
     upload is immediately handed to a new Server Action, `updateProfilePhoto`, which writes it to
     the *caller's own* `User.imageUrl` — again, no surrounding form, no separate Save.
   - **Dish scalar fields** (name/price/servingSize/recipe, both the lightweight create modal and
     the detail page's Details section): completely unaffected by media at all now — `createDish`/
     `updateDish` no longer accept or write an `imageUrl` field, because that column is gone (see
     Database Changes). Their existing `<form>`/`FormData` save flow is unchanged apart from that
     removal.

### Authorization gate must become entityType-conditional
The original `getImageUploadUrl` was unconditionally `await requireAdmin()`. **That would make
customer self-service impossible outright** — a logged-in customer calling it to upload their own
photo would hit an `AuthError` and the upload would fail before ever reaching MinIO. This is not a
cosmetic gap; it silently breaks the entire self-service flow described in the PRD if left as-is,
so it's resolved here explicitly rather than left for the implementer to discover:

```ts
export async function getMediaUploadUrl(
  input: { entityType: 'dish' | 'customer'; contentType: string }
): Promise<ActionResult<{ uploadUrl: string; publicUrl: string }>> {
  if (input.entityType === 'dish') {
    await requireAdmin() // only admins manage the dish menu/media — unchanged from before
  } else {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: 'You must be signed in to do that.', code: 'VALIDATION' }
    // Deliberately does NOT further check that `user` is specifically a CUSTOMER, nor which one —
    // this action stays fully decoupled from any specific row (see its original design note
    // below), so "is some real authenticated user" is the complete, correct authorization check
    // it can meaningfully make. The row-level check that matters — "can this caller write to
    // THIS User.id" — lives entirely in updateProfilePhoto (dashboard/actions.ts), which never
    // trusts a client-supplied id; see API Changes.
  }

  try {
    const parsed = mediaUploadRequestSchema.parse(input)
    const key = `${KEY_PREFIX[parsed.entityType]}/${randomUUID()}.${EXTENSION_BY_CONTENT_TYPE[parsed.contentType]}`
    const uploadUrl = await createPresignedUploadUrl(key, parsed.contentType)
    return okResult({ uploadUrl, publicUrl: buildPublicUrl(key) })
  } catch (err) {
    return toErrorResult(err, 'Could not prepare an upload. Please try again.')
  }
}
```
`getCurrentDbUser()` is imported from `@/lib/auth`, same module `requireAdmin()` already comes
from — no new auth dependency.

### New shared module: `src/lib/storage/` (renamed exports, same file layout)
Still mirrors the `src/lib/notifications/` split (pure integration module + thin `"use server"`
wrapper). File paths are unchanged (`src/lib/storage/client.ts`, `src/lib/storage/actions.ts`);
what's renamed is the exported action (`getImageUploadUrl` → `getMediaUploadUrl`) and its
validation schema (`imageUploadRequestSchema` → `mediaUploadRequestSchema`) — "Image" stopped
being accurate the moment dish uploads can be `video/mp4`.

**`src/lib/storage/client.ts` is entirely unchanged** — `createPresignedUploadUrl`/`buildPublicUrl`,
the `signableHeaders: new Set(['content-type'])` fix, the lazy-per-call env reads, and the 10-minute
`PRESIGN_EXPIRY_SECONDS` all carry over verbatim; none of the three requested changes touches this
file:
```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.MINIO_REGION || 'us-east-1',
    endpoint: process.env.MINIO_ENDPOINT,
    forcePathStyle: true, // required for MinIO — virtual-hosted-style bucket addressing does not work against it
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    },
  })
}

function bucketName(): string {
  return process.env.MINIO_BUCKET || 'chop-uploads'
}

const PRESIGN_EXPIRY_SECONDS = 600 // 10 minutes — see Edge Cases for why this now matters more with video

export async function createPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucketName(), Key: key, ContentType: contentType })
  // ⚠ ContentType is NOT signed/enforced by @aws-sdk/s3-request-presigner by default (confirmed
  // against aws/aws-sdk-js-v3#3497) — without this explicit signableHeaders override, a client
  // could PUT with ANY Content-Type despite the server only ever issuing URLs for allowlisted
  // types, silently defeating mediaUploadRequestSchema's allowlist below.
  return getSignedUrl(s3Client(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    signableHeaders: new Set(['content-type']),
  })
}

// Deliberately NOT a presigned/expiring GET URL — this is what gets stored in DishMedia.url /
// User.imageUrl and rendered indefinitely, so it must never expire.
export function buildPublicUrl(key: string): string {
  const base = (process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || '').replace(/\/$/, '')
  return `${base}/${bucketName()}/${key}`
}
```

**`src/lib/storage/actions.ts`** — same file, three changes: the rename above, the
entityType-conditional gate above, and an extended extension map:
```ts
"use server"

import { randomUUID } from 'crypto'
import { requireAdmin, getCurrentDbUser } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { mediaUploadRequestSchema } from '@/lib/validation'
import { createPresignedUploadUrl, buildPublicUrl } from './client'

const KEY_PREFIX: Record<'dish' | 'customer', string> = { dish: 'dishes', customer: 'customers' }

// Video entries are new — gated to entityType:'dish' only at the SCHEMA level
// (mediaUploadRequestSchema below), not here; this map just needs an extension for every content
// type the schema can ever let through, dish or customer.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov', // iOS/QuickTime camera video — same class of real-device gotcha as HEIC photos
}

export async function getMediaUploadUrl(/* body shown above under "Authorization gate" */) { /* ... */ }
```

This action still does not touch Prisma at all for the *dish/customer save* — it has no idea
whether an `addDishMedia`/`updateProfilePhoto` call ever follows. That decoupling is unchanged and
is still the direct mechanism behind the accepted orphaned-object tradeoff: this action's entire
contract remains "here's somewhere you're allowed to PUT one file," full stop — the only thing
that changed is *who* is allowed to ask for that somewhere.

### API Changes
Still no new REST/Route Handler — every one of these remains a Server Action, consistent with how
every other mutation in this app works.

| Action | File | Auth | Input | Output |
|---|---|---|---|---|
| `getMediaUploadUrl` (renamed + gate widened) | `src/lib/storage/actions.ts` | `requireAdmin()` if `entityType:'dish'`; `getCurrentDbUser()`-only (any signed-in user) if `entityType:'customer'` | `{ entityType: 'dish'\|'customer', contentType: string }` — `contentType` now also accepts `video/mp4`\|`video/webm`\|`video/quicktime`, but only when `entityType:'dish'` | `ActionResult<{ uploadUrl: string; publicUrl: string }>` (shape unchanged) |
| `getDishes` (changed, required) | `src/app/admin/menu/actions.ts` | `requireAdmin()` | unchanged (no args) | **`include` gains `media: { orderBy: { position: 'asc' } }`** — see below for why this is required, not incidental |
| `createDish` (changed) | `src/app/admin/menu/actions.ts` | `requireAdmin()` | **`imageUrl` removed** — no longer a field on `Dish` at all | `ActionResult<Dish>` (unchanged) |
| `updateDish` (changed) | `src/app/admin/menu/actions.ts` | `requireAdmin()` | **`imageUrl` removed**; recipe/name/price/servingSize inputs unchanged | `ActionResult<Dish>` (unchanged) |
| `deleteDish` (changed, required) | `src/app/admin/menu/actions.ts` | `requireAdmin()` | unchanged (`id: string`) | unchanged shape (bare `{archived: boolean}`, still not `ActionResult` — see Domain & Service Layer for why this one specific change is required now, not optional) |
| `createCustomer` (changed) | `src/app/admin/customers/actions.ts` | `requireAdmin()` | **`imageUrl` removed** — admin can no longer set a customer's photo at creation | `ActionResult<ClientSafeUser>` (unchanged) |
| `updateCustomer` (changed) | `src/app/admin/customers/actions.ts` | `requireAdmin()` | **`imageUrl` removed** — admin can no longer change or clear a customer's photo | `ActionResult<ClientSafeUser>` (unchanged) |
| `updateProfilePhoto` (new) | `src/app/dashboard/actions.ts` | `getCurrentDbUser()` only — **never `requireAdmin()`** | `imageUrl: string \| null` | `ActionResult<{ imageUrl: string \| null }>` |
| `addDishMedia` (new) | `src/app/admin/menu/[id]/actions.ts` | `requireAdmin()` | `{ dishId: string, url: string, type: 'IMAGE'\|'VIDEO' }` | `ActionResult<DishMedia>` |
| `removeDishMedia` (new) | `src/app/admin/menu/[id]/actions.ts` | `requireAdmin()` | `id: string` (the `DishMedia` row id) | `ActionResult<{ dishId: string }>` |
| `reorderDishMedia` (new) | `src/app/admin/menu/[id]/actions.ts` | `requireAdmin()` | `{ dishId: string, mediaId: string, direction: 'up'\|'down' }` | `ActionResult<DishMedia[]>` (the dish's full media list, new order) |

### Database Changes
**This is now a genuine schema modification, not a purely additive rollout.** The original
release's `Dish.imageUrl`/`User.imageUrl` columns were very likely already pushed to both the
shared dev DB and `rosty_integrity_test` (the 141 green integration tests could not have passed
otherwise) — this revision must **drop** `Dish.imageUrl` and **add** the `DishMedia` model and
`MediaType` enum. `User.imageUrl` is completely untouched by this revision; do not touch it.

```prisma
model Dish {
  id          String      @id @default(uuid())
  shortId     Int         @unique @default(autoincrement())
  name        String
  price       Float
  servingSize Int         @default(1)
  isActive    Boolean     @default(true)
  // REMOVED — replaced by the one-to-many `media` relation below. A dish photo/video is no longer
  // a scalar on this row at all.
  // imageUrl    String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  ingredients DishIngredient[]
  orderDishes OrderDish[]
  media       DishMedia[]   // NEW
}

// NEW model. No onDelete clause — matches this schema's established "zero onDelete anywhere,
// clean up explicitly in application code" convention (see deleteDish's required change below,
// which is the direct consequence of that convention applied to this new FK).
model DishMedia {
  id        String    @id @default(uuid())
  dishId    String
  dish      Dish      @relation(fields: [dishId], references: [id])
  url       String    // stable public MinIO URL — same convention as Dish.imageUrl used to be
  type      MediaType
  // Display order, ascending; the lowest position is this dish's "cover" (shown on its gallery
  // card and anywhere else a single thumbnail is needed). Deliberately NOT @unique per (dishId,
  // position) — see "Cover and position convention" below for why enforcing that would actively
  // get in the way of the reorder mechanism, for no real benefit at this app's scale.
  position  Int
  createdAt DateTime  @default(now())

  @@index([dishId, position])
}

enum MediaType {
  IMAGE
  VIDEO
}

model User {
  // ... UNCHANGED. imageUrl String? stays exactly as it was — still a plain nullable scalar,
  // still outside OMIT_AUTH_EMAIL, still written by exactly one Server Action — just a different
  // one now (updateProfilePhoto in dashboard/actions.ts, not createCustomer/updateCustomer).
}
```

**Cover and position convention (explicit, not left to the implementer):**
- A new upload is always assigned `position = currentMax + 1` for that `dishId` (computed inside
  the same `addDishMedia` transaction that inserts the row) — so under normal, single-admin usage
  positions never collide.
- **On removal, positions are never renumbered.** If the dish had media at positions `[0, 1, 2]`
  and position `1` is removed, the remaining rows stay at `[0, 2]` — a gap, not a bug. The cover is
  recomputed fresh on every read as "whichever remaining row has the lowest `position`," so if the
  removed item *was* the cover (position `0`), the next-lowest (`2`) automatically becomes the new
  cover with **zero additional writes** — no renumbering transaction needed on delete, ever. This
  is a deliberate simplicity choice: renumbering on every delete would be extra transactional work
  bought for a purely cosmetic property (contiguous integers) nobody actually depends on, since
  nothing ever indexes into `position` by value — only `ORDER BY position ASC` matters.
- No `@@unique([dishId, position])`. The `reorderDishMedia` swap (two rows exchanging `position`
  values) would need the constraint to be *deferrable* to avoid a transient duplicate mid-swap in
  Postgres, adding real complexity for a guarantee nothing actually needs — a duplicate position
  only ever affects display order between two ties, never correctness (no code path uses `position`
  as a lookup key), so it's accepted as harmless rather than engineered away.

**Rollout procedure** — same schema-push (not migrations) process as before, human-gated,
two-database, **now including a genuine `db push`-driven column drop for the first time in this
project's history** (every prior schema change on this project was purely additive):
1. Edit `schema.prisma`, run `npx prisma generate`.
2. `npx prisma db push` against the shared local dev DB — confirm no concurrent worktree still
   depends on `Dish.imageUrl` existing before doing this; unlike the original additive rollout,
   this one is destructive to that specific column's data if any real photos were ever attached to
   a dish during testing of the base version.
3. `npx prisma db push` against `rosty_integrity_test` via an explicit env-var override (never by
   swapping `.env`/`.env.test`) — required or the integration suite breaks.
4. Do **not** run `prisma db seed` — destructive `deleteMany()` calls, unrelated to this change but
   still a standing hazard. `DishMedia` starts empty for every existing dish; no backfill exists or
   is needed (dishes simply render with a placeholder cover until media is added).
5. This must fully complete before any application code referencing `DishMedia`/`MediaType` lands.

### Domain & Service Layer

**Validation schemas (`src/lib/validation.ts`) — revised:**
```ts
const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const DISH_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const
const ALL_MEDIA_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...DISH_VIDEO_CONTENT_TYPES] as const

/**
 * Renamed from imageUploadRequestSchema. The .refine() below is the REAL, server-side gate on
 * video: a plain z.enum() can't express "video/* only valid when entityType is 'dish'", so
 * customer uploads are additionally constrained here, not just by the client's accept= attribute
 * (which is only ever a UX hint — see media-upload.tsx's ACCEPTED_TYPES config).
 */
export const mediaUploadRequestSchema = z
  .object({
    entityType: z.enum(['dish', 'customer']),
    contentType: z.enum(ALL_MEDIA_CONTENT_TYPES, 'Unsupported file type.'),
  })
  .refine(
    (val) => val.entityType === 'dish' || IMAGE_CONTENT_TYPES.includes(val.contentType as (typeof IMAGE_CONTENT_TYPES)[number]),
    { message: 'Customer photos must be JPEG, PNG, or WebP.', path: ['contentType'] }
  )

// `imageUrlField` is UNCHANGED and still used by updateProfilePhotoSchema below — it is no longer
// used by createDishSchema/updateDishSchema/createCustomerSchema/updateCustomerSchema, all four of
// which lose their imageUrl field entirely (see each schema below).
const imageUrlField = z.url("That image URL doesn't look valid.").nullish()

/** NEW — dashboard/actions.ts's updateProfilePhoto is the only caller. */
export const updateProfilePhotoSchema = z.object({ imageUrl: imageUrlField })

/** NEW — [id]/actions.ts's addDishMedia. */
export const addDishMediaSchema = z.object({
  dishId: idSchema,
  url: z.url('That media URL does not look valid.'),
  type: z.enum(['IMAGE', 'VIDEO']),
})

/** NEW — [id]/actions.ts's reorderDishMedia. */
export const reorderDishMediaSchema = z.object({
  dishId: idSchema,
  mediaId: idSchema,
  direction: z.enum(['up', 'down']),
})

export const dishIngredientInputSchema = z.object({
  inventoryItemId: z.uuid('Select a valid inventory item.'),
  quantityPerDish: z
    .number('Enter a quantity for each ingredient.')
    .positive('Ingredient quantity must be greater than zero.'),
})
const dishIngredientArraySchema = z
  .array(dishIngredientInputSchema)
  .max(50, 'A dish cannot list more than 50 distinct ingredient lines.')

// `imageUrl` REMOVED from both — Dish no longer has that scalar at all (see Database Changes).
export const createDishSchema = z.object({
  name: z.string().trim().min(1, 'A dish name is required.'),
  price: z.number('Enter a price for this dish.').nonnegative('Price cannot be negative.'),
  servingSize: z.number('Enter a serving size.').int('Serving size must be a whole number.')
    .positive('Serving size must be greater than zero.').optional(),
  ingredients: dishIngredientArraySchema.optional(),
})

export const updateDishSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'A dish name is required.').optional(),
  price: z.number('Enter a price for this dish.').nonnegative('Price cannot be negative.').optional(),
  servingSize: z.number('Enter a serving size.').int('Serving size must be a whole number.')
    .positive('Serving size must be greater than zero.').optional(),
  ingredients: dishIngredientArraySchema.optional(),
})
```
`createCustomerSchema`/`updateCustomerSchema` each **lose** the `imageUrl: imageUrlField` line they
gained in the original release — the admin no longer sends this field at all, so accepting it
would be dead code inviting drift (a stale client build sending it would just be silently ignored,
which is more confusing than not accepting it in the first place).

**`getDishes()` — required `include` widening, easy to miss.** The gallery cards in `MenuClient.tsx`
need each dish's `media` array to render a cover thumbnail, and `getDishes()` (`src/app/admin/menu/
actions.ts`) is the single query that populates `initialData` for that screen (via `menu/page.tsx`).
Its existing `include: { ingredients: { include: { inventoryItem: true } } }` must gain a sibling
key: `media: { orderBy: { position: 'asc' } }`. `getDishes()` is also called by two consumers
unrelated to this feature — `admin/orders/[id]/page.tsx` and `admin/orders/page.tsx`'s dish picker
— both receive the extra `media` field on every returned `Dish` but never read it; this is harmless,
additive, and requires no change on their side (their own local type aliases for the picker simply
don't reference the new field, and TypeScript's structural typing doesn't penalize unused excess
properties on values passed through existing variables). `admin/menu/[id]/page.tsx`'s own direct
`prisma.dish.findUnique` call (shown above) needs the identical `media: { orderBy: { position:
'asc' } }` include independently — it does not go through `getDishes()` at all, matching the
`admin/orders/[id]/page.tsx` precedent of a route-specific direct fetch rather than reusing the
list-view's query function.

**⚠ Scope-decision update — the mixed-convention question from the original release is now
partially forced, not purely a style choice:** the original release deliberately left `deleteDish`/
`toggleDishActive` on the old bare-throw pattern (they didn't touch `imageUrl`). That reasoning
still holds for `toggleDishActive` — completely untouched by this revision, still bare-throw,
still an open style question (see Open Questions). **`deleteDish` is different: it requires a real
code change now, not a style retrofit**, because of the new `DishMedia` foreign key — see below.
`createDish`/`updateDish` remain migrated to `createDishSchema`/`updateDishSchema` + `try/catch` +
`ActionResult<Dish>`, exactly as the original release established; only their body's `imageUrl`
line is deleted.

`createDish`, after this revision (unchanged shape apart from the removed field):
```ts
export async function createDish(data: {
  name: string
  price: number
  servingSize?: number
  ingredients: { inventoryItemId: string; quantityPerDish: number }[]
}): Promise<ActionResult<Dish>> {
  await requireAdmin()
  try {
    const input = createDishSchema.parse(data)
    const recipe = mergeDuplicateIngredients(input.ingredients ?? [])

    const dish = await prisma.$transaction(async (tx) => {
      const newDish = await tx.dish.create({
        data: { name: input.name, price: input.price, servingSize: input.servingSize ?? 1 },
      })
      if (recipe.length > 0) {
        await tx.dishIngredient.createMany({
          data: recipe.map(line => ({
            dishId: newDish.id,
            inventoryItemId: line.inventoryItemId,
            quantityPerDish: line.quantityPerDish,
          })),
        })
      }
      return newDish
    })

    revalidatePath('/admin/menu')
    return okResult(dish)
  } catch (err) {
    return toErrorResult(err, 'Could not create this dish. Please try again.')
  }
}
```
`updateDish` follows the identical shape, minus its own `imageUrl: input.imageUrl` line on the
final `tx.dish.update` call — everything else (the conditional recipe-replace block, the
`try/catch` → `okResult`/`toErrorResult` wrapping) is untouched.

**`deleteDish` — required change, not optional (new FK to clean up):**
```ts
export async function deleteDish(id: string) {
  await requireAdmin()

  const orderReferences = await prisma.orderDish.count({ where: { dishId: id } })
  if (orderReferences > 0) {
    await prisma.dish.update({ where: { id }, data: { isActive: false } })
    revalidatePath('/admin/menu')
    return { archived: true }
  }

  await prisma.$transaction(async (tx) => {
    await tx.dishIngredient.deleteMany({ where: { dishId: id } })
    // NEW — required. DishMedia.dish has no onDelete clause (RESTRICT, matching this schema's
    // established convention), so a hard-delete without this line now throws an unhandled P2003
    // the instant a dish with ANY attached media is deleted with zero order history. This is not
    // an enhancement, it's a correctness fix forced by the new relation — omitting it would be a
    // real regression versus today's (pre-DishMedia) working delete flow.
    await tx.dishMedia.deleteMany({ where: { dishId: id } })
    await tx.dish.delete({ where: { id } })
  })

  revalidatePath('/admin/menu')
  return { archived: false }
}
```
As with every other deletion path in this app's accepted orphaned-object tradeoff, the bucket
objects those deleted `DishMedia` rows pointed at are **not** removed from MinIO — same permanent,
uniform policy as everywhere else in this feature. This is the one required line added to
`deleteDish`; it stays otherwise on its original bare-throw/no-`ActionResult` shape, which remains
a deliberate, not-migrated-in-this-pass decision (see Open Questions).

**New actions — `src/app/admin/menu/[id]/actions.ts`:**
```ts
"use server"

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { ActionError, okResult, toErrorResult, type ActionResult } from '@/lib/errors'
import { addDishMediaSchema, reorderDishMediaSchema, idSchema } from '@/lib/validation'
import type { DishMedia } from '@prisma/client'

export async function addDishMedia(
  input: { dishId: string; url: string; type: 'IMAGE' | 'VIDEO' }
): Promise<ActionResult<DishMedia>> {
  await requireAdmin()
  try {
    const parsed = addDishMediaSchema.parse(input)
    const media = await prisma.$transaction(async (tx) => {
      const current = await tx.dishMedia.aggregate({
        where: { dishId: parsed.dishId },
        _max: { position: true },
      })
      return tx.dishMedia.create({
        data: {
          dishId: parsed.dishId,
          url: parsed.url,
          type: parsed.type,
          position: (current._max.position ?? -1) + 1,
        },
      })
    })
    revalidatePath(`/admin/menu/${parsed.dishId}`)
    revalidatePath('/admin/menu') // the gallery card's cover may have just been set for the first time
    return okResult(media)
  } catch (err) {
    return toErrorResult(err, 'Could not attach this media. Please try again.')
  }
}

export async function removeDishMedia(id: string): Promise<ActionResult<{ dishId: string }>> {
  await requireAdmin()
  try {
    const parsedId = idSchema.parse(id)
    // No renumbering — see Database Changes' "Cover and position convention." Bucket object is
    // NOT deleted — same permanent accepted tradeoff as everywhere else in this feature.
    const deleted = await prisma.dishMedia.delete({ where: { id: parsedId } })
    revalidatePath(`/admin/menu/${deleted.dishId}`)
    revalidatePath('/admin/menu')
    return okResult({ dishId: deleted.dishId })
  } catch (err) {
    return toErrorResult(err, 'Could not remove this media. Please try again.')
  }
}

export async function reorderDishMedia(
  input: { dishId: string; mediaId: string; direction: 'up' | 'down' }
): Promise<ActionResult<DishMedia[]>> {
  await requireAdmin()
  try {
    const parsed = reorderDishMediaSchema.parse(input)
    const items = await prisma.dishMedia.findMany({
      where: { dishId: parsed.dishId },
      orderBy: { position: 'asc' },
    })
    const index = items.findIndex(m => m.id === parsed.mediaId)
    if (index === -1) throw new ActionError('That media item no longer exists.', 'NOT_FOUND')

    const swapIndex = parsed.direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= items.length) {
      // Already at the boundary. The UI disables the button here, so this is a defense-in-depth
      // no-op against a stale render, not an expected everyday path — deliberately still `ok:true`,
      // not an error, since nothing actually went wrong.
      return okResult(items)
    }

    const [a, b] = [items[index], items[swapIndex]]
    const updated = await prisma.$transaction([
      prisma.dishMedia.update({ where: { id: a.id }, data: { position: b.position } }),
      prisma.dishMedia.update({ where: { id: b.id }, data: { position: a.position } }),
    ])
    revalidatePath(`/admin/menu/${parsed.dishId}`)
    return okResult(updated.sort((x, y) => x.position - y.position))
  } catch (err) {
    return toErrorResult(err, 'Could not reorder media. Please try again.')
  }
}
```

**New action — `src/app/dashboard/actions.ts` (added alongside the existing `requestAddEmail`/
`requestAddPhone`/`updateNotificationPreferences` exports, same file):**
```ts
export async function updateProfilePhoto(imageUrl: string | null): Promise<ActionResult<{ imageUrl: string | null }>> {
  try {
    const user = await getCurrentDbUser()
    if (!user) return { ok: false, error: NOT_SIGNED_IN, code: 'VALIDATION' }

    const input = updateProfilePhotoSchema.parse({ imageUrl })
    const updated = await prisma.user.update({
      where: { id: user.id }, // NEVER a client-supplied id — this is the entire authorization
                               // model for this action, mirroring requestAddContact/verifyAddContact
                               // immediately above it in this same file.
      data: { imageUrl: input.imageUrl },
      select: { imageUrl: true },
    })

    revalidatePath('/dashboard')
    return okResult(updated)
  } catch (err) {
    return toErrorResult(err, 'Could not save your photo. Please try again.')
  }
}
```
Deliberately no OTP/verification step, unlike `requestAddEmail`/`requestAddPhone` — a photo
doesn't establish identity or become a delivery destination, so there's nothing to prove ownership
of before writing it (the same reasoning `updateCustomer`'s original-release docstring already gave
for why `imageUrl` was exempt from admin-side write-once; it applies identically here to why
self-service needs no two-step proof either). Also no uniqueness constraint to collide with,
unlike email/phone.

### Frontend Changes

**Renamed primitive: `src/components/ui/media-upload.tsx`** (was `image-upload.tsx`/`ImageUpload`).
Same Base-UI-primitive-plus-`cva`/Tailwind construction, same visually-hidden native `<input
type="file">` triggered by a styled dashed-border preview button — **the internal mechanics below
are unchanged from the original release**, only the name, the config, and the `onChange` signature
change:

```ts
export type MediaUploadStatus = 'idle' | 'uploading' | 'success' | 'error'

interface MediaUploadProps {
  value: string | null
  // WIDENED: onChange now optionally reports the uploaded file's contentType too, so a caller that
  // needs to distinguish IMAGE vs VIDEO (only DishDetailsClient does) doesn't have to re-derive it
  // from the URL string. Existing single-arg callers (ProfilePhoto) are unaffected — the parameter
  // is additive, not a breaking signature change for them.
  onChange: (url: string | null, contentType?: string) => void
  onStatusChange?: (status: MediaUploadStatus) => void
  entityType: 'dish' | 'customer'
  label?: string
  disabled?: boolean
}

/**
 * Per-entityType config, keyed the same way KEY_PREFIX is in storage/actions.ts. This is the
 * concrete mechanism for "entityType-aware ACCEPTED_TYPES/MAX_BYTES" — a lookup, not a branch
 * scattered through the component body.
 */
const MEDIA_CONFIG: Record<'dish' | 'customer', { maxBytes: number; maxLabel: string; acceptedTypes: string; hint: string }> = {
  customer: {
    maxBytes: 8 * 1024 * 1024,
    maxLabel: '8MB',
    acceptedTypes: 'image/jpeg,image/png,image/webp',
    hint: 'JPEG, PNG or WebP, up to 8MB.',
  },
  dish: {
    // ONE combined cap covers both photos and video for a dish — not a second cap dimension per
    // content type. A dish photo will never realistically approach 100MB; splitting this into
    // "image cap" vs "video cap" would add a config axis for no practical benefit.
    maxBytes: 100 * 1024 * 1024,
    maxLabel: '100MB',
    acceptedTypes: 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime',
    hint: 'JPEG, PNG, WebP, MP4, WebM or MOV, up to 100MB.',
  },
}
```

Every other internal behavior from the original design is unchanged and still applies verbatim —
restated briefly since it's still load-bearing, not because it changed:
- File-size check against `MEDIA_CONFIG[entityType].maxBytes` on selection, before any network call.
- Instant `URL.createObjectURL(file)` preview, revoking the prior object URL first.
- The `uploadGenerationRef` stale-result guard (a slow first upload can never overwrite a faster,
  later one's result) — this still matters for dish media too: picking a second file before the
  first upload resolves is just as possible in the detail page's "add media" slot as it was in the
  original single-photo field.
- Sequence per attempt: `getMediaUploadUrl({ entityType, contentType: file.type })` →
  `fetch(uploadUrl, { method: 'PUT', ... })` → `onChange(publicUrl, file.type)` on success.
- Retry re-runs against the already-selected `file` (kept in a ref), requesting a **fresh**
  presigned URL rather than replaying a possibly-expired one — see Edge Cases for why this matters
  more now than it did for 8MB photos.
- Plain `<img>`, never `next/image` — unchanged, same reasoning (blob: preview URLs aren't
  next/image-compatible; no `images.remotePatterns` needed).
- One net-new behavior, specific to video: the dashed-border preview tile itself still only ever
  renders `<img>` internally (never `<video>`) for its OWN live preview while uploading — even for
  a video file mid-upload, the tile shows a generic file/upload icon instead of attempting a video
  thumbnail, since browsers have no reliable free way to extract a poster frame from a `blob:` URL
  without actually loading it into a `<video>` element first. Real video **playback** only ever
  happens on the dish detail page's finished gallery (`<video controls>`), never inside this
  uploader component itself.

**New shared module: `src/app/admin/menu/RecipeBuilder.tsx`** — extracted, not new logic. The
original release's `RecipeBuilder` component, `optionsForRow`, `buildIngredients`, and
`recipePayload` all move here verbatim out of `MenuClient.tsx`, because **two** components now need
them: the gallery page's lightweight create modal, and the new detail page's Details section. One
real signature change is required in the move: `buildIngredients` was a closure over `MenuClient`'s
own `inventory` prop; as a shared export it takes `inventory` as an explicit parameter instead —
`buildIngredients(dishId, rows, fallbackDish, inventory)` — so both call sites can supply their own
copy of the same `inventory` prop without a closure to rely on. `optionsForRow`'s signature is
unchanged (`inventory` was already an explicit parameter there). Everything about *why* each of
these functions exists — the archived-ingredient reinjection in `optionsForRow`, the
duplicate-summing in `buildIngredients` — is unchanged; only the file they live in and
`buildIngredients`'s parameter list change.

**`MenuClient.tsx` — rewritten from a table to a card gallery.** State that's REMOVED entirely:
`newImageUrl`/`newImageStatus`/`editImageUrl`/`editImageStatus` (no image field on this screen at
all anymore — media lives exclusively on the detail page) and the whole edit-dialog block (`Dialog
open={!!editingDish}`, replaced by navigation). State that's KEPT: `data`, `globalFilter`,
`newRecipe` (still needed by the now-lightweight create modal), `deletingDish`/`AlertDialog`
(delete confirmation, unchanged). TanStack Table (`useReactTable`, column defs, `<table>` markup) is
**removed entirely** — there's no "columns" concept in a card grid. Search stays as a plain
controlled `<Input>` feeding a `useMemo`-derived filtered array (`data.filter(d =>
d.name.toLowerCase().includes(globalFilter.toLowerCase()))`, still highlighted via the existing
`HighlightText` component on each card's name); sorting is dropped, since column-header sort has no
grid equivalent and wasn't named as must-preserve. Pagination becomes a small local `page` state +
`.slice(page * PAGE_SIZE, ...)` with plain Previous/Next buttons — not a reuse of the existing
`TablePagination` component, which is built around a TanStack `Table` instance this screen no
longer has.

Each card renders: a cover thumbnail, the dish name (highlighted), price (`formatCurrency`),
serving size, an active/archived badge, and three actions — Edit (a `<Link href={`/admin/menu/
${dish.id}`}>`, not a click handler that opens a dialog), Archive/Restore (`toggleDishActive`,
unchanged, immediate), and Delete (opens the same `AlertDialog` as before, unchanged). **Cover
selection for the compact card thumbnail is IMAGE-only, even though "cover" for ordering purposes
elsewhere is type-agnostic**: the card renders `<img src={dish.media.find(m => m.type ===
'IMAGE')?.url}>` — the lowest-position **image** among the dish's media, not simply
`dish.media[0]`. A dish whose only media is a video shows the same `UtensilsCrossed` icon
placeholder as a dish with no media at all, plus a small film-icon badge overlay so the admin still
knows video content exists without it needing to fake a thumbnail. This is a deliberate, narrow
scope call: generating a real video poster frame would need either server-side video processing
(explicitly a non-goal, see PRD) or loading the actual video client-side just to grab a frame,
neither of which is worth it for a compact grid thumbnail.

The create modal keeps `name`/`price`/`servingSize` inputs and `<RecipeBuilder>` (imported from the
new shared module), and **loses** the `<ImageUpload>` field it had in the original release — a bare
`<form action={handleAdd}>` with a plain, always-enabled `Save Dish` submit button, since there's no
upload-in-progress state left on this screen to gate it on. `handleAdd` drops the `imageUrl:
newImageUrl` line from its `createDish(...)` call and the `setNewImageUrl(null)`/
`setNewImageStatus('idle')` resets after success — otherwise unchanged (still unwraps
`ActionResult`, still no `try/catch` around the call, same pre-existing, out-of-scope gap as
before).

**New route: `src/app/admin/menu/[id]/page.tsx`** — mirrors `admin/orders/[id]/page.tsx`'s
established shape exactly (Server Component, `params: Promise<{ id: string }>`, `await
props.params`, direct Prisma fetch, `notFound()`, props down to a Client component):
```ts
export default async function DishDetailsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const dish = await prisma.dish.findUnique({
    where: { id },
    include: {
      ingredients: { include: { inventoryItem: true } },
      media: { orderBy: { position: 'asc' } },
    },
  })
  if (!dish) notFound()

  const inventory = await getInventoryItems()
  return (
    <div className="flex-1 space-y-6 p-8 pt-6 max-w-4xl mx-auto">
      <DishDetailsClient dish={dish} inventory={inventory} />
    </div>
  )
}
```

**New: `src/app/admin/menu/[id]/DishDetailsClient.tsx`** — two sections:
- **Details**: name/price/servingSize inputs + `<RecipeBuilder>` (the same shared component, same
  `optionsForRow`/`buildIngredients`/`recipePayload` helpers, `dish` passed through for archived-
  ingredient reinjection exactly as the original edit dialog did), saved via a `<form
  action={handleSave}>` calling `updateDish` — this is a straight relocation of the original edit
  dialog's form fields onto a full page, no new logic.
- **Photos & Video**: a grid of the dish's `media` (sorted by `position`), each tile rendering
  `<img>` for `type:'IMAGE'` or `<video controls className="h-full w-full object-cover">` for
  `type:'VIDEO'` (no custom player library — the repo's existing "no next/image" restraint extends
  naturally to "no video player library" too), plus move-left/move-right icon buttons (disabled at
  the first/last position) calling `reorderDishMedia`, and a Remove ("×") button calling
  `removeDishMedia` with no confirmation dialog (a low-stakes, easily-reversed action — re-adding a
  removed item is just picking the same file again — unlike deleting the whole dish, which stays
  behind an `AlertDialog`). At the end of the grid, an "Add media" slot renders `<MediaUpload
  value={null} onChange={handleMediaUploaded} entityType="dish" label="Add photo or video" />`.

**Concrete mechanism for resetting the "add media" slot after each successful add** (the same
question the original design answered for `ImageUpload`'s internal generation counter, now one
level up): `DishDetailsClient` holds `const [mediaUploadKey, setMediaUploadKey] = useState(0)` and
renders `<MediaUpload key={mediaUploadKey} ... />`. `handleMediaUploaded` calls `addDishMedia`,
appends the result to local `media` state on success, and increments `mediaUploadKey` — remounting
`MediaUpload` with fresh internal state for the next pick. This reuses the exact remount-to-reset
technique this codebase already established for `CustomerFormFields` (`key={isOpen ? 'add-open' :
'add-closed'}`, `key={editingCustomer?.id}`), not a new pattern:
```ts
async function handleMediaUploaded(url: string | null, contentType?: string) {
  if (!url || !contentType) return // MediaUpload's onChange(null) only fires on an explicit clear,
                                    // which this always-empty "add" slot has no meaningful use for
  const type = contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE'
  const result = await addDishMedia({ dishId: dish.id, url, type })
  if (!result.ok) {
    toast.add({ title: 'Error', description: result.error, type: 'error' })
    return
  }
  setMedia(prev => [...prev, result.data])
  setMediaUploadKey(k => k + 1)
}
```
`type` is derived from the browser-reported `file.type` and trusted as-is, not verified against the
file's actual bytes — consistent with this feature's existing content-type trust posture (see
Security Considerations): worst case of a lie here is a video rendered in an `<img>` tag (broken
preview) or vice versa, a cosmetic-only failure mode, not a security one.

**`CustomerClient.tsx` — simplified, not extended.** `CustomerFormFields` loses its `<ImageUpload>`
field (now `<MediaUpload>`, but irrelevant here since it's removed outright) and its
`imageUrl`/`onImageChange`/`onImageStatusChange` props — it goes back to exactly the shape it had
before the original release (`customer`, `idPrefix` only). `CustomerClient` itself loses
`newImageUrl`/`newImageStatus`/`editImageUrl`/`editImageStatus` state and `openEdit`'s
`setEditImageUrl(...)`/`setEditImageStatus(...)` lines. `handleAdd`/`handleEdit` drop `imageUrl:
newImageUrl` / `imageUrl: editImageUrl` from their `createCustomer`/`updateCustomer` calls, and
both Save buttons go back to being unconditionally enabled (no more `disabled={newImageStatus ===
'uploading'}` — there's nothing left on this form that can be "uploading"). **The read-only
thumbnail/avatar column (the `columnHelper.display({id:'thumbnail', ...})` block, `<img>`/initials-
badge/icon-fallback) is completely untouched** — it doesn't read from `MediaUpload`/`ImageUpload`
at all, only from `customer.imageUrl` on the row data, which is still set (now exclusively via the
new dashboard action below).

**New: `src/app/dashboard/ProfilePhoto.tsx`** — a new "use client" component, same file-per-section
convention as the existing `AddContactForm.tsx`/`NotificationPreferences.tsx` in this directory:
```tsx
"use client"
export function ProfilePhoto({ initialImageUrl }: { initialImageUrl: string | null }) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Unlike MenuClient/CustomerClient's original pattern (merge into a bigger form's save payload),
  // there IS no surrounding form here — a photo is the entire content of this widget. So a
  // successful upload is persisted immediately, the moment MediaUpload's onChange fires, rather
  // than waiting for a Save click that has nothing else to batch with. This is arguably closer to
  // the product's "Instagram flow" intent than the original dish/customer dialogs ever were.
  async function handleChange(url: string | null) {
    setImageUrl(url) // optimistic — MediaUpload's own preview already shows this
    setIsSaving(true)
    setError(null)
    try {
      const result = await updateProfilePhoto(url)
      if (!result.ok) setError(result.error)
    } catch {
      setError('Could not save your photo. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-sm font-bold text-foreground">Your photo</h2>
      <p className="meta-text mt-0.5 mb-4">
        {imageUrl
          ? 'Shown to the kitchen team so they can recognize you.'
          : 'Add a photo so the kitchen team can recognize you.'}
      </p>
      <MediaUpload value={imageUrl} onChange={handleChange} entityType="customer" label="Photo" />
      {isSaving && <p className="text-xs text-muted-foreground mt-2">Saving…</p>}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  )
}
```

**`src/app/dashboard/page.tsx`** — one new, **unconditional** render (deliberately NOT following
`missingChannel`'s conditional-gating pattern, since a photo is always optional and always
changeable, not a one-time fill-in-the-blank):
```tsx
<ProfilePhoto initialImageUrl={customer.imageUrl} />
```
Placed above the conditional `{missingChannel && <AddContactForm .../>}` block — `customer` is
already in scope from the existing `getCurrentDbUser()` call at the top of this Server Component,
so `customer.imageUrl` needs no new query. Ordering rationale: the photo is this page's most
immediately visual/identity element and has no conditional logic gating it, so it reads naturally
as the first thing on the page, ahead of the (sometimes-absent) contact-method prompt and the
notification-preferences card below it.

### New infrastructure: `docker-compose.yml` (repo root)
Fully standalone from the Supabase-CLI-managed Docker containers — a separate lifecycle
(`docker compose up -d` / `docker compose down`), not folded into `supabase start`/`stop`. This
project already treats its single local Postgres instance as shared across parallel git worktrees
(see prior RFCs); MinIO follows the same precedent deliberately — one shared local instance, not a
per-worktree namespaced one, to stay consistent with existing practice rather than introducing a
second, different convention for infra sharing.

```yaml
services:
  minio:
    image: minio/minio:latest
    container_name: chop-with-rostty-minio
    restart: unless-stopped
    ports:
      - "9000:9000"   # S3 API — this is the port both the app's server AND the browser hit
      - "9001:9001"   # Web console (http://127.0.0.1:9001)
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
      # Local-dev-only, well-known credential — same "safe to share, never used in production"
      # precedent as Supabase's local demo service-role key in .env.example.
      MINIO_API_CORS_ALLOW_ORIGIN: "http://127.0.0.1:3000"
      # Needed for the browser's direct cross-origin PUT (127.0.0.1:3000 → 127.0.0.1:9000) to
      # pass a CORS preflight. MinIO's own default is already "*" (all origins) per current docs,
      # but this is set explicitly rather than relied on implicitly — see Open Questions: several
      # past MinIO releases have had CORS-preflight bugs even with this set correctly, so this
      # needs a real live check, not just trusting the documented default.
    volumes:
      - minio-data:/data
    command: server /data --console-address ":9001"
    healthcheck:
      # NOT curl — curl was removed from the minio/minio image in recent releases (confirmed via
      # minio/minio#18378/#18389). `mc` ships inside the same image; `mc ready local` is MinIO's
      # own maintainer-recommended healthcheck replacement.
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    # Runs INSIDE the compose network, so it correctly uses the Docker-internal service name
    # `minio`, NOT 127.0.0.1 — do not "fix" this to match the app's own MINIO_ENDPOINT value below,
    # they are two different consumers on two different networks. One-shot: creates the bucket and
    # sets it to anonymous-download (public GET by key, no public LIST) so buildPublicUrl()'s
    # stable links work without ever needing a presigned GET.
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb -p local/chop-uploads &&
      mc anonymous set download local/chop-uploads &&
      exit 0
      "

volumes:
  minio-data:
```

**New `.env`/`.env.example` variables** (matching this project's existing documentation density —
grouped, with a comment on what reads each one and what breaks if it's unset):
```
# ── Object Storage (MinIO, local dev via docker-compose.yml) ───────────────
# Browser-reachable address for MinIO's S3 API. Used BOTH server-side (to build the S3Client
# that generates presigned upload URLs) AND embedded directly into the resulting presigned PUT
# URL that the browser uses — these must be the SAME reachable host, because a presigned URL's
# signature is bound to its exact host and cannot be swapped after signing. In this project the
# Next.js server is never itself Dockerized (it always runs on the host via `npm run dev`), so
# 127.0.0.1 is correct here — do NOT set this to the Docker-internal `http://minio:9000`, which
# the browser could never reach.
MINIO_ENDPOINT="http://127.0.0.1:9000"

# Optional override, defaults to MINIO_ENDPOINT if unset. Used ONLY to construct the stable
# public URL stored in DishMedia.url/User.imageUrl (never for presigning). Reserved for a future
# production deployment behind a reverse proxy/CDN domain — see the TDD's Open Questions for why
# this alone does not solve that problem for the PUT side.
MINIO_PUBLIC_ENDPOINT=""

MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="chop-uploads"
MINIO_REGION="us-east-1"   # MinIO ignores this value; the AWS SDK still requires a non-empty string
```

## Alternatives Considered
- **Presigned POST (policy document) instead of presigned PUT.** Presigned POST supports signed
  *conditions* (`content-length-range`, `starts-with $Content-Type image/`) that MinIO enforces
  server-side at upload time — closing the file-size gap noted in Security Considerations below.
  Rejected for v1: more complex to implement and explain, and the size-cap gap is already low-risk
  given the single-trusted-admin threat model. Flagged as the natural upgrade path if this ever
  needs a stricter guarantee (e.g. if a customer-facing upload surface is ever added, which would
  raise the trust level of the uploader considerably).
- **Proxy the upload through a Server Action** (multipart `FormData` → server → MinIO
  `PutObjectCommand`). Rejected outright: this directly contradicts the Instagram-flow requirement
  (ties the upload to the same round trip as the save), doubles the data transfer for zero benefit
  (browser → Next server → MinIO instead of browser → MinIO), and would need Server Actions' body
  size limit raised for image-sized payloads.
- **A third-party hosted upload service** (Cloudinary, Uploadthing, or a managed S3-compatible
  bucket instead of self-hosted MinIO). Rejected because the task explicitly specifies MinIO via a
  new local `docker-compose.yml`; a SaaS dependency would also be a third external cost this
  single-business app doesn't currently carry (Resend and Arkesel are the only two today, both
  justified by needing real message delivery — storage has no equivalent "must be a real network
  service" requirement MinIO can't satisfy self-hosted).
- **Keeping the dish table, adding a second thumbnail-only "gallery" view alongside it** (rather
  than replacing the table outright). Rejected: the project owner's ask was specifically that the
  table display "is really bad," not that a gallery should be added as an alternate view — running
  two displays of the same data would also mean duplicating search/filter state and every action
  handler across both, for a maintenance cost with no real user benefit once the table is gone
  in spirit anyway.
- **Drag-and-drop for reordering dish media** (e.g. `dnd-kit`, `react-beautiful-dnd`). Rejected in
  favor of simple move-left/move-right icon buttons: this app has zero drag-and-drop anywhere
  today, adding one would be a new dependency and a new interaction pattern for a single, low-
  frequency admin action (reordering a handful of media items per dish), and the polish-pack RFC's
  established design mode for this app is explicitly "refined/industrial restraint, not
  maximalism" — a drag interaction is exactly the kind of flourish that mandate argues against for
  a utilitarian kitchen-ops tool. Up/down buttons are slower per-reorder but need no new
  dependency, no touch-vs-mouse handling divergence, and are trivially keyboard-accessible for
  free.

## Edge Cases & Failure Modes
**Carried forward from the original release, unchanged in substance (function/field names updated
where they were renamed):**
- **Abandoned "add media" slot / re-picked file before it resolves** — orphaned bucket object.
  Explicitly accepted, see PRD Non-Goals; now applies uniformly across dish media adds, customer
  self-service uploads, and any picked-a-second-file-before-the-first-resolved case
  (`uploadGenerationRef` still governs the latter, unchanged).
- **Presigned URL expires mid-upload** — the PUT fails with a MinIO signature/access error,
  surfaces through the normal `'error'` status and "Try again" flow, which requests a **fresh**
  presigned URL. See the video-specific entry below for why this stops being a corner case once
  100MB video uploads are in scope.
- **MinIO is unreachable while the app is running** — not caught by `getMediaUploadUrl` (presigning
  is pure local crypto, no network call to MinIO), so a successful Server Action response does NOT
  imply MinIO is up; the failure only ever surfaces at the browser's actual `fetch` PUT.
- **Content-type spoofing** — a client could declare `image/jpeg` while uploading arbitrary bytes.
  Mitigated at the protocol level (`signableHeaders: new Set(['content-type'])`), which still only
  guarantees the *declared* type matches the *signed* type, never that the actual bytes are a real
  file of that type. Bounded by origin isolation exactly as before: served objects live on MinIO's
  own origin, not the app's, so a maliciously-crafted upload still can't reach the Next.js app's
  cookies/session.
- **iOS Safari / HEIC camera photos** — unchanged, still an open, unverified-on-real-device
  question (see Open Questions).

**New in this revision:**
- **A 100MB video upload against the unchanged 10-minute presign expiry, on a slow connection, is
  now a realistic failure mode, not a theoretical one.** The 8MB photo cap made this window
  essentially always sufficient (needs >13KB/s sustained — trivial even on a weak connection). A
  100MB video needs >170KB/s sustained to finish inside 10 minutes, which a poor mobile connection
  genuinely may not sustain. The existing retry mechanism (fresh presigned URL, not a replay of the
  expired one) already handles this correctly with zero new code — but it's now something that will
  actually happen in normal phone-first admin usage, not just a defensive edge case worth having.
  No mitigation beyond the existing retry is proposed here (e.g. chunked/multipart upload) —
  explicitly deferred as a future upgrade if this becomes a frequent real complaint, consistent
  with the PRD's "no video processing" non-goal.
- **A dish's media `type` (`IMAGE`/`VIDEO`) is entirely client-declared**, derived from
  `file.type` and passed straight through `addDishMedia`, never verified against the uploaded
  bytes. Worst case of a mismatch (a video uploaded and tagged `IMAGE`, or vice versa) is a broken
  `<img>`/unplayable `<video>` tile on the detail page — a cosmetic failure, not a security one,
  consistent with this feature's existing "Content-Type is protocol-enforced, file *contents* are
  never sniffed" posture already established for photos.
- **Removing a dish's current cover media** — no special-cased handling needed. Since the cover is
  always computed fresh as "lowest remaining `position`" (see Database Changes), removing the
  current lowest-position item makes the next-lowest the new cover automatically, on the very next
  read, with zero additional writes. Worth naming explicitly as a *non*-edge-case: it looks like it
  should require special handling and deliberately doesn't.
- **Hard-deleting a dish that has attached media** — `deleteDish`'s transaction now explicitly
  cleans up `DishMedia` rows before the `Dish` row itself (see Domain & Service Layer); omitting
  that line would surface as an unhandled `P2003` the first time an admin deletes a dish with any
  media attached and zero order history. The bucket objects those rows pointed at are, as always,
  never removed.
- **A customer self-service upload can be requested by ANY authenticated user, not verified against
  a specific customer identity** — `getMediaUploadUrl`'s `entityType:'customer'` branch checks only
  "is someone logged in," not "is this specifically a CUSTOMER-role user, and is it their own
  upload." This is intentional, not an oversight: the action itself never touches a specific row
  (see Proposed Design), so there's nothing row-scoped to check yet at this step — the actual
  authorization that matters ("can this caller write to THIS `User.id`") is enforced entirely
  inside `updateProfilePhoto`, which always writes `getCurrentDbUser()`'s own `id`, never a
  client-supplied one. An admin account calling `getMediaUploadUrl({entityType:'customer', ...})`
  for themselves would succeed (mint a valid presigned URL) but could only ever attach the result to
  *their own* `User.imageUrl` via `updateProfilePhoto` — there is no path from a minted upload URL
  to writing someone else's row.
- **Concurrent `addDishMedia` calls on the same dish** (two admin tabs uploading to the same dish at
  once) can both read the same `currentMax` `position` before either commits, assigning the same
  `position` to two different new rows. Accepted as a narrow, harmless TOCTOU race — same category
  already accepted elsewhere in this project (e.g. `NotificationSettings`'s singleton first-read
  race) — because a tied `position` only affects which of the two items sorts first among the tie,
  never correctness or data loss; nothing depends on `position` values being unique.

## Security Considerations
**Carried forward, unchanged:**
- Content-Type IS enforced byte-for-byte against what the server signed (`signableHeaders`) — a
  real protocol-level guarantee, not an application-layer allowlist trusting the client.
- The bucket is anonymous-download (public GET by exact key), never anonymous-LIST. UUIDv4 keys are
  not practically guessable. No revocation mechanism exists once a URL is shared outside its
  intended context — see PRD Open Questions (customer-photo-privacy question, unchanged by this
  revision).
- `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` remain server-only, never `NEXT_PUBLIC_`-prefixed.
- No maximum file size is enforced server-side for either images or video — still a client-side-
  only advisory cap, still trivially bypassable by a hand-crafted request.

**Revised — this is now a genuinely mixed-trust surface, not a uniformly admin-only one:**
- `getMediaUploadUrl` gates `entityType:'dish'` with `requireAdmin()` (unchanged posture: admin
  manages the menu, single-role, no per-resource ownership dimension, per the Phase 0 hardening
  RFC's established reasoning) but gates `entityType:'customer'` with `getCurrentDbUser()` only —
  **any authenticated user**, not just the admin. This is a deliberate, necessary widening, not an
  oversight: without it, customer self-service (the entire point of change 1) cannot function at
  all. The real row-level check — "can this caller write to *this* `User.id`" — is enforced
  entirely downstream, in `updateProfilePhoto`, which always writes the caller's own resolved
  `user.id` and never accepts a client-supplied one. This mirrors the exact authorization shape
  already established by `requestAddEmail`/`verifyAddPhone`/`updateNotificationPreferences` in the
  same file — `getCurrentDbUser()`-only gating on an action that can only ever touch the caller's
  own row is this app's established, accepted pattern for customer self-service, not a new class of
  risk introduced here.
- The **accepted no-server-side-size-cap risk is now larger in absolute terms** for dish video
  (100MB default vs. the original 8MB photo cap) — still accepted, on the same admin-only-surface
  reasoning for the `entityType:'dish'` path, but worth restating that the blast radius of a
  deliberately oversized hand-crafted request against MinIO's local disk is bigger now than it was
  when this risk was first accepted. The customer-facing `entityType:'customer'` path stays
  images-only with the original 8MB cap — video is explicitly NOT extended to customer uploads (see
  Non-Goals), which keeps the customer-self-service surface's risk profile unchanged from the
  original release despite now being reachable by any authenticated user rather than only the
  admin.
- No content moderation, virus/malware scanning, or media validation of any kind applies to a
  customer's self-service upload — same posture this app already has toward its own registered
  customers everywhere else (no moderation exists on any other user-generated content in this app).
  Worth stating explicitly now that "any authenticated customer" (not just the admin) is a caller
  of this upload path for the first time.

## Testing Strategy

**Carried forward, unaffected by this revision:** `src/lib/storage/client.test.ts`'s coverage of
`buildPublicUrl()`/`createPresignedUploadUrl()` (including the `signableHeaders` assertion) stays
exactly as originally specified — `client.ts` itself did not change.

**Renamed/extended:**
- `src/lib/storage/actions.test.ts` (was testing `getImageUploadUrl`, now `getMediaUploadUrl`) —
  keeps its original cases (invalid `contentType`/`entityType` → `VALIDATION`, valid input →
  `{uploadUrl, publicUrl}`) and adds: `entityType:'dish'` rejects when `requireAdmin()` throws
  (mocked) — unchanged from before; `entityType:'customer'` rejects when `getCurrentDbUser()`
  resolves `null` (mocked) — **new**, this is the test that would have caught the
  "customer self-service is impossible with an unconditional `requireAdmin()`" bug described above
  if it had shipped as originally reused "as-is"; `entityType:'dish'` accepts `video/mp4`/
  `video/webm`/`video/quicktime` — **new**; `entityType:'customer'` REJECTS all three video content
  types with `ActionResult` code `VALIDATION` even though they're in the base allowlist for dish —
  **new, and the single most important assertion in this file**, since it's the only thing that
  actually proves the `mediaUploadRequestSchema.refine()` gate works, not just that video is
  accepted somewhere.
- `src/components/ui/media-upload.test.tsx` (was `image-upload.test.tsx`, testing `ImageUpload`,
  now `MediaUpload`) — keeps every original case (instant preview, uploading status, success calls
  `onChange`, failure shows error and does not call `onChange`, **the stale-generation race** —
  still the single most important case in this file, still worth flagging by name so it doesn't
  get silently dropped under time pressure) and adds: `entityType="dish"` accepts a `.mp4` file
  selection (no size-cap rejection, `accept` attribute includes `video/mp4`) while
  `entityType="customer"` rejects the same file size against the *customer* 8MB cap even though a
  `entityType="dish"` MediaUpload with the same byte size would accept it under the 100MB cap —
  proves `MEDIA_CONFIG`'s per-entityType lookup is actually wired to the right instance, not a
  global constant; `onChange` is called with `(url, contentType)` — the widened 2-arg signature —
  on a successful upload, asserted directly rather than assumed from the 1-arg cases above.

**New test files, no prior equivalent:**
- `src/app/admin/menu/[id]/actions.test.ts` — `addDishMedia`: first item on a dish gets
  `position: 0`; a second item gets `currentMax + 1` (mocking the `aggregate` call); rejects when
  `requireAdmin()` throws. `removeDishMedia`: deletes the row, returns `{dishId}`, rejects
  `NOT_FOUND` (P2025) cleanly via the existing `toErrorResult` mapping. `reorderDishMedia`: swaps
  two adjacent items' positions correctly for both `direction:'up'` and `direction:'down'`; is a
  no-op (`ok:true`, unchanged list) at each boundary (first item + `'up'`, last item + `'down'`);
  rejects `NOT_FOUND` when `mediaId` doesn't match any item in `dishId`'s list.
- `src/app/admin/menu/actions.test.ts` (existing file, revised, not just extended) — the six
  `imageUrl`-round-tripping cases from the original release (`createDish`/`updateDish` persisting/
  clearing `imageUrl`) are **removed outright**, not just updated — that field no longer exists on
  `Dish` at all. `deleteDish`'s existing test gains a new case: deleting a dish that has attached
  `DishMedia` rows (and zero `OrderDish` references) succeeds and removes both the `Dish` and its
  `DishMedia` rows — this is the test that would have caught the missing `tx.dishMedia.deleteMany`
  line as an unhandled `P2003` if it had been omitted.
- `src/app/dashboard/actions.test.ts` (existing file, extended) — `updateProfilePhoto`: rejects
  `VALIDATION` when `getCurrentDbUser()` resolves `null`; writes to `getCurrentDbUser()`'s own
  `user.id`, never a hypothetical second id (assert the `prisma.user.update` mock's `where` clause
  directly — this is the test that proves the "own row only" authorization claim, not just that the
  action returns `ok:true`); accepts an explicit `null` to clear an existing photo (mirrors
  `updateCustomer`'s original clearing-semantics test, same `.nullish()` reasoning).
- `src/app/dashboard/ProfilePhoto.test.tsx` (new) — renders the empty/idle state when
  `initialImageUrl` is `null`; a successful `MediaUpload` `onChange` calls `updateProfilePhoto` and
  shows a "Saving…" indicator, then clears it; a failed `updateProfilePhoto` call shows an inline
  error without crashing (mirrors `AddContactForm.test.tsx`'s existing error-path shape, if one
  exists, or the same defensive pattern used elsewhere in this directory).
- `src/app/admin/menu/MenuClient.test.tsx` (existing file, **substantially rewritten, not
  incrementally extended** — the underlying component changed from a table to a card grid, so most
  of the original file's `getByRole('row', ...)`/column-header assertions have no equivalent
  target anymore). New shape: card rendering (name/price/servingSize/cover-or-placeholder/status
  badge), search filtering the grid, the create modal's fields (name/price/servingSize/recipe, **no
  image field** — assert `<MediaUpload>` is NOT rendered inside this modal, a meaningful regression
  guard now that it's an intentional removal, not just an absence), Edit renders a `<Link
  href="/admin/menu/{id}">` rather than opening a dialog, archive/restore and delete-with-
  archive-fallback (unchanged behavior, same assertions as before, just against card markup instead
  of row markup).
- `src/app/admin/menu/[id]/DishDetailsClient.test.tsx` (new) — Details section: renders and saves
  name/price/servingSize/recipe via `updateDish`, reusing the same `RecipeBuilder`/
  `optionsForRow`-archived-ingredient-reinjection assertions the original `MenuClient.test.tsx` had
  for its edit dialog (now against this file, since that's where the logic actually lives).
  Photos & Video section: renders existing media in `position` order; `<img>` for `IMAGE`,
  `<video controls>` for `VIDEO`; move-left/move-right calls `reorderDishMedia` and is disabled at
  each boundary; Remove calls `removeDishMedia` with **no** confirmation dialog (assert no
  `AlertDialog` appears, unlike dish deletion); a successful "add media" upload calls `addDishMedia`
  and the uploader slot resets (assert `mediaUploadKey`'s remount by asserting the previous
  preview/status is gone after a successful add, not by reaching into the counter directly).
- `src/app/admin/customers/CustomerClient.test.tsx` (existing file — **targeted removals, not a
  rewrite**, since most of this file is unaffected): remove the create-dialog assertion at line
  ~189 (`expect(mockCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'New
  Customer', imageUrl: null }))`) and replace it with an assertion that the call does **not**
  include an `imageUrl` key at all (`expect.not.objectContaining({ imageUrl: expect.anything() })`
  or an equivalent explicit-shape assertion) — a meaningful regression guard, not just a deletion,
  since a stray `imageUrl: null` silently reappearing would indicate the field crept back in. The
  **thumbnail/avatar column tests (`describe('CustomerClient — thumbnail/avatar column (FE-005)')`,
  covering `<img>`-when-set / initials-badge / icon-fallback rendering) are explicitly UNCHANGED and
  must keep passing exactly as they are** — they read `customer.imageUrl` off row data, never touch
  `MediaUpload`/`ImageUpload`, and this revision does not alter that column at all.
- `tests/integration/menu-dish-actions.integration.test.ts` (existing file, revised) — the six
  `imageUrl`-round-trip cases (persists/clears/leaves-untouched, on both `createDish` and
  `updateDish`) are **removed**, same reasoning as the unit-test removal above. New integration
  coverage: `addDishMedia`/`removeDishMedia`/`reorderDishMedia` round-trip real `DishMedia` rows
  through Postgres (position assignment, the no-renumbering-on-remove behavior, the reorder swap) —
  **deliberately still does not exercise real MinIO**, `DishMedia.url` is an opaque string column
  to Postgres just as `Dish.imageUrl` was, same reasoning as the original release's testing-plan
  split (mocked unit tests own the storage layer, the Postgres-only integration suite owns
  persistence/relations).
- Existing `createCustomer`/`updateCustomer` integration tests: any `imageUrl` round-trip
  assertions added during the original release's pass are removed (the schema no longer accepts
  the field on these two actions); no replacement coverage is needed there since
  `updateProfilePhoto`'s own new integration coverage (below) already exercises `User.imageUrl`
  end-to-end via the correct, now-only, write path.
- New integration coverage for `updateProfilePhoto` (`tests/integration/dashboard-actions
  .integration.test.ts` or an extension of an existing dashboard-actions integration file, if one
  already exists from the phone-OTP/notifications RFC): a real customer row's `imageUrl` round-
  trips through Postgres via this action, scoped correctly to `getCurrentDbUser()`'s resolved id.

**Manual QA (unchanged categories, now covering more surface):** the original release's "pick a
real file against a running local MinIO" and "iOS Safari/HEIC" checks still apply; add a real
device/browser check of an actual short video file uploading against local MinIO (mp4 from a
phone, mov from an iPhone if available) before considering change 3 done, and a real end-to-end
pass of the dashboard self-service flow as a logged-in customer (not an admin) before considering
change 1 done — this is the first customer-facing (as opposed to admin-facing) manual check this
feature has ever needed, worth calling out since every other manual QA step to date in this
feature has been performed from the admin side.

## Rollout Plan
- Still no feature flag — additive/optional in effect (a dish with no media, a customer with no
  photo, both render placeholders and nothing else in the app depends on either being set) — same
  reasoning as before, still matches this app's no-feature-flag precedent.
- Sequencing, revised for the schema drop+add: (1) schema rollout procedure above, fully
  complete first — **this time confirm no concurrent worktree/pipeline is still reading
  `Dish.imageUrl`**, since this push actively removes that column rather than just adding new ones;
  (2) `docker compose up -d`, confirm `minio-init` completes (unchanged from before — no compose
  file changes in this revision); (3) `.env` values unchanged, nothing new to add (no new
  `MINIO_*` variables — the video content types are handled entirely in application code, not
  infrastructure config); (4) application code lands.
- **Immediate action needed from whoever owns `.env` for this worktree — unchanged from the
  original release**: the same six `MINIO_*` variables, no additions.
- **Rollback is now more consequential than the original release's rollback plan described.**
  Reverting the application code alone is not enough this time: `Dish.imageUrl` was **dropped**, not
  just left unused, so rolling back the code without also reverting the schema would leave
  `createDish`/`updateDish` trying to read/write a column that no longer exists. A genuine rollback
  requires reverting `schema.prisma` (re-adding `Dish.imageUrl`, dropping `DishMedia`/`MediaType`)
  and re-running the same gated two-database `db push` procedure in reverse, in the same order —
  this is no longer a "the new columns are harmless to leave in place" situation like the original
  release's purely-additive rollout was. Any `DishMedia` rows created between deploy and rollback
  are lost when the table is dropped (their bucket objects remain orphaned in MinIO, unreferenced,
  consistent with this feature's permanent no-cleanup policy — just now unreachable from the app
  too).
- Recommended (not required) follow-up, unchanged from the original release: `"minio:up"`/
  `"minio:down"` `package.json` scripts and an `AGENTS.md` Local Dev Quick Start mention, so the
  compose file doesn't stay tribal knowledge.

## Open Questions
**Carried forward unchanged from the original release:**
- **Blocking-for-planning, needs live verification, not a product decision**: does this specific
  MinIO version's `MINIO_API_CORS_ALLOW_ORIGIN` setting reliably pass the browser's cross-origin
  presigned PUT preflight, or does it also need explicit bucket-level `mc cors set`? Unaffected by
  any of the three scope changes — still needs a real check the first time the compose stack is
  brought up, before trusting any upload flow (dish media or customer self-service) end-to-end.
- **Product decision, not technical, NOT reopened by this revision**: customer photos on a
  public-by-key, non-revocable bucket. Moving *who* uploads the photo (admin → customer) does not
  touch the storage/access model at all — this is exactly as open, and exactly as unresolved, as it
  was in the original release. Still a real call for the business owner, not something this
  revision needed to or attempted to resolve.
- **iOS Safari / HEIC re-encoding** (see Edge Cases) — still unverified on a real device, unaffected
  by any of the three changes.
- **Deferred, explicitly not blocking**: production deployment topology (reverse proxy/CDN, TLS,
  managed S3 alternative) — unchanged, still out of scope for local-dev-focused work.

**Superseded/resolved by this revision (listed so they aren't mistakenly re-asked):**
- The original release's "how much of `menu/actions.ts` to retrofit to `ActionResult`" question is
  narrowed, not fully closed: `deleteDish` now has a small **required** (not style-optional) change
  regardless of that broader question — the `tx.dishMedia.deleteMany` cleanup line is mandatory the
  moment `DishMedia` exists, independent of whether `deleteDish` is ever migrated to
  `ActionResult`. `toggleDishActive` remains completely untouched and the original retrofit
  question (migrate it to `ActionResult` now, or leave `menu/actions.ts` permanently mixed-
  convention) is still genuinely open — carried forward, not resolved, just narrower in scope than
  before.

**New in this revision:**
- **Realistic video size ceiling** (mirrored from the PRD): 100MB is proposed as a starting
  default, explicitly not researched against real device output — is it right for the admin's
  actual phone camera, or should it be tuned once real usage is observed? Not blocking
  implementation (the cap is a single constant, trivially adjustable later), but worth the business
  owner's input before or shortly after launch rather than treating it as permanently fixed.
- **Whether `toggleDishActive` (and now, partially, `deleteDish`) staying on the old bare-throw
  pattern remains acceptable indefinitely**, now that this file has THREE actions in the mixed
  state instead of two (`createDish`/`updateDish` on `ActionResult`, `toggleDishActive` fully
  old-pattern, `deleteDish` old-pattern-plus-one-required-new-line). Not blocking this revision's
  implementation, but the mixed-file question keeps getting slightly more entrenched each time this
  file is touched without being resolved — worth a decision before a fourth change touches it again.
