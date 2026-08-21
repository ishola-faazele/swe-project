# Engineering Task List: Dish & Customer Photo Uploads (MinIO)
**Generated**: 2026-08-20
**Revision history**:
- 2026-08-20 (v1) — original 24-task list for the admin-only, `Dish.imageUrl`/`User.imageUrl`
  single-photo scope.
- 2026-08-20 (v2, same day) — added FE-004/FE-005/TEST-008 (table thumbnail columns) after the
  project owner resolved a deferred scope question.
- 2026-08-20 (v3, this revision) — **full replan** following a PRD/TDD scope change requested by
  the project owner before v1/v2 were ever committed: (1) customer photos move from admin-set to
  customer self-service, (2) the admin dish table becomes a card gallery + per-dish detail page,
  (3) `Dish.imageUrl` is replaced by a one-to-many `DishMedia` model supporting multiple photos and
  video. This version supersedes v1/v2 entirely — see "What changed vs. the prior task list" below
  for the ID-level mapping.
**Source PRD**: docs/prd-minio-image-uploads.md
**Source TDD**: docs/tdd-minio-image-uploads.md
**Total Tasks**: 34 across 4 phases (4 Infrastructure, 9 Backend, 7 Frontend, 14 Testing) + 2
Proactively Suggested

**Status legend used below**: `[DONE]` = already complete and verified in this worktree, no
action needed · `[UNCHANGED]` = exists from the original pass and this revision does not touch it
· everything else is real, in-scope work for this revision.

---

## Summary

This revision replaces the original single-scalar, admin-only photo feature with three coordinated
changes on top of an already-working MinIO upload mechanism (presigned PUT, browser-direct upload,
"Instagram flow" — none of that changed and none of it needs re-verification). Customer photos
move from an admin-editable field to genuine customer self-service via a new `updateProfilePhoto`
action, closing off the admin's write path entirely (read-only access is retained). The admin dish
screen is rebuilt from a TanStack Table into a card gallery with a new per-dish detail route
(`/admin/menu/[id]`) that owns both the relocated recipe/details editor and a new media
management UI. And `Dish.imageUrl` — a column that was likely already pushed to both databases
under the original scope — is **dropped** in favor of a real `DishMedia` one-to-many model with an
ordered, gap-tolerant `position` column and a `MediaType` enum, so a dish can carry multiple photos
and a video.

The phasing follows this project's standard dependency chain (schema before data access, data
access before service logic, service logic before UI, UI before its tests), with one added
wrinkle: this is the **first genuinely destructive** schema-push in the project's history (a real
`DROP COLUMN`, not a purely additive change), so BE-001 carries explicit rollout gating that no
prior schema task in this project needed. A second structural theme worth flagging up front: two
of the six backend mutation tasks from the original scope (dish create/update, customer
create/update) are **reversed**, not extended — `imageUrl` is being removed from schemas and
actions that, under the original scope, would have been gaining it. Anyone skimming only task
titles should read the "REVERSES" callouts closely; they are not typos.

Three tasks from the prior task list are confirmed genuinely unaffected by this revision and are
carried forward with no changes: `src/lib/storage/client.ts` (BE-002) and its test (TEST-001), and
`CustomerClient.tsx`'s read-only thumbnail/avatar column (FE-007, the old FE-005) along with its
test coverage (folded into TEST-010's description rather than a separate ID). These are marked
`[UNCHANGED]` below and should not be re-implemented or re-planned.

### What changed vs. the prior task list (ID mapping)

| Old ID | Status this revision | New ID / where it landed |
|---|---|---|
| INFRA-001..004 | `[DONE]` — verified live in this worktree (MinIO container healthy) | Unchanged, same IDs |
| BE-001 | **Reverses** — was "add `imageUrl` columns," now "drop `Dish.imageUrl`, add `DishMedia`/`MediaType`" | BE-001 (rewritten) |
| BE-002 | `[UNCHANGED]` | BE-002 |
| BE-003 | Revised — renames, removes `imageUrl` from 4 schemas, adds 3 new schemas | BE-003 (rewritten) |
| BE-004 | Revised — rename + entityType-conditional auth gate (load-bearing fix) | BE-004 (rewritten) |
| BE-005 | **Reverses** (imageUrl removed, not added) + gains a required `deleteDish` fix | Merged into BE-005 (rewritten) |
| BE-006 | **Reverses** (imageUrl removed, not added) | BE-006 (renumbered, rewritten) |
| — | New | BE-007 (`updateProfilePhoto`), BE-008 (`[id]/actions.ts`), BE-009 (`getDishes` include) |
| FE-001 | Revised — rename to `MediaUpload`, entityType-conditional config, widened `onChange` | FE-001 (rewritten) |
| FE-002 (wire into MenuClient dialogs) | **Void** — dialogs/image state removed entirely | Superseded by FE-003 |
| FE-003 (wire into CustomerClient) | **Void, reversed** — image state/props stripped out | Replaced by FE-005 (strip) + FE-006 (new dashboard component) |
| FE-004 (MenuClient table thumbnail) | **Void** — table is gone; cover selection folded into the card rewrite | Folded into FE-003 |
| FE-005 (CustomerClient table thumbnail) | `[UNCHANGED]` — confirmed unaffected by the TDD | FE-007 (renumbered only) |
| — | New | FE-002 (`RecipeBuilder.tsx` extraction), FE-004 (`[id]/page.tsx` + `DishDetailsClient.tsx`) |
| TEST-001 | `[UNCHANGED]` | TEST-001 |
| TEST-002 | Revised (rename + new cases) | TEST-002 |
| TEST-003 (new `createDish`/`updateDish` validation file) | Superseded — that file already exists now, revision is to remove/replace cases, not create | Folded into TEST-004 |
| TEST-004 (`image-upload.test.tsx`) | Revised (rename + new cases) | TEST-003 (renumbered) |
| TEST-005 (integration rewrite for `ActionResult`) | Superseded — that unwrap already happened under the original scope; this pass removes/adds different cases | Folded into TEST-011 |
| TEST-006 (customer integration `imageUrl` extension) | **Reverses** — cases removed, not added | TEST-012 (renumbered, reversed) |
| TEST-007 (manual QA) | Revised/extended (video + customer-facing flow) | TEST-014 (renumbered) |
| TEST-008 (table thumbnail rendering) | Half `[UNCHANGED]` (`CustomerClient` half), half void (`MenuClient` half, table is gone) | `CustomerClient` half folded into TEST-010; `MenuClient` half superseded by TEST-008 (new, card-grid version) |
| — | New | TEST-005, TEST-006, TEST-007, TEST-009, TEST-013 |
| PROACTIVE-001 | `[UNCHANGED]`, still not done (confirmed via `package.json`) | PROACTIVE-002 (renumbered) |

## Dependency Graph

```
Phase 1 (Foundation)
  INFRA-001..004 [DONE] ──────────────────────────────────────────────────┐
  BE-001 (schema: DROP Dish.imageUrl, ADD DishMedia/MediaType) ───────────┼──> Phase 2
                                                                            │
Phase 2 (Core Logic)                                                      │
  BE-002 [UNCHANGED] ──> BE-004                                           │
  BE-003 (validation revision, no DB dependency)                         │
  BE-002 + BE-003 ──> BE-004 (getMediaUploadUrl)                         │
  BE-001 + BE-003 ──> BE-005 (menu/actions.ts: imageUrl OUT, DishMedia cleanup IN)
  BE-003 ──> BE-006 (customers/actions.ts: imageUrl OUT)
  BE-003 ──> BE-007 (dashboard/actions.ts: updateProfilePhoto NEW)
  BE-001 + BE-003 ──> BE-008 ([id]/actions.ts: addDishMedia/removeDishMedia/reorderDishMedia NEW)
  BE-001 ──> BE-009 (getDishes() include widening)
                                                                            │
Phase 3 (Integration & UI)                                                │
  BE-004 ──> FE-001 (MediaUpload primitive)                               │
  FE-002 (RecipeBuilder extraction — no hard backend dependency)          │
  FE-001 + FE-002 + BE-005 + BE-009 ──> FE-003 (MenuClient.tsx rewrite)   │
  FE-001 + FE-002 + BE-005 + BE-008 ──> FE-004 ([id]/page.tsx + DishDetailsClient.tsx)
  BE-006 ──> FE-005 (CustomerClient.tsx — strip image state)              │
  FE-001 + BE-007 ──> FE-006 (dashboard ProfilePhoto.tsx)                 │
  FE-007 [UNCHANGED]                                                      │
                                                                            │
Phase 4 (Testing & Polish)                                                │
  TEST-001 [UNCHANGED]              BE-004 ──> TEST-002                   │
  FE-001 ──> TEST-003                BE-005 ──> TEST-004                  │
  BE-008 ──> TEST-005                BE-007 ──> TEST-006                  │
  FE-006 ──> TEST-007                FE-003 ──> TEST-008                  │
  FE-004 ──> TEST-009                FE-005 ──> TEST-010                  │
  BE-001+BE-005+BE-008 ──> TEST-011  BE-006 ──> TEST-012                  │
  BE-007 ──> TEST-013                                                     │
  FE-003+FE-004+FE-006+INFRA-004 ──> TEST-014 (manual QA)                │
  PROACTIVE-002 depends only on INFRA-002 [DONE]                         │
```

No circular dependencies. `BE-001` is the one hard gate almost everything else in Phase 2+ sits
behind, because it both removes a column several actions currently read/write and adds the model
three new actions depend on — it must land, complete, before any application code in this
revision is written, exactly as the TDD's Rollout Plan specifies.

---

## Phase 1: Foundation

### INFRA-001 · MinIO SDK dependencies `[DONE]`
**Category**: Infrastructure · **Phase**: 1 · **Dependencies**: None

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are already installed. Unaffected by any
of the three scope changes — the TDD confirms zero changes to this dependency set. No action
needed.

---

### INFRA-002 · Root `docker-compose.yml` for local MinIO `[DONE]`
**Category**: Infrastructure · **Phase**: 1 · **Dependencies**: None

Already exists and matches the TDD's compose config verbatim (confirmed: the TDD explicitly states
zero changes to `docker-compose.yml` in this revision). No action needed.

