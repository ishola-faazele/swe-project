# PRD: Dish & Customer Photo Uploads (MinIO)

## Status
Draft (revised — scope expanded before initial implementation was committed)

**Revision note**: this PRD originally shipped as admin-only single-photo uploads for both Dish
and Customer, built end-to-end against a real MinIO stack (0 tsc errors, 469 unit + 141
integration tests, clean build) but never committed. Before that work landed, the project owner
requested three scope changes: (1) customer photos move from admin-set to customer
self-service, (2) the admin dish table is replaced with a real visual display, (3) a dish gains
support for multiple photos AND video, replacing its single `imageUrl`. This revision reflects
that new scope. Everything about the underlying MinIO/presigned-upload mechanism — how a file
gets from a browser to the bucket — is unchanged; what changed is who is allowed to trigger an
upload for which entity, and what happens to the resulting URL once one succeeds.

## Problem Statement
The admin (the business owner, working the kitchen queue mostly from her phone) manages the Dish
menu as a plain data table and Customer records as text-only rows. Two gaps remain even after
photo support first landed: (1) a dish can carry only one static photo, browsable solely as a
tiny thumbnail in a table row — the admin has said outright that displaying dishes in a table "is
really bad" for a visual menu, and there's no way to show a short plating or prep video at all;
(2) only the admin can ever attach a customer's photo, even though the customer herself is best
positioned to keep her own photo current, and every other piece of her own contact information
(email, phone) already has a self-service path she can use once logged in — her photo is the odd
one out.

## Goals
- Admin can browse the menu as a visual card gallery instead of a table, with a dedicated detail
  page per dish for full media management (multiple photos and/or a short video) and recipe
  editing. **We will know this is successful when** `/admin/menu` renders a card grid, not a
  `<table>`, and `/admin/menu/[id]` supports adding, reordering, and removing media — verified
  against the running app.
- A dish can carry an unlimited, ordered set of photos and/or videos, with the lowest-ordered item
  shown as its cover everywhere a single compact thumbnail is needed (the gallery card).
  **We will know this is successful when** a dish with 3+ media items renders in the correct order
  on its detail page, and the gallery card always shows exactly one, correctly-chosen cover.
- A dish photo or video upload still begins the instant a file is picked, and adding a new media
  item is its own independent, immediately-persisted action — never bundled into a bigger
  "save everything" form the way the original single-photo field was. **We will know this is
  successful when** adding a second or third media item to an already-saved dish never requires
  touching or re-submitting that dish's name, price, or recipe.
- Customers can set, change, or remove their own profile photo at any time from `/dashboard`,
  without asking the admin — closing the admin-only bottleneck from the original release.
  **We will know this is successful when** a logged-in customer can upload, replace, and remove
  their own photo entirely from their own dashboard, with zero admin action required, verified by
  an automated test covering the full flow.
- Within 30 days of shipping, a meaningful share of active dishes carry at least one media item,
  and customer photo adoption continues growing under self-service. **We will know this is
  successful when** `DishMedia` rows exist for a growing share of active dishes, and the count of
  customers with a non-null `imageUrl` keeps growing after launch — necessarily entirely
  self-attributed, since the admin-side write path to a customer's photo no longer exists after
  this change (see Non-Goals).

## Non-Goals
- **Cleaning up orphaned bucket objects is explicitly out of scope, permanently, not just for
  v1.** Applies uniformly to every media type this feature ever creates: an abandoned dish-media
  upload, a removed `DishMedia` item, and a replaced customer photo all leave their bucket object
  behind forever. No cleanup job, garbage collector, or delete-on-cancel/delete-on-remove logic
  will be built for this. This is an accepted, intentional tradeoff — do not treat it as a bug to
  fix later.
- No image OR video editing: no cropping, resizing, rotation, client-side compression,
  transcoding, or thumbnail/poster-frame generation. The file the admin (or, for a customer photo,
  the customer) picks is the exact file that gets stored and served, as-is. This extends the
  original "no image editing" non-goal to explicitly cover video too, now that video is in scope.
