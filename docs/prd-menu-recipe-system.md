# PRD: Menu & Recipe System

## Status
Draft

## Problem Statement
Rosty (the business owner) cannot save a dish once and reuse it. Every single order today requires
her to re-type a free-text description, manually re-pick every raw ingredient one at a time from a
dropdown, and hand-type a total price from memory — even for dishes she sells dozens of times a
week (Jollof Rice, Meat Pies, Waakye). This is slower than a paper notebook for a repeat order, and
it silently defeats the one thing the inventory system exists to guarantee: accurate stock. If she
forgets one ingredient while re-picking a recipe from memory mid-shift, the deduction is wrong and
`currentStock` quietly drifts from reality.

## Goals
- **Faster repeat-order entry.** We will know this is successful when 80%+ of new orders within 30
  days of launch are created using at least one catalog dish, instead of the current 100% fully
  freeform / hand-picked-ingredient flow (measurable directly from `Order`/`OrderDish` data already
  in the database — no new instrumentation required).
- **Deduction accuracy no longer depends on memory.** We will know this is successful when 100% of
  dish-based orders auto-generate their full ingredient deduction from the recipe, with zero
  manually re-typed ingredient rows required for a catalog dish (verifiable directly in code
  review/QA against the `createOrder` implementation).
- **Historical trustworthiness.** We will know this is successful when zero historical orders ever
  change their recorded `totalPrice` or ingredient deduction after the fact, even after a dish's
  price or recipe is edited later (verified via the price/recipe snapshotting design and a
  regression test asserting it).
- **Self-service catalog management.** We will know this is successful when the business owner can
  create, edit, and retire dishes and their recipes herself, without engineering help — target: she
  successfully adds at least 5 real dishes unassisted within the first week of launch.
- **Foundation, not a dead end.** We will know this is successful when the schema introduced here
  requires no rework to support the next roadmap items that depend on it (a "repeat this order"
  button, and a stock-aware "what can I fulfill right now" check) — confirmed at implementation-plan
  sign-off, not by shipping those features now.

> **Measurement caveat:** this is a single-admin, internal operations tool with no analytics/telemetry
> today. Metrics above are chosen specifically because they're answerable from existing database
> state or a direct, honest conversation with the one user — not because we're adding a metrics
> pipeline for a one-person audience.