---

### INFRA-003 · MinIO environment variables `[DONE]`
**Category**: Infrastructure · **Phase**: 1 · **Dependencies**: INFRA-002

Already set in this worktree's `.env`/`.env.example`. The TDD confirms no new `MINIO_*` variables
are introduced by this revision — video content types are handled entirely in application code
(BE-003/BE-004), not infrastructure config. No action needed.

---

### INFRA-004 · MinIO stack up and verified `[DONE]`
**Category**: Infrastructure · **Phase**: 1 · **Dependencies**: INFRA-002, INFRA-003

`docker ps` confirms `chop-with-rostty-minio` healthy, up for hours, with live CORS/presign/
content-type-enforcement checks already run against this exact stack. No action needed. (The
TDD's own "blocking-for-planning" CORS open question was resolved by this same live verification.)

---

### BE-001 · Schema: drop `Dish.imageUrl`, add `DishMedia` model + `MediaType` enum
**Category**: Backend · **Phase**: 1 · **Dependencies**: None

**Reverses the old BE-001**, which added `imageUrl` to both `Dish` and `User`. This revision drops
`Dish.imageUrl` entirely and replaces it with a one-to-many `media: DishMedia[]` relation and a new
`MediaType` enum (`IMAGE`/`VIDEO`). `User.imageUrl` is completely untouched — do not remove, alter,
or re-add anything on `User` as part of this task.

**Technical Notes**
- This is the project's **first genuinely destructive** schema-push (a real `DROP COLUMN`) —
  every prior schema change here was purely additive. Before running `db push` against the shared
  local dev DB, confirm no concurrent worktree/pipeline is still reading `Dish.imageUrl`.
- `DishMedia` has **no `onDelete` clause** on its `dish` relation, matching this schema's
  established "zero `onDelete` anywhere, clean up explicitly in application code" convention — this
  is what makes BE-005's `deleteDish` change required, not optional.
- No `@@unique([dishId, position])` — deliberate, see the TDD's "Cover and position convention" for
  why enforcing it would complicate the reorder swap for no real benefit at this app's scale.
  `@@index([dishId, position])` is present for query efficiency, not uniqueness.
- Position assignment (`currentMax + 1`) and no-renumbering-on-remove are behaviors of BE-008's
  actions, not the schema itself — nothing to encode here beyond the plain `Int` column.

**Definition of Done**
- `npx prisma generate` run immediately after the schema edit.
- `npx prisma db push` succeeds against the shared local dev DB, only after confirming no
  concurrent worktree still depends on `Dish.imageUrl` existing.
- `npx prisma db push` succeeds against `rosty_integrity_test` via an explicit env-var override
  (never by swapping `.env`/`.env.test`).
- `prisma db seed` is **not** run — `DishMedia` starts empty for every existing dish; no backfill
  exists or is needed.
- This fully completes before any application code referencing `DishMedia`/`MediaType` lands
  (BE-005, BE-008, BE-009, and everything in Phase 3 that follows them).

**Estimated Complexity**: Medium — the schema edit itself is small, but this is the first
destructive push in the project's history and needs real rollout care, not just a `prisma db push`.

---

## Phase 2: Core Logic

### BE-002 · `src/lib/storage/client.ts` `[UNCHANGED]`
**Category**: Backend · **Phase**: 2 · **Dependencies**: INFRA-001

The TDD states explicitly this file is untouched by any of the three scope changes —
`createPresignedUploadUrl`/`buildPublicUrl`, the `signableHeaders` content-type-spoofing fix, and
the 10-minute presign expiry all carry over verbatim. No action needed.

---

### BE-003 · Revise validation schemas (`src/lib/validation.ts`)
**Category**: Backend · **Phase**: 2 · **Dependencies**: None

Rename `imageUploadRequestSchema` → `mediaUploadRequestSchema`, widen its content-type allowlist to
include video, and gate video to `entityType:'dish'` only via `.refine()` (a plain `z.enum()` can't
express that conditional). Remove the `imageUrl: imageUrlField` line from all four of
`createDishSchema`/`updateDishSchema`/`createCustomerSchema`/`updateCustomerSchema`. Add three new
schemas: `updateProfilePhotoSchema`, `addDishMediaSchema`, `reorderDishMediaSchema`. `imageUrlField`
itself is unchanged and stays in use by `updateProfilePhotoSchema`.

**Technical Notes**
- The TDD gives the exact target shape verbatim (lines 297–368) — transcribe it, this is not a
  design task. `ALL_MEDIA_CONTENT_TYPES` = `IMAGE_CONTENT_TYPES` (`jpeg`/`png`/`webp`, unchanged) +
  `DISH_VIDEO_CONTENT_TYPES` (`video/mp4`/`video/webm`/`video/quicktime`).
- The `.refine()` on `mediaUploadRequestSchema` is the actual server-side enforcement that a
  customer upload can never be video — the client's `accept=` attribute (FE-001) is only ever a UX
  hint, not a real gate.

**Definition of Done**
- `mediaUploadRequestSchema` rejects any of the three video content types when `entityType:'customer'`,
  and accepts them when `entityType:'dish'`.
- `createDishSchema`/`updateDishSchema`/`createCustomerSchema`/`updateCustomerSchema` no longer
  declare or accept an `imageUrl` field at all.
- `addDishMediaSchema` requires `dishId`/`url`/`type`; `reorderDishMediaSchema` requires
  `dishId`/`mediaId`/`direction`.

**Estimated Complexity**: Medium

---

### BE-004 · `getMediaUploadUrl` Server Action (`src/lib/storage/actions.ts`)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-002, BE-003

Rename from `getImageUploadUrl`. The auth gate becomes `entityType`-conditional:
`requireAdmin()` for `entityType:'dish'`, `getCurrentDbUser()`-only (any signed-in user, no role
check) for `entityType:'customer'`. Extend `EXTENSION_BY_CONTENT_TYPE` with the three video types.

**Technical Notes**
- **This auth-gate change is the one fix the TDD flags as load-bearing, not stylistic.** The
  original unconditional `requireAdmin()` would make customer self-service impossible outright — a
  logged-in customer's own upload attempt would hit `AuthError` before ever reaching MinIO. Don't
  treat this as a rename-only diff.
- Row-level authorization ("can this caller write to *this* `User.id`") deliberately does **not**
  live here — this action stays fully decoupled from any specific row, same as before. That check
  lives entirely in `updateProfilePhoto` (BE-007), which always writes the caller's own resolved
  `id`, never a client-supplied one.
- Still does not touch Prisma at all — same accepted orphaned-object tradeoff as before.

**Definition of Done**
- `entityType:'dish'` calls throw/propagate `AuthError` when the caller isn't an admin.
- `entityType:'customer'` succeeds for any authenticated user (not just the admin) and fails with a
  `VALIDATION` `ActionResult` (not a thrown error) when `getCurrentDbUser()` resolves `null`.
- `entityType:'customer'` + a video content type is rejected by the schema's `.refine()`, not
  silently accepted.

**Estimated Complexity**: Medium

---

### BE-005 · Revise `src/app/admin/menu/actions.ts` (imageUrl removal + required `deleteDish` fix)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-003

**Reverses the old BE-005's "add imageUrl" half**, and adds one new required line the old task
never anticipated. Two independent changes to the same file, landed together:
1. Remove `imageUrl` from `createDish`/`updateDish`'s TS parameter types, zod validation, and the
   `tx.dish.create`/`tx.dish.update` `data` objects. Both functions keep their existing
   `ActionResult<Dish>` + zod + try/catch shape from the original migration — only the `imageUrl`
   line is deleted, nothing else about that migration is undone.
2. Add `tx.dishMedia.deleteMany({ where: { dishId: id } })` to `deleteDish`'s transaction, before
   `tx.dish.delete`.

**Technical Notes**
- `deleteDish`'s new line is **required, not optional**: `DishMedia.dish` has no `onDelete` clause
  (RESTRICT), so hard-deleting a dish with any attached media and zero order history now throws an
  unhandled `P2003` without it — a real regression versus today's working delete flow, not an
  enhancement.
- `deleteDish` stays otherwise on its bare-throw/non-`ActionResult` shape — not migrated in this
  pass (see Open Questions).
- `toggleDishActive` is completely untouched — do not modify it while in this file.
- The bucket objects a deleted `DishMedia` row pointed at are **not** removed from MinIO — same
  permanent, uniform no-cleanup policy as everywhere else in this feature.

**Definition of Done**
- `createDish`/`updateDish` no longer accept or persist `imageUrl` in any form.
- Deleting a dish with attached `DishMedia` rows and zero `OrderDish` references succeeds and
  removes both the `Dish` and its `DishMedia` rows, with no `P2003`.
- `getDishes`/`toggleDishActive` are otherwise byte-for-byte unchanged.

**Estimated Complexity**: Medium

---

### BE-006 · Revise `src/app/admin/customers/actions.ts` (remove `imageUrl`)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-003

**Reverses the old BE-006.** Remove `imageUrl` from `createCustomer`/`updateCustomer`'s TS
parameter types and from the corresponding `prisma.user.create`/`prisma.user.update` calls. The
admin can no longer set, change, or clear a customer's photo through either action.

**Technical Notes**
- `User.imageUrl` the column stays exactly as it is (BE-001 doesn't touch `User`) — only these two
  actions' ability to write it is removed. The customer's own `updateProfilePhoto` (BE-007) becomes
  the column's sole writer going forward.
- No change to either function's existing write-once email/phone behavior.

**Definition of Done**
- Neither `createCustomer` nor `updateCustomer` accepts or persists `imageUrl` in any form.
- `getCustomers()` is unaffected — the read-only customer-table thumbnail column (FE-007) still
  reads `user.imageUrl` directly off row data, unrelated to these two write paths.

**Estimated Complexity**: Low

---

### BE-007 · `updateProfilePhoto` Server Action (`src/app/dashboard/actions.ts`)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-003

New export added to the existing file, alongside `requestAddEmail`/`verifyAddEmail`/
`requestAddPhone`/`verifyAddPhone`/`updateNotificationPreferences`. Writes `imageUrl` to the
*caller's own* `User.id`, resolved via `getCurrentDbUser()` — never a client-supplied id.

**Technical Notes**
- No OTP/verification step, unlike the email/phone flows in the same file — a photo doesn't
  establish identity or become a delivery destination, so there's nothing to prove ownership of.
  No uniqueness constraint to collide with either.
- The `where: { id: user.id }` clause on the `prisma.user.update` call is the entire authorization
  model for this action — mirrors `verifyAddContact`'s own `channel.applyValue(user.id, value)`
  immediately above it in the same file.
- Accepts an explicit `null` to clear an existing photo (same `.nullish()` reasoning as
  `imageUrlField` elsewhere in this codebase).

**Definition of Done**
- Returns `{ ok: false, code: 'VALIDATION' }` when `getCurrentDbUser()` resolves `null`, never a
  thrown error.
- The `prisma.user.update` call's `where` clause always uses the resolved `user.id`, never any
  value derived from the function's own input.
- `revalidatePath('/dashboard')` is called on success.

**Estimated Complexity**: Low

---

### BE-008 · New `src/app/admin/menu/[id]/actions.ts` (`addDishMedia`, `removeDishMedia`, `reorderDishMedia`)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001, BE-003

New file, three related actions sharing one position-management convention. The TDD gives full
implementations verbatim — transcribe, don't redesign.
- `addDishMedia`: inside a transaction, reads `currentMax` position for the dish (`aggregate`),
  inserts a new `DishMedia` row at `currentMax + 1` (or `0` if none exist yet).
- `removeDishMedia`: deletes the row by id, returns `{ dishId }`. **No renumbering** of remaining
  positions — see BE-001's Technical Notes for why that's intentional, not a gap.
- `reorderDishMedia`: swaps two adjacent items' `position` values in one transaction; a boundary
  request (already first/last) is a no-op `ok:true` response, not an error.

**Technical Notes**
- `revalidatePath('/admin/menu')` is called from `addDishMedia`/`removeDishMedia` (not
  `reorderDishMedia`) — because the gallery card's cover (lowest-position **image**) can change on
  add/remove but reordering internal-only positions among non-cover items never changes what the
  list page shows without also revisiting `/admin/menu/[id]`.
- `reorderDishMedia`'s boundary no-op is deliberate defense-in-depth against a stale render (the UI
  disables the button at each boundary) — not an expected everyday path, but must still return
  `ok:true`, not an error, since nothing actually went wrong.
- Concurrent `addDishMedia` calls on the same dish (two admin tabs) can race on `currentMax` and
  assign the same position to two rows — accepted as harmless, see TDD Edge Cases; nothing depends
  on position values being unique.

**Definition of Done**
- First `addDishMedia` call on a dish assigns `position: 0`; a second assigns `currentMax + 1`.
- `removeDishMedia` on a non-existent id returns a `NOT_FOUND` `ActionResult` (via the existing
  `toErrorResult` P2025 mapping), not a thrown error.
- `reorderDishMedia` correctly swaps positions for both `direction:'up'` and `direction:'down'`,
  and is a no-op at each boundary.

**Estimated Complexity**: Medium — the position/reorder logic is the most failure-prone part of
this file, even though each individual function is small.

---

### BE-009 · Widen `getDishes()`'s `include` (`src/app/admin/menu/actions.ts`)
**Category**: Backend · **Phase**: 2 · **Dependencies**: BE-001

Add `media: { orderBy: { position: 'asc' } }` as a sibling key to `getDishes()`'s existing
`include: { ingredients: { include: { inventoryItem: true } } }`.

**Technical Notes**
- **Required, easy to miss** — the gallery cards in `MenuClient.tsx` (FE-003) need each dish's
  `media` array to render a cover thumbnail; `getDishes()` is the single query that populates
  `initialData` for that screen.
- `getDishes()` also feeds `admin/orders/[id]/page.tsx` and `admin/orders/page.tsx`'s dish picker —
  both receive the extra `media` field on every returned `Dish` but never read it. This is
  harmless and additive; **do not modify either of those two files** as part of this task.
- `admin/menu/[id]/page.tsx`'s own direct `prisma.dish.findUnique` (FE-004) needs the identical
  include independently — it does not go through `getDishes()` at all, so it is not part of this
  task's scope.

**Definition of Done**
- Every `Dish` returned by `getDishes()` carries a `media` array ordered by `position` ascending.
- `admin/orders/[id]/page.tsx` and `admin/orders/page.tsx` are unmodified and still compile/pass
  their existing tests unchanged.

**Estimated Complexity**: Low

---

## Phase 3: Integration & UI

### FE-001 · Rename/extend `src/components/ui/image-upload.tsx` → `media-upload.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-004

`ImageUpload` → `MediaUpload`. Internal upload mechanics (generation-counter guard, instant
`URL.createObjectURL` preview, retry-with-fresh-presign, plain `<img>` never `next/image`) are
**unchanged** — restated in the TDD for completeness, not because they changed. What actually
changes:
- New `entityType`-keyed `MEDIA_CONFIG` lookup (`maxBytes`/`maxLabel`/`acceptedTypes`/`hint`) —
  customer stays 8MB/images-only, dish becomes 100MB/images+video, one combined cap covering both
  media types for a dish (not a second cap dimension per content type).
- `onChange` signature widens to `(url: string | null, contentType?: string) => void` — additive,
  not breaking for existing single-arg callers.
- One new video-specific behavior: even for a video file mid-upload, the preview tile always
  renders `<img>`-only internally (never attempts a `<video>` poster frame) — real video playback
  only ever happens on the finished dish detail gallery (FE-004), never inside this uploader.

**Technical Notes**
- The generation-counter guard matters more now, not less: a slow first upload resolving after a
  faster second one is just as possible in the detail page's repeatedly-remounted "add media" slot
  as it was in the original single-photo field.
- Retry re-runs against the already-selected file (kept in a ref) and requests a **fresh** presigned
  URL — this is now a more realistic path given a 100MB video against a 10-minute presign expiry
  (see TDD Edge Cases: needs >170KB/s sustained to finish inside the window).

**Definition of Done**
- `entityType="dish"` accepts a `.mp4`/`.webm`/`.mov` file selection (both `accept=` attribute and
  actual upload flow); `entityType="customer"` does not offer or accept any video type.
- A successful upload calls `onChange(publicUrl, file.type)`.
- Component compiles standalone with no dependency on `MenuClient`/`CustomerClient`/`DishDetailsClient`.

**Estimated Complexity**: High — the generation-counter race and the now-two-shape `MEDIA_CONFIG`
lookup are the most failure-prone part of this component.

---

### FE-002 · Extract `src/app/admin/menu/RecipeBuilder.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: None

Move `RecipeBuilder`, `optionsForRow`, `buildIngredients`, and `recipePayload` out of
`MenuClient.tsx` into this new shared file, unchanged in behavior — needed because both the
gallery's create modal (FE-003) and the new detail page's Details section (FE-004) now use them.

**Technical Notes**
- **One real signature change, not a pure move**: `buildIngredients` was a closure over
  `MenuClient`'s own `inventory` prop; as a shared export it takes `inventory` as an explicit fourth
  parameter — `buildIngredients(dishId, rows, fallbackDish, inventory)` — so both call sites can
  supply their own copy. `optionsForRow`'s signature is unchanged (`inventory` was already explicit
  there).