- **No admin-side photo upload for customers, by design.** The admin retains read-only visibility
  of a customer's photo (the existing avatar column on the Customer table), but can no longer set,
  change, or clear it — that control now belongs entirely to the customer's own dashboard. A
  future request to restore admin write access to a customer's photo would be a reversal of this
  decision, not a bug fix.
- No content moderation or approval workflow for customer-uploaded photos. A customer's new photo
  takes effect immediately with no admin review step, matching this app's existing trust posture
  toward its own registered customers (there is no content-moderation mechanism anywhere else in
  this app either).
- No reusable, entity-agnostic "media library" for other record types (e.g. Inventory items,
  Orders). Dish now has a real one-to-many media model and Customer has a self-service single
  photo, but both remain purpose-built to their own screen — there is still no generic "attach
  media to any record" capability, and none is planned.
- No drag-and-drop for reordering a dish's media. Reordering uses simple move-left/move-right
  controls, not a drag interaction — see the TDD for why.
- No server-side enforcement of a maximum file size, for images or video. The upload UI advises a
  size cap client-side (8MB for a photo, a larger default for a dish video); nothing stops a
  hand-crafted request from exceeding it. Accepted given this upload surface's threat model — see
  the TDD's Security Considerations for the customer-self-service nuance this revision adds.
- MinIO is **not** integrated into the existing Supabase-CLI-managed local dev flow. It ships as a
  fully separate, standalone `docker-compose.yml` with its own lifecycle (`docker compose up`/
  `down`), independent of `supabase start`/`stop`.
- No production deployment topology (reverse proxy in front of MinIO, TLS, a managed
  S3-compatible alternative to self-hosted MinIO) is decided here. This PRD and its companion TDD
  cover local development only; production rollout is explicitly deferred to a future pass.

## User Stories
- As the admin, I want to browse dishes as a visual gallery instead of a table, so the menu is
  actually recognizable at a glance instead of a row of tiny 36px thumbnails.
- As the admin, I want to attach multiple photos and, optionally, a short video to a dish from its
  own detail page, so I can show a plated shot, an ingredients shot, and a quick prep clip on one
  dish — not just a single static photo.
- As the admin, I want to reorder or remove a dish's photos/video, so I control which shot shows up
  first as the dish's "cover" without having to re-upload anything.
- As the admin, I want the recipe/ingredient editor I already rely on to keep working exactly the
  same, just relocated to the dish's detail page, so this redesign doesn't cost me any existing
  capability.
- As the customer, I want to add, change, or remove my own profile photo any time from my
  dashboard, so I don't have to ask the business owner to do it for me — the same way I can
  already add a missing email or phone number myself.
- As the admin, I want to still see each customer's photo in the customer table for recognition,
  even though I can no longer set it myself, so losing write access doesn't cost me the
  at-a-glance recognition the photo already gives me.
- As the admin, I want to still be able to save a new dish, or edit an existing one's price/recipe,
  without ever being blocked by an in-progress photo or video upload happening elsewhere on the
  page, so a slow video upload never holds up an unrelated edit.

## Success Metrics
- 30-day dish-media coverage: `count(distinct Dish with >=1 DishMedia row) / count(Dish WHERE
  isActive)`, trending upward from the original single-photo-only baseline.
- 30-day customer self-service adoption: count of `User WHERE role = 'CUSTOMER' AND imageUrl IS
  NOT NULL`, trending upward — necessarily 100% self-attributed post-launch, since the admin-side
  write path to `imageUrl` no longer exists (a clean, unambiguous adoption signal with no need to
  separately track "who set this").
- Zero unhandled-crash reports tied to any upload flow (dish media or customer self-service) in the
  first two weeks — the existing toast/inline-error surfaces are expected to catch every failure
  mode instead.