## Non-Goals
- **No customer-facing menu or self-service ordering.** This is an admin-only catalog. Customers
  still cannot place their own orders (that's a separate, larger roadmap item).
- **No payment integration.** `totalPrice` remains a tracked number, not a charge.
- **No modifiers/variants/portion sizes.** v1 dishes have exactly one price and one recipe each.
  "No pepper" or "extra meat pies" stay as freeform notes with no price or inventory effect — they
  do not become structured, priced add-ons in this version.
- **No recipe cost/margin analytics** (e.g., "this dish costs GHS 12 in ingredients, sells for
  GHS 20"). `InventoryItem` has no per-unit cost field today, so this isn't achievable without
  additional schema work anyway — explicitly deferred.
- **No bulk import** (CSV/spreadsheet upload of dishes or recipes). Manual entry only, matching how
  Inventory and Customers work today.
- **No raw, non-catalog ingredient picking on the order-creation screen.** Creating a new order is
  dish-first only. A raw-ingredient adjustment escape hatch remains available on the order **edit**
  screen only (see Open Questions).
- **Does not fix known, pre-existing bugs**, called out here explicitly so they aren't confused with
  this feature's scope: cancelling or deleting an order does not restore inventory stock;
  concurrent orders can drive stock negative; Server Actions have no authorization checks; there is
  no server-side input validation anywhere in the app. All four are deliberately deferred to a
  separate hardening pass already agreed with the business owner.

## User Stories
1. As the business owner, I want to create a reusable "Jollof Rice" dish with its price and
   ingredient recipe once, so I never have to re-type its ingredients or guess its price on every
   order again.
2. As the business owner, I want to create a new order by picking "2× Jollof Rice, 1× Meat Pie"
   from a list instead of hand-picking every ingredient, so order entry takes seconds instead of
   minutes mid-shift.
3. As the business owner, I want to still add a free-text note like "no pepper, extra meat pies" to
   an order alongside the dishes I selected, so one-off customer requests aren't lost just because
   they don't fit a rigid dish list.
4. As the business owner, I want the total price to calculate itself from the dishes I picked, but
   still let me adjust it by hand (e.g., a loyal-customer discount or a rounded price), so the
   software doesn't fight me on pricing decisions I'm allowed to make.
5. As the business owner, I want to change a dish's recipe or price going forward without altering
   what past orders say they cost or used, so my historical records stay trustworthy for
   accounting.
6. As the business owner, I want to retire a dish I no longer sell without losing the order history
   that references it, so seasonal menu changes (e.g., a Christmas special) don't corrupt my
   records.

## Success Metrics
- % of new orders created with at least one catalog dish selected — target 80%+ within 30 days.
- Number of active dishes in the catalog after week 1 — target 5-8 (covers her real regular menu).
- Zero incidents (verified by code review + regression test, not just monitoring) of a historical
  order's `totalPrice` or ingredient log changing after a dish's price/recipe is edited later.
- Qualitative: the business owner reports order entry for a repeat dish feels like "a couple of
  taps," not "remembering a recipe" — checked via direct follow-up conversation post-launch, since
  no usage-timing instrumentation exists in this app today.

## UX/Flow Summary
1. The admin sidebar gains a new **Menu** entry (next to Inventory and Customers) showing a table
   of dishes: name, price, a short recipe summary, and an Active/Archived badge.
2. Tapping **Add Dish** opens a form: name, price, then a repeatable "+ Add Ingredient" row (pick
   an inventory item, type how much of it one dish uses). Saving creates the dish and its full
   recipe in one step.
3. When creating a new order, the old "pick every raw ingredient" section is replaced by a
   **Dishes** section: tap "+ Add Dish," pick a dish and a quantity (e.g., 2× Jollof Rice), repeat
   for each dish in the order.
4. The total price field auto-fills as dishes are added or removed, and can still be typed over by
   hand at any point — the software proposes a number, it doesn't lock one in.
5. The existing freeform notes field stays exactly where it's always been, for anything that
   doesn't fit a dish (customizations, delivery instructions).
6. Submitting the order automatically deducts every selected dish's recipe ingredients from
   inventory in one step — no manual ingredient math required, and the existing low-stock alert
   still fires the same way it does today.
7. Reopening an order later shows exactly which dishes (and quantities) were ordered — "2× Jollof
   Rice, 1× Meat Pie" — not just a flattened list of raw ingredients, so the admin recognizes the
   order at a glance.
8. If an order needs correcting later, the order-detail page lets the admin adjust its dishes (and,
   if truly needed, add a one-off extra ingredient not tied to any dish). Saving reverts the old
   inventory deduction and reapplies the new one automatically — exactly like the existing
   ingredient-edit flow does today, just extended to cover dishes.
9. Retiring a dish from the Menu screen hides it from the picker for new orders but keeps every
   past order that used it fully intact and readable — nothing breaks, nothing disappears from
   order history.

## Open Questions
1. Should order **creation** eventually also expose a raw, non-catalog "Extra Ingredients" fallback
   for genuinely one-off items with no matching dish (today only the order **edit** screen has
   this)? Recommended default: no, for v1 — keep the fast path fast and push the business owner
   toward good menu hygiene. Revisit if real usage shows friction.
2. New dish prices will inherit the app's existing hardcoded `$` display (a separate, already-known
   roadmap item to localize currency). Should this feature quietly fix currency display just on
   the screens it touches, or leave that fully alone until the dedicated currency-localization
   work ships? Recommended: leave untouched everywhere, including new screens, to keep this
   feature's scope clean and avoid inconsistent partial fixes.
3. Are fractional dish quantities ever real for this business (e.g., "half a tray"), or is a whole
   number always correct ("2 plates," never "2.5 plates")? Assumed whole numbers only for v1 —
   confirm with the business owner if this is wrong before implementation locks it in.
4. Should archived (retired) dishes stay visible-but-labeled in the Menu catalog forever, or is
   there a need to eventually purge dishes that were created by mistake and never actually used?
   Recommended: no purge mechanism needed for v1 (a dish that was never used against a real order
   can already be hard-deleted outright; anything with real order history stays archived
   permanently as a record).