- The *why* behind each function (archived-ingredient reinjection in `optionsForRow`,
  duplicate-summing in `buildIngredients`) is unchanged — only the file and the one parameter list.

**Definition of Done**
- All four exports compile and are importable from `src/app/admin/menu/RecipeBuilder.tsx`.
- Every existing call site of `buildIngredients` is updated to pass `inventory` explicitly.

**Estimated Complexity**: Low

---

### FE-003 · Rewrite `MenuClient.tsx`: table → card gallery
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-001, FE-002, BE-005, BE-009

**Supersedes the old FE-002 and FE-004** — this is a full rewrite, not an incremental wire-up.
TanStack Table (`useReactTable`, column defs, `<table>` markup, `TablePagination`) is removed
entirely, replaced by a card grid. State removed: `newImageUrl`/`newImageStatus`/`editImageUrl`/
`editImageStatus`, the whole edit-dialog block (`Dialog open={!!editingDish}`). State kept: `data`,
`globalFilter`, `newRecipe`, `deletingDish`/delete `AlertDialog`.

Each card renders a cover thumbnail, name (highlighted), price, serving size, active/archived
badge, and three actions: Edit (now a `<Link href="/admin/menu/{id}">`, not a dialog-opening click
handler), Archive/Restore (`toggleDishActive`, unchanged), Delete (same `AlertDialog` as before).
Search stays a plain `useMemo`-filtered array; sorting is dropped (no grid equivalent); pagination
becomes local `page` state + `.slice()`, not the existing `TablePagination` component (built around
a `Table` instance this screen no longer has). The create modal keeps name/price/servingSize +
`<RecipeBuilder>` (now imported from FE-002) and **loses the image field entirely** — a plain,
always-enabled `Save Dish` button, since there's no upload-in-progress state left on this screen.