- Zero admin-reported "I can't add a customer's photo anymore" confusion tickets in the first two
  weeks. This is a genuine capability change for the admin (not just an addition), so it's worth
  tracking on its own rather than assuming the retained read-only avatar column fully offsets it.

## UX/Flow Summary

### 1. Admin: menu gallery → dish detail page
1. `/admin/menu` now renders a card grid, one card per dish: cover photo (or a placeholder icon if
   the dish has no photo-type media yet), name, price, serving size, and an active/archived
   badge. Search still filters the grid by name; sorting-by-column is dropped, since it doesn't
   translate to a card layout.
2. "Add Dish" opens a **lightweight** create modal — name, price, serving size, and the existing
   recipe/ingredient builder. It deliberately has **no photo/video field**: a `DishMedia` row
   requires a `dishId` to attach to, and a dish doesn't have one until after this first save. On
   success, the new dish appears on the grid immediately (with a placeholder cover) and the admin
   is free to open it and add media whenever she's ready — there is no forced "now add a photo"
   interstitial.
3. Clicking a card (or its Edit action) navigates to `/admin/menu/[id]` — no more edit modal.
   This page has two sections: **Details** (name/price/serving size, plus the same recipe
   builder from the create modal, saved via the same "Save" action) and **Photos & Video** (the
   dish's media gallery).
4. In Photos & Video, an "Add media" picker works exactly like the original release's Instagram
   flow — upload starts the instant a file is picked, with an instant preview and a visible
   "uploading…" state — except each successful upload is its own standalone action: it
   immediately appears as a new tile in the gallery, with no separate "Save" step to remember.
   Each tile has move-left/move-right controls and a "Remove" action. The lowest-ordered item is
   the dish's cover, shown on its gallery card.
5. Archive/restore and delete-with-archive-fallback work exactly as before, available as quick
   actions on each gallery card.

### 2. Customer: self-service photo from the dashboard
1. `/dashboard` unconditionally shows a "Your photo" section (not gated behind any "missing"
   condition the way the email/phone prompt is — a photo is always optional and always
   changeable, never a one-time fill-in-the-blank).
2. If no photo is set, it shows an empty picker with an "Add a photo" prompt. If one is set, it
   shows the current photo with a "Change photo" affordance.
3. Picking a new file behaves exactly like the original Instagram flow: instant preview, upload
   starts immediately, and — because there's no surrounding "save the rest of the form" step for
   a standalone photo — a successful upload is saved to the customer's own account right away, no
   separate Save button to click.
4. The customer can remove their photo at any time the same way; doing so clears it from their
   account immediately.
5. The admin's Customer table still shows this photo in its existing read-only avatar column — the
   admin sees the result, but never edits it from her side.

## Open Questions
- **Customer photo privacy — carried forward, not reopened by this revision.** This was flagged
  as an open product/privacy question in the original release (uploaded photos are reachable by
  anyone with the exact object URL, indefinitely, with no revocation mechanism) and remains
  exactly as open as before. Moving *who* uploads a customer's photo from the admin to the
  customer themselves does not change the storage/access model at all — the same public-by-key
  bucket design applies either way — so this isn't re-litigated here; it's still a real call for
  the business owner, not something this revision resolves or needs to resolve.
- **Realistic size ceilings, now for two different media types**: the 8MB photo cap is unchanged
  and already covered by the original release. The TDD proposes a 100MB cap for dish video as a
  starting default, not a researched requirement — is that generous enough for a real short
  prep/plating clip on the admin's phone, or should it be smaller (faster, safer uploads) or
  larger (less risk of an annoyingly-clipped clip)?
- **Long-term storage growth, now growing faster.** The accepted no-cleanup-of-orphans tradeoff
  from the original release still stands and now applies to every `DishMedia` row too — and video
  files are typically an order of magnitude larger than photos, so unbounded bucket growth
  accelerates materially versus the photo-only baseline. Still not a concern at today's scale, but
  worth flagging again now that the growth rate itself has changed, not just the tradeoff's scope.