**Technical Notes**
- **Cover selection for the card thumbnail is IMAGE-only**, even though "cover" for ordering
  purposes elsewhere (FE-004) is type-agnostic: `dish.media.find(m => m.type === 'IMAGE')?.url` —
  the lowest-position **image**, not simply `dish.media[0]`. A dish whose only media is a video
  shows the same `UtensilsCrossed` placeholder as a dish with no media, plus a small film-icon badge
  overlay so the admin knows video content exists without a fake thumbnail.
- `handleAdd` drops the `imageUrl: newImageUrl` line from its `createDish(...)` call and the
  `setNewImageUrl(null)`/`setNewImageStatus('idle')` resets after success.
- `admin/menu/page.tsx` (the Server Component) needs **no changes** — it already calls `getDishes()`
  and passes `initialData`; BE-009's include widening is enough for the card grid to render covers.

**Definition of Done**
- No `<table>`/`useReactTable`/`TablePagination` remains anywhere in this file.
- A dish with an image-type media item shows it as the card cover; a dish with only video media
  shows the placeholder + film badge; a dish with no media shows the plain placeholder.
- The create modal renders no `<MediaUpload>`/`<ImageUpload>` at all.
- Edit navigates via `<Link>`, never opens a dialog.

**Estimated Complexity**: High

---

### FE-004 · New route `src/app/admin/menu/[id]/page.tsx` + `DishDetailsClient.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-001, FE-002, BE-005, BE-008

New Server Component mirroring `admin/orders/[id]/page.tsx`'s confirmed shape exactly (`params:
Promise<{ id: string }>`, `await props.params`, direct `prisma.dish.findUnique` with
`include: { ingredients: {...}, media: { orderBy: { position: 'asc' } } }`, `notFound()` if
missing, props down to a Client component). `DishDetailsClient.tsx` has two sections:
- **Details**: name/price/servingSize + `<RecipeBuilder>` (from FE-002), saved via
  `<form action={handleSave}>` calling `updateDish` — a straight relocation of the old edit
  dialog's fields onto a full page, no new logic.
- **Photos & Video**: a grid of `media` sorted by `position`, `<img>` for `type:'IMAGE'` /
  `<video controls className="h-full w-full object-cover">` for `type:'VIDEO'` (no player
  library — same restraint as this repo's "no `next/image`" convention), move-left/move-right
  buttons (disabled at each boundary) calling `reorderDishMedia`, a Remove ("×") button calling
  `removeDishMedia` with **no confirmation dialog** (low-stakes, reversible — unlike whole-dish
  delete), and an "Add media" slot rendering `<MediaUpload entityType="dish" .../>`.

**Technical Notes**
- **Remount-to-reset mechanism, concrete and specific**: `const [mediaUploadKey, setMediaUploadKey]
  = useState(0)`, rendered as `<MediaUpload key={mediaUploadKey} .../>`. On a successful add,
  `handleMediaUploaded` calls `addDishMedia`, appends the result to local `media` state, then
  increments `mediaUploadKey` to remount the uploader with fresh internal state. This reuses the
  exact remount-to-reset technique this codebase already established for `CustomerFormFields`
  (`key={isOpen ? 'add-open' : 'add-closed'}`), not a new pattern.
- `type` (`IMAGE`/`VIDEO`) is derived from the browser-reported `contentType` and trusted as-is —
  `contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE'` — never verified against actual bytes.
  Worst case of a mismatch is a broken/unplayable tile, a cosmetic failure, not a security one.
- `handleMediaUploaded` returns early (no-op) if `MediaUpload`'s `onChange(null)` fires — this
  always-empty "add" slot has no meaningful use for an explicit-clear signal.

**Definition of Done**
- `/admin/menu/[id]` for a non-existent id renders Next's `notFound()` page.
- Details section saves via `updateDish` exactly as the old edit dialog did (same
  `optionsForRow`/`buildIngredients` archived-ingredient reinjection behavior).
- A successful media add appends a new tile and visibly resets the "add media" slot to its empty
  state (no lingering preview/status from the just-completed upload).
- Move-left/move-right are disabled at the first/last position respectively.

**Estimated Complexity**: High

---

### FE-005 · Strip image-upload state from `CustomerClient.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-006

**Reverses the old FE-003.** `CustomerFormFields` loses its `imageUrl`/`onImageChange`/
`onImageStatusChange` props and its `<ImageUpload>`/`<MediaUpload>` render — back to exactly
`{ customer, idPrefix }` only, its pre-feature shape. `CustomerClient` itself loses
`newImageUrl`/`newImageStatus`/`editImageUrl`/`editImageStatus` state and `openEdit`'s
`setEditImageUrl(...)`/`setEditImageStatus(...)` lines (currently at lines ~198–203 of the current
file). `handleAdd`/`handleEdit` drop `imageUrl: newImageUrl`/`imageUrl: editImageUrl` from their
`createCustomer`/`updateCustomer` calls (currently lines ~378, ~400). Both Save buttons go back to
unconditionally enabled — nothing left on this form can be `'uploading'`.

**Technical Notes**
- **The read-only thumbnail/avatar column is completely untouched** — see FE-007. It reads
  `customer.imageUrl` off row data, never `MediaUpload`/`ImageUpload`, and this task must not
  touch the `columnHelper.display({ id: 'thumbnail', ... })` block.

**Definition of Done**
- `CustomerFormFields` accepts no image-related props at all.
- Neither Save button is ever `disabled` due to upload status.
- `createCustomer`/`updateCustomer` calls from this file never include an `imageUrl` key.

**Estimated Complexity**: Low

---

### FE-006 · New `src/app/dashboard/ProfilePhoto.tsx` + wire into `dashboard/page.tsx`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: FE-001, BE-007

New `"use client"` component, same file-per-section convention as `AddContactForm.tsx`/
`NotificationPreferences.tsx` in the same directory. Unlike `MenuClient`/`CustomerClient`'s
original pattern (merge into a bigger form's save payload), there is no surrounding form here — a
photo is the widget's entire content, so a successful `MediaUpload` `onChange` immediately calls
`updateProfilePhoto` rather than waiting for a Save click with nothing else to batch with.
`dashboard/page.tsx` renders `<ProfilePhoto initialImageUrl={customer.imageUrl} />`
**unconditionally**, placed above the conditional `{missingChannel && <AddContactForm .../>}`
block — `customer` is already in scope from the existing `getCurrentDbUser()` call, no new query
needed.

**Technical Notes**
- Deliberately **not** gated behind any "missing" condition the way `AddContactForm` is — a photo
  is always optional and always changeable, never a one-time fill-in-the-blank.
- Local state: `imageUrl` (optimistic, set immediately from `MediaUpload`'s own preview),
  `isSaving`, `error`. The TDD gives the full implementation verbatim (lines 796–836) —
  transcribe, don't redesign.

**Definition of Done**
- Renders an empty "Add a photo" state when `initialImageUrl` is `null`, a "Change photo"
  affordance when set.
- A successful upload persists via `updateProfilePhoto` immediately, no separate Save button.
- A failed `updateProfilePhoto` call shows an inline error without crashing the component.

**Estimated Complexity**: Medium

---

### FE-007 · `CustomerClient.tsx` thumbnail/avatar column `[UNCHANGED]`
**Category**: Frontend · **Phase**: 3 · **Dependencies**: None

**Was FE-005 in the prior task list; renumbered only, not redone.** The TDD states explicitly this
column is "completely untouched" — it reads `customer.imageUrl` off row data and has nothing to do
with `MediaUpload`/`ImageUpload`. No action needed; do not modify the
`columnHelper.display({ id: 'thumbnail', ... })` block in `CustomerClient.tsx` as part of this
revision.

---

## Phase 4: Testing & Polish

### TEST-001 · `src/lib/storage/client.test.ts` `[UNCHANGED]`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-002

`client.ts` itself did not change, so this file's coverage (`buildPublicUrl`'s two endpoint cases,
`createPresignedUploadUrl`'s `signableHeaders` assertion) stays exactly as originally specified. No
action needed.

---

### TEST-002 · Rename/extend `src/lib/storage/actions.test.ts` → covers `getMediaUploadUrl`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-004

Keeps its original cases (invalid `contentType`/`entityType` → `VALIDATION`, valid input →
`{uploadUrl, publicUrl}`, `entityType:'dish'` rejects when `requireAdmin()` throws) and adds:

**Definition of Done**
- **New**: `entityType:'customer'` rejects with `VALIDATION` when `getCurrentDbUser()` resolves
  `null` — this is the test that would have caught the "customer self-service impossible with an
  unconditional `requireAdmin()`" bug if it had shipped unfixed.
- **New**: `entityType:'dish'` accepts `video/mp4`/`video/webm`/`video/quicktime`.
- **New, the single most important assertion in this file** per the TDD: `entityType:'customer'`
  REJECTS all three video content types with `VALIDATION`, even though they're in the base
  allowlist for dish — the only thing that actually proves the schema's `.refine()` gate works.

**Estimated Complexity**: Low

---

### TEST-003 · Rename/extend `src/components/ui/image-upload.test.tsx` → `media-upload.test.tsx`
**Category**: Testing · **Phase**: 4 · **Dependencies**: FE-001

Keeps every original case (instant preview, uploading status, success calls `onChange`, failure
shows error and does not call `onChange`, and **the stale-generation race** — still the single
most important case in this file, worth flagging by name so it doesn't get silently dropped).

**Definition of Done**
- **New**: `entityType="dish"` accepts a `.mp4` file selection (`accept` attribute includes
  `video/mp4`, no size-cap rejection at a size well under 100MB).
- **New**: `entityType="customer"` rejects the same file size a `entityType="dish"` upload would
  accept, against the *customer* 8MB cap — proves `MEDIA_CONFIG`'s per-entityType lookup is
  actually wired to the right instance, not a global constant.
- **New**: `onChange` is asserted directly with `(url, contentType)`, the widened 2-arg signature,
  on a successful upload — not merely assumed from the 1-arg cases above.

**Estimated Complexity**: Medium — the stale-generation race requires controlling promise
resolution order deliberately (deferred promises), not just `mockResolvedValue`.

---

### TEST-004 · Revise `src/app/admin/menu/actions.test.ts`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-005

Existing file, revised, not net-new (it already covers `createDish`/`updateDish`'s validation
paths from the original migration). The six `imageUrl`-round-tripping cases from the original
scope are **removed outright** — that field no longer exists on `Dish` at all.

**Definition of Done**
- No test in this file references `imageUrl` on `Dish` in any form.
- `deleteDish`'s existing test gains a new case: deleting a dish with attached `DishMedia` rows and
  zero `OrderDish` references succeeds and removes both the `Dish` and its `DishMedia` rows — this
  is the test that would have caught a missing `tx.dishMedia.deleteMany` line as an unhandled
  `P2003`.
- Negative price and empty name still return `VALIDATION` `ActionResult`s, unchanged from the
  original migration's coverage.

**Estimated Complexity**: Low

---

### TEST-005 · New `src/app/admin/menu/[id]/actions.test.ts`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-008

**Definition of Done**
- `addDishMedia`: first item on a dish gets `position: 0`; a second gets `currentMax + 1` (mocking
  the `aggregate` call); rejects when `requireAdmin()` throws.
- `removeDishMedia`: deletes the row, returns `{dishId}`, rejects `NOT_FOUND` (P2025) cleanly.
- `reorderDishMedia`: swaps two adjacent items' positions correctly for both `'up'` and `'down'`;
  is a no-op (`ok:true`, unchanged list) at each boundary; rejects `NOT_FOUND` when `mediaId`
  doesn't match any item in `dishId`'s list.

**Estimated Complexity**: Medium

---

### TEST-006 · Extend `src/app/dashboard/actions.test.ts` for `updateProfilePhoto`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-007

**Definition of Done**
- Rejects `VALIDATION` when `getCurrentDbUser()` resolves `null`.
- **Asserts the `prisma.user.update` mock's `where` clause directly** against `getCurrentDbUser()`'s
  own `user.id`, never a hypothetical second id — this is the test that proves the "own row only"
  authorization claim, not just that the action returns `ok:true`.
- Accepts an explicit `null` to clear an existing photo (mirrors `updateCustomer`'s existing
  clearing-semantics test).

**Estimated Complexity**: Low

---

### TEST-007 · New `src/app/dashboard/ProfilePhoto.test.tsx`
**Category**: Testing · **Phase**: 4 · **Dependencies**: FE-006

**Definition of Done**
- Renders the empty/idle state when `initialImageUrl` is `null`.
- A successful `MediaUpload` `onChange` calls `updateProfilePhoto` and shows a "Saving…" indicator,
  then clears it.
- A failed `updateProfilePhoto` call shows an inline error without crashing (mirrors this
  directory's existing error-path shape, e.g. `AddContactForm.test.tsx`, if one exists there).

**Estimated Complexity**: Low

---

### TEST-008 · Rewrite `src/app/admin/menu/MenuClient.test.tsx`
**Category**: Testing · **Phase**: 4 · **Dependencies**: FE-003

**Substantially rewritten, not incrementally extended** — the underlying component changed from a
table to a card grid, so most of the original file's `getByRole('row', ...)`/column-header
assertions have no equivalent target anymore. **Supersedes the `MenuClient` half of the old
TEST-008** (the `CustomerClient` half of that old task is unaffected — see TEST-010).

**Definition of Done**
- Card rendering: name/price/servingSize/cover-or-placeholder/status badge.
- Search filters the grid correctly.
- Create modal fields: name/price/servingSize/recipe, **and an assertion that `<MediaUpload>` is
  NOT rendered inside this modal** — a meaningful regression guard now that its absence is
  intentional, not incidental.
- Edit renders a `<Link href="/admin/menu/{id}">` rather than opening a dialog.
- Archive/restore and delete-with-archive-fallback: same assertions as before, now against card
  markup instead of row markup.

**Estimated Complexity**: High

---

### TEST-009 · New `src/app/admin/menu/[id]/DishDetailsClient.test.tsx`
**Category**: Testing · **Phase**: 4 · **Dependencies**: FE-004

**Definition of Done**
- Details section: renders and saves name/price/servingSize/recipe via `updateDish`, reusing the
  same `RecipeBuilder`/`optionsForRow`-archived-ingredient-reinjection assertions the original
  `MenuClient.test.tsx` had for its edit dialog.
- Photos & Video: renders existing media in `position` order; `<img>` for `IMAGE`, `<video
  controls>` for `VIDEO`; move-left/move-right calls `reorderDishMedia` and is disabled at each
  boundary; Remove calls `removeDishMedia` with **no** confirmation dialog (assert no `AlertDialog`
  appears, unlike dish deletion).
- A successful "add media" upload calls `addDishMedia` and the uploader slot visibly resets (assert
  the previous preview/status is gone after a successful add, not by reaching into the
  `mediaUploadKey` counter directly).

**Estimated Complexity**: Medium

---

### TEST-010 · Targeted revision of `src/app/admin/customers/CustomerClient.test.tsx`
**Category**: Testing · **Phase**: 4 · **Dependencies**: FE-005

**Targeted removal, not a rewrite** — most of this file is unaffected. Remove the create-dialog
assertion at line ~189 (`expect(mockCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({
name: 'New Customer', imageUrl: null }))`) and replace it with an assertion that the call does
**not** include an `imageUrl` key at all — a meaningful regression guard, since a stray
`imageUrl: null` silently reappearing would indicate the field crept back in.

**Definition of Done**
- The replaced assertion uses `expect.not.objectContaining({ imageUrl: expect.anything() })` or an
  equivalent explicit-shape check, not a simple deletion of the old assertion.
- **The `describe('CustomerClient — thumbnail/avatar column (FE-005)')` block (now FE-007) is left
  completely unchanged and must keep passing exactly as-is** — it reads `customer.imageUrl` off row
  data, never touches `MediaUpload`/`ImageUpload`, and this revision does not alter that column.

**Estimated Complexity**: Low

---

### TEST-011 · Revise `tests/integration/menu-dish-actions.integration.test.ts`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-001, BE-005, BE-008

**Supersedes the old TEST-005** (the `ActionResult` unwrap that task described already happened
under the original scope's implementation). This revision's actual work: remove the six
`imageUrl`-round-trip cases (persists/clears/leaves-untouched, on both `createDish` and
`updateDish`) — the field no longer exists. Add new coverage: `addDishMedia`/`removeDishMedia`/
`reorderDishMedia` round-tripping real `DishMedia` rows through Postgres (position assignment, the
no-renumbering-on-remove behavior, the reorder swap).

**Technical Notes**
- **Deliberately still does not exercise real MinIO** — `DishMedia.url` is an opaque string column
  to Postgres, same reasoning as the original `Dish.imageUrl` split (mocked unit tests own the
  storage layer, this Postgres-only suite owns persistence/relations).

**Definition of Done**
- No `imageUrl` assertions remain anywhere in this file's `createDish`/`updateDish` blocks.
- `deleteDish`/`toggleDishActive`/`getDishes` blocks are untouched — not part of this migration.
- New `DishMedia` CRUD cases cover position assignment, no-renumbering-on-remove, and the reorder
  swap, all against a real Postgres instance.

**Estimated Complexity**: Medium

---

### TEST-012 · Revise `tests/integration/customers-actions.integration.test.ts`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-006

**Reverses the old TEST-006.** Remove any `imageUrl` round-trip assertions added under the original
scope's `createCustomer`/`updateCustomer` tests — that field is no longer accepted by either
action. No replacement coverage is needed here; `updateProfilePhoto`'s own new integration coverage
(TEST-013) already exercises `User.imageUrl` end-to-end via the correct, now-only, write path.

**Definition of Done**
- No `createCustomer`/`updateCustomer` test in this file references `imageUrl`.

**Estimated Complexity**: Low

---

### TEST-013 · New integration coverage for `updateProfilePhoto`
**Category**: Testing · **Phase**: 4 · **Dependencies**: BE-007

New file (`tests/integration/dashboard-actions.integration.test.ts` — confirmed no existing
integration file covers `src/app/dashboard/actions.ts` today) or an extension if one is added by a
concurrently-landing feature by the time this is implemented.

**Definition of Done**
- A real customer row's `imageUrl` round-trips through Postgres via `updateProfilePhoto`, scoped
  correctly to `getCurrentDbUser()`'s resolved id.
- Explicit `null` clears an existing value.

**Estimated Complexity**: Low

---

### TEST-014 · Manual QA: video upload, HEIC check, customer self-service flow
**Category**: Testing · **Phase**: 4 · **Dependencies**: FE-003, FE-004, FE-006, INFRA-004

**Extends the old TEST-007** with two new checks the TDD names explicitly, on top of the original
"real file against local MinIO" and "iOS Safari/HEIC" checks (both still apply, unchanged):
1. **New**: a real short video file (mp4 from a phone, mov from an iPhone if available) uploads
   successfully against local MinIO and plays back via `<video controls>` on the dish detail page.
2. **New, first customer-facing manual check this feature has ever needed**: a full end-to-end pass
   of the dashboard self-service flow as a logged-in **customer**, not an admin — every prior
   manual QA step in this feature has been performed from the admin side.

**Definition of Done**
- All four checks (original two + two new) run against the real stack and their outcomes recorded.
- A failing HEIC check does not block ship (documented risk in the PRD) but must not go unrecorded.

**Estimated Complexity**: Low

---

## Proactively Suggested Tasks

### PROACTIVE-001 · Consider a lightweight rate limit on `getMediaUploadUrl`'s customer branch
**Category**: Backend · **Phase**: 4 (optional) · **Dependencies**: BE-004

Not requested by the PRD or specified by the TDD as required work — flagged because the TDD's own
Security Considerations section explicitly names the shift this revision makes: `getMediaUploadUrl`
goes from *admin-only* (a single, trusted caller) to reachable by **any authenticated customer**
for `entityType:'customer'`, with no server-side file-size cap and no request-rate limit of any
kind on this action. The TDD accepts this as low-risk given the customer-images-only 8MB cap and
explicitly does not propose a mitigation — this task is offered as a cheap, optional hardening step
for whoever reviews this before shipping the customer self-service change, not a required blocker.

**Definition of Done**
- A repeated-call guard (e.g. a simple per-user cooldown, mirroring the existing
  `requestAddContact` OTP cooldown pattern already in `dashboard/actions.ts`) on
  `entityType:'customer'` calls, OR an explicit decision recorded that this is accepted risk for v1
  (matching the TDD's existing "accepted, no server-side size cap" precedent).

**Estimated Complexity**: Low

---

### PROACTIVE-002 · `minio:up`/`minio:down` npm scripts + `AGENTS.md` Quick Start section
**Category**: Infrastructure · **Phase**: 4 (optional) · **Dependencies**: INFRA-002

**Was PROACTIVE-001 in the prior task list; renumbered only.** Confirmed still not done
(`package.json` has no `minio:up`/`minio:down` scripts as of this revision). Still "Recommended
(not required)" per the TDD's own Rollout Plan, unaffected by any of the three scope changes.

**Definition of Done**
- `"minio:up": "docker compose up -d"` / `"minio:down": "docker compose down"` added to
  `package.json` and run successfully.
- `AGENTS.md`'s Local Dev Quick Start documents the MinIO step as separate from `supabase:start`.

**Estimated Complexity**: Low

---

## Environment Variables Required

No new environment variables are introduced by this revision — the TDD confirms video content
types are handled entirely in application code (BE-003/BE-004), not infrastructure config. The six
variables below are unchanged from the original scope and already set in this worktree (INFRA-003).

| Variable | Description | Required | Example Value |
|---|---|---|---|
| `MINIO_ENDPOINT` | Browser- and server-reachable MinIO S3 API address. Baked into the presigned PUT URL's signature. | Required | `http://127.0.0.1:9000` |
| `MINIO_PUBLIC_ENDPOINT` | Override for the stable public URL stored in `DishMedia.url`/`User.imageUrl`. Falls back to `MINIO_ENDPOINT` if unset. | Optional | (blank for local dev) |
| `MINIO_ACCESS_KEY` | Server-only S3 credential. | Required | `minioadmin` |
| `MINIO_SECRET_KEY` | Server-only S3 credential. | Required | `minioadmin` |
| `MINIO_BUCKET` | Bucket name — must match the bucket `minio-init` creates. | Required | `chop-uploads` |
| `MINIO_REGION` | Required by the AWS SDK's constructor; MinIO itself ignores the value. | Required | `us-east-1` |

---

## Open Questions

No item below is flagged as blocking planning or implementation — this matches the TDD's own Open
Questions section, which resolves its one item that was previously flagged blocking-for-planning
(MinIO CORS preflight, confirmed via INFRA-004's live verification). Cross-referencing the TDD
against the real codebase during this planning pass did not surface any new blocking ambiguity.

**Product decisions, carried forward, not reopened by this revision:**
- **Customer photo privacy** — uploaded photos remain reachable by anyone with the exact object URL,
  indefinitely, with no revocation mechanism. Moving *who* uploads a customer's photo (admin →
  customer) does not touch this storage/access model at all. Still a real call for the business
  owner.
- **Realistic video size ceiling** — 100MB is a starting default, not researched against the
  admin's actual phone camera output. Cheap to retune later (a single constant in `MEDIA_CONFIG`).
- **Long-term unbounded bucket growth** — accepted tradeoff, now growing faster since video files
  are typically an order of magnitude larger than photos. Not a code task; flagged for whoever owns
  the product roadmap.

**Engineering/process decisions, genuinely open but not blocking:**
- **Whether `toggleDishActive` (and now `deleteDish`, partially) staying on the old bare-throw
  pattern remains acceptable indefinitely.** `admin/menu/actions.ts` now has three actions in a
  mixed state: `createDish`/`updateDish` on `ActionResult`, `toggleDishActive` fully old-pattern,
  `deleteDish` old-pattern-plus-one-required-new-line (BE-005). Worth a decision before a fourth
  change touches this file again, per the TDD's own framing.
- **Production deployment topology** (reverse proxy/CDN, TLS, a managed S3-compatible alternative
  to self-hosted MinIO) — explicitly deferred by the PRD's Non-Goals; no task in this list covers it.
- **iOS Safari / HEIC re-encoding** — still unverified on a real device; TEST-014 covers checking
  it, but a failing result does not block ship per the PRD's own accepted-risk framing.

No conflict was found between the PRD and TDD on any point covered by this revision.
