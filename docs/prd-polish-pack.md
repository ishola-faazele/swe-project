# PRD: Quick-Win Polish Pack + Enterprise UI Overhaul

## Status
Draft (revised 2026-08-17, second pass — three user decisions folded in: the brand spelling is
settled as "Rostty," order cancellation gets a confirmation step instead of an undo path, and a
new sixth item — inventory archive/retire — is added as its own coherent feature, not a design-only
change. See "Decisions folded in (round 2)" below for what's new since the first revision.)

## Problem Statement
The Rosty business owner runs "Chop with Rosty" primarily from her phone, mid-shift, one-handed —
but the admin portal actively fights her on that device. Below a 768px viewport the entire
navigation sidebar disappears with no replacement, so she cannot move between Orders, Inventory,
Menu, and Customers without typing URLs by hand. Every price in the app renders in US dollars
(`$`) even though she and her customers are Nigerian and transact in Naira, which reads as
unfinished/foreign on customer-facing screens. The `dueDate` field she can (once this pack ships)
attach to an order is never surfaced as an alert anywhere, so the single most reputation-damaging
failure mode for a catering business — a missed delivery — has no safety net. The real brand
assets already sitting in `public/` (logo, favicons, install manifest) are completely unwired, so
the app has no home-screen icon and shows a generic browser-tab icon instead of "Chop with Rostty."

Two smaller, sharper gaps surfaced once we were this deep in the orders and inventory screens.
First: cancelling an order is a single click on a `<select>` with no confirmation at all, and — by
deliberate, already-tested design from the integrity-hardening work — cancellation is **permanent**
(a cancelled order can never be reactivated, because doing so would require re-deducting stock
through the same guarded path a brand-new order uses, and ingredients may already have been
reallocated elsewhere since). A single misclick is currently unrecoverable. Second: deleting an
inventory item that's still referenced by a dish's recipe or a past order's history currently
either throws a raw, unhelpful database error or (for the one relationship that *is* checked
today) a generic error message — there is no way to retire an ingredient the business has stopped
using while keeping historical orders and recipes intact, the same problem the Dish catalog already
solved for menu items.

**And now, separately from all of that: when the owner shows this app to a customer, a supplier,
or a potential investor, it does not read as credible software.** A direct audit of the codebase
found the visual layer is built almost entirely from one-off inline `oklch(...)` color literals
pasted into `style={{}}` props — 196 occurrences across 13 files — even though `globals.css`
already defines a complete, unused semantic design-token set. The practical result is exactly what
you'd expect from that architecture: colors and spacing drift slightly from screen to screen,
native `<select>` dropdowns render with no explicit text color (a real legibility bug on Windows
dark mode), status badges use three different, uncoordinated color systems across three different
files, two "Create X" dialogs use a documented-broken trigger pattern that may not even open in a
real browser, and the customer-facing order-status badges use light pastel Tailwind classes that
visually clash with the app's otherwise-consistent dark theme. None of this is a logic bug — the
order/inventory/customer data flows are correct and tested — but it is a *design* bug, and it is
the reason the app currently reads as assembled rather than designed. The user's own framing:
*"not the usual ai-ish frontend, something enterprise grade."*

### Decisions folded in (round 2)
1. **Brand spelling resolved**: "Rostty" (double-t) is correct — the image assets in `public/`
   were always right; the app's own text (nine occurrences across six files) had the typo. The
   "logo chip" white-background treatment designed for the sidebar/header marks is unaffected by
   this — that treatment exists because the source JPEG has an opaque white background, which is
   an unrelated, still-valid concern. This closes the prior "Rostty vs. Rosty" Open Question.
2. **Cancellation stays terminal.** No un-cancel/reactivation flow is being built — the reasoning
   above (re-deduction would reopen exactly the stock-integrity complexity the integrity-hardening
   work already closed) stands. Instead, a confirmation step is added before an order transitions
   to `CANCELLED`, in both places that transition can happen.
3. **New item 7: Inventory archive/retire** (item 6 is the cancel-confirmation above; item 5,
   unchanged from the first revision, remains the enterprise UI overhaul), approved as a real
   feature addition — not part of the pure visual overhaul, though it touches a file the overhaul
   also touches — mirroring the already-shipped Dish archive pattern onto `InventoryItem`.

## Goals
- We will know this is successful when the admin portal is fully navigable (every nav destination
  reachable, tappable, with no horizontal scrolling of the nav itself) at a 375px viewport width
  via a drawer/hamburger control.
- We will know this is successful when zero hardcoded `$` symbols remain anywhere prices are
  rendered to an admin or a customer — grep-verifiable, binary pass/fail, across all 12 confirmed
  render sites (see TDD).
- We will know this is successful when the admin dashboard and orders table surface every
  currently-active order (not `COMPLETED`/`CANCELLED`) that is due today or overdue, with the
  underlying date logic covered by unit tests so the count is trustworthy, not just
  plausible-looking.
- We will know this is successful when the app is installable to a phone home screen — correct
  favicons in the browser tab, and a valid `manifest.webmanifest` that passes Chrome/Android's
  installability checklist (name, icons, `start_url`, `display: standalone`).
- We will know this is successful when the real "Chop with Rostty" logo appears in the admin chrome
  (sidebar, and the always-visible mobile header) instead of a generic Lucide flame icon.
- **We will know the design overhaul is successful when zero inline `oklch(...)` color literals
  remain in any `style={{}}` prop across the admin portal, dashboard, login, and landing pages** —
  grep-verifiable the same way the currency goal is, and the single clearest binary signal that
  the "assembled, not designed" problem has actually been fixed at the root, not painted over.
- We will know the design overhaul is successful when the app passes a structured manual review
  against the acceptance criteria below (design bar + accessibility), scored as a checklist, not a
  subjective "does it look nice" pass — see UX/Flow Summary and the TDD's Testing Strategy.
- We will know this is successful when it is impossible to accidentally cancel an order with a
  single click — every path that sets an order to `CANCELLED` requires an explicit second
  confirmation naming the order, in both the orders table and the order detail page.
- We will know this is successful when an inventory item referenced by any dish recipe or any
  historical order can be retired (hidden from every "pick an ingredient" screen going forward)
  without an error, without breaking that historical data, and without requiring a hard delete —
  and when an item with **no** references at all can still be hard-deleted exactly as it already
  can be today.
- We will know this is successful when an archived inventory item never contributes a false
  restock signal — it does not count toward the dashboard's "Low Stock Alerts" figure.
- We will know this is successful when zero hardcoded occurrences of the brand's old spelling
  ("Rosty"/"ROSTY") remain in customer- or admin-facing application text — grep-verifiable, the
  same binary-pass/fail treatment already used for the `$`/`oklch` goals above.

## Non-Goals
- No changes to Server Action authorization (`requireAdmin()`), the `ActionResult`/typed-error
  pattern, zod input validation, stock-revert-on-cancel/delete, or race-safe stock decrements —
  all already landed via the (separately merged) integrity-hardening pass. This is a visual/UX
  pass layered on top of that working, tested logic, not a rewrite of it.
- No change to the Dish/DishIngredient/OrderDish data model or dish-based order-creation flow —
  already landed via the (separately merged) Menu & Recipe System. Order creation stays
  dish-first; this pack only restyles the screens that flow uses.
- No Menu/Recipe system changes beyond what's already shipped, and no order-creation redesign
  beyond adding a single new optional "Due Date" field to the existing create-order form (the
  due-date input is a minimal, necessary exception — see "A note on scope" below, preserved from
  the original draft of this PRD).
- **No general responsive redesign of the orders/inventory/menu/customers *tables* themselves** —
  those remain wide HTML tables that require horizontal scrolling below `md`. Only the top-level
  admin *navigation* becomes mobile-usable in this pack. The design overhaul improves the
  *legibility and polish* of those tables (consistent tokens, `tabular-nums` on numeric columns,
  a cleaner empty state, better scroll affordance) but does not turn them into a mobile card
  layout — that is a materially bigger redesign of column priority and information density, and is
  explicitly flagged as a candidate follow-up in Open Questions, not silently included here.
- No per-order currency selection, multi-currency support, or currency conversion. This is a
  single-business, single-currency app by design.
- **No light-mode / theme-toggle.** The app is deliberately, permanently dark. The design overhaul
  makes the dark theme more consistent and correct (e.g. `color-scheme: dark`, fixing the white
  `theme_color` in the manifest) — it does not add a light mode or a user-facing theme switcher.
- **No decorative/maximalist visual treatment** — no grain overlays, no custom cursors, no
  diagonal/asymmetric grid-breaking layouts, no elaborate page-load choreography. See "Design bar"
  below for why, and for what "enterprise grade" concretely means for *this* product.
- No introduction of a formal design-token build pipeline, Figma-to-code system, or a published
  component library package. The overhaul extends the existing Tailwind v4 `@theme inline` tokens
  and adds a small set of `@layer components` utility classes in `globals.css` — the same
  lightweight mechanism the codebase already uses for `.stat-card`/`.status-*`/`.stock-*`.
- No migration of `alert()`/`confirm()` browser dialogs to the existing `toast` system for
  non-visual error/confirmation flows. This is a real, noted inconsistency (`MenuClient.tsx`
  already uses `toast`; every other admin screen uses `window.alert`/`window.confirm`) and a
  natural fast-follow, but changing it touches action-result-handling code paths in every screen
  and is deliberately left out of this pass to keep the diff a visual/UX pass, not a behavioral
  one. Flagged in Open Questions, not silently dropped. **This stays true even with the new
  cancel-confirmation step (see below): that confirmation deliberately uses native `window.
  confirm()` — the pattern already used for every other destructive action in this app
  (`InventoryClient`/`CustomerClient`/`MenuClient` delete flows) — not a toast. If the
  `alert()`/`confirm()` → `toast` migration ever happens, the cancel-confirmation must move with
  it as part of that same pass, not be left behind as an inconsistent holdout.**
- No automated visual-regression or component-interaction test suite added *for this pack's visual
  changes*. New pure-logic unit tests are added for the two genuinely new correctness surfaces
  (currency formatting, due-date/overdue derivation) — see TDD Testing Strategy for the explicit,
  reasoned scope of what gets automated coverage and what gets a manual checklist instead.
- No repair of the Base UI `DialogClose`/`render={<Button/>}` composition — **this was an open
  risk in the prior draft of this PRD and has since been resolved**: a spike against the real
  `dialog.tsx` component confirmed `DialogClose` (unlike the separately-documented-broken
  `DialogTrigger render={<Button/>}` pattern) dispatches clicks correctly. No workaround needed.
- **No un-cancel / order reactivation.** A `CANCELLED` order remains permanently terminal — this
  pack only adds a confirmation *before* an order enters that state, never a way to leave it. This
  is a deliberate decision (not a deferred one): reactivating a cancelled order would require
  re-deducting stock through the same guarded, race-safe path a brand-new order uses, and the
  ingredients it originally consumed may have already been reallocated to other orders since — the
  business's answer to "I cancelled this by mistake" is to create a new order, not to un-cancel.
- **No inventory bulk-archive, no auto-archive-on-zero-stock, and no scheduled/automatic
  archiving.** Item 7 is a manual, one-item-at-a-time admin action (matching the Dish pattern
  exactly) — the business owner decides when an ingredient is retired, the app never decides for
  her.
- **No change to how `OrderIngredientLog`/`DishIngredient` foreign-key relationships are declared**
  (still `RESTRICT`, no `onDelete: Cascade` introduced) — item 7 works *within* that existing,
  deliberate schema convention by archiving instead of deleting when a reference exists, exactly
  as `Dish`/`deleteDish` already does. It does not relax or change the FK behavior itself.

### A note on scope: why "Due Date" is being added to the create-order form
The roadmap describes due-date alerting as "pure derived logic from existing `dueDate` + `status` —
NO schema change." That's true at the schema layer, but a direct code read of
`src/app/admin/orders/OrderClient.tsx` and `src/app/admin/orders/[id]/OrderDetailsClient.tsx`
shows `dueDate` is **never settable from any admin screen today** — the create-order form has no
due-date input, and the order-detail screen has no way to edit it after creation, even though the
underlying `createOrder` Server Action already accepts and persists a `dueDate` parameter and
silently receives `undefined` on every call. Shipping the dashboard widget and row-highlighting
without also letting the admin *set* a due date would ship a feature that is permanently empty — a
demo-only illusion of the feature, not the feature. This PRD therefore includes a minimal due-date
input on order creation (and a lightweight inline edit on the order detail page) as a required,
load-bearing part of this item, not scope creep.

### The design bar, made concrete (so "enterprise grade" is checkable, not a vibe)
The reference points the user named are Linear, the Stripe Dashboard, and the Vercel dashboard —
tools built for **dense, fast, daily operational use by people under time pressure**, which is
exactly this product's actual usage pattern (a business owner working the queue mid-shift). That
rules out visual maximalism (grain, custom cursors, page-load choreography) as the wrong mode for
this specific product, not because maximalism is bad in general, but because decoration competes
with scan-speed in an operations tool. The correct mode is **refined/industrial restraint**:
- A confident, limited type scale used consistently (not: every screen inventing its own font
  sizes and letter-spacing values inline).
- Real information hierarchy — page title vs. section label vs. body vs. meta text should be
  visually distinguishable at a glance without reading the words.
- A single, coherent color system (the existing amber-on-near-black palette, kept — this pack
  *evolves* the identity, it does not replace it) applied through reusable tokens, not
  re-improvised per component.
- Purposeful, consistent spacing — the same card padding, the same table-cell padding, the same
  section gap, everywhere.
- Restrained accent use — amber marks emphasis and state (active nav, alerts, primary actions), it
  is not sprinkled decoratively.
The existing typographic identity (Syne for display, DM Mono for data/labels/uppercase labels) is
already good, distinctive raw material — it satisfies the "no generic AI fonts" bar on its own and
is kept, not replaced.

## User Stories
- As the business owner, I want a hamburger menu that opens a full navigation drawer on my phone,
  so that I can get to Orders, Inventory, Menu, and Customers without switching to a laptop.
- As the business owner, I want that drawer to close automatically the moment I tap a nav link, so
  that I don't have to tap twice (once to navigate, once to dismiss the drawer) every single time.
- As the business owner, I want every price I see — in the orders table, the order detail view,
  the menu/dish catalog, and what my customers see on their own dashboard — shown in Naira (₦), so
  that the app looks like it was built for my business.
- As the business owner, I want to see at a glance, right on my dashboard, how many active orders
  are due today or already overdue, so that I never find out about a missed delivery from an angry
  customer instead of from my own tools.
- As the business owner, I want to set (and later correct) an order's due date when I create or
  review it, so that the overdue/due-today alerting actually has data to work with.
- As a customer, I want to tap "Add to Home Screen" on my phone browser and get a real "Rostty"
  icon and app name, so that the ordering portal feels like a real app I'll come back to, not a
  random browser tab.
- **As the business owner, when I show this app to a customer, a supplier, or anyone I'm trying to
  impress, I want it to look like professional, purpose-built software — not like a generic
  AI-generated template or a student project — so that it reflects well on my business, not
  against it.**
- **As the business owner scanning a busy orders table mid-shift, I want prices, stock counts, and
  order counts to line up in a straight column (not jitter left/right as digits change), and I
  want status/urgency information to be readable by more than color alone**, so that the table is
  actually fast to scan under pressure, not just prettier.
- As a screen-reader or keyboard-only admin user (accessibility edge case, not the primary
  persona, but a hard requirement), I want the mobile nav drawer to trap focus, announce itself,
  and be dismissible with Escape, and I want every icon-only button (the hamburger, the dialog
  close button) to have an accessible name, so that the new/redesigned UI doesn't silently regress
  the app's accessibility baseline.
- As the business owner, I want to be asked "are you sure?" before an order is cancelled, so that
  a single misclick on the status dropdown doesn't permanently cancel a real customer's order.
- As the business owner, I want to retire an ingredient I've stopped stocking (without deleting
  the history of every order and recipe that used it) and have it disappear from every "pick an
  ingredient" list going forward, so that my recipe builder and order editor stop offering
  ingredients I can no longer buy, while past orders still show exactly what was used.
- As the business owner, I want a retired ingredient to stop showing up in my low-stock alerts,
  so that I'm never nagged to restock something I've deliberately stopped carrying.

## Success Metrics
This is a single-admin internal tool with no analytics/telemetry pipeline today (confirmed: no
event-tracking library anywhere in `package.json` or `src/`), so "adoption %"-style SaaS metrics
are not available and would be dishonest to promise. The practical, verifiable substitutes are:
- **100%** of admin nav destinations (Dashboard, Orders, Inventory, Menu, Customers) reachable and
  tappable at a 375px viewport, with no horizontal scroll of the nav itself — verified via a
  manual QA checklist (see TDD) on at least one real Android and one real iOS device or emulator.
- **Zero** occurrences of a literal `$` currency symbol in any price-rendering JSX across `src/` —
  grep-verifiable at code-review time, across all 12 confirmed sites (see TDD), and re-checked
  before every future price-related change.
- **Zero** false negatives in the due-today/overdue derivation logic against the unit-test suite's
  boundary cases (midnight-boundary in a UTC-vs-Lagos-disagreeing window, null `dueDate`,
  non-active statuses) — a correctness bar, not a usage bar.
- The production build passes a Lighthouse/Chrome installability check (valid manifest, ≥192px and
  ≥512px icons present, `start_url` resolves, `display: standalone`) — binary pass/fail.
- The real Rostty logo (not the Lucide `Flame` icon) is visible in the sidebar brand mark and in
  the always-visible mobile header, on the app's dark background — verified visually.
- **Zero** inline `oklch(...)` literals remaining in any `style={{}}` prop across
  `src/components/layout/`, every `src/app/admin/**/*.tsx`, `src/app/dashboard/page.tsx`,
  `src/app/login/page.tsx`, and `src/app/page.tsx` — grep-verifiable (`grep -rn "oklch(" src/ ` with
  the CSS-file exclusion), the single clearest binary signal that colors are coming from the token
  system, not reinvented per component.
- **100%** of icon-only interactive controls (the hamburger trigger, every dialog close button,
  the sidebar/menu buttons) have a non-empty `aria-label` — grep/manual-audit verifiable.
- **100%** of native `<select>` elements in the app render with explicit, non-transparent
  `background-color` and explicit `color` (not inherited/transparent) — closes a confirmed,
  concrete bug (native selects currently rely on `bg-transparent`, which on Windows without
  `color-scheme: dark` set can render illegible black-on-transparent text) — verified by code
  review plus one manual check on a Windows/Chrome or Windows/Edge machine if available.
- Every table's numeric columns (price, stock level, order/customer counts) use tabular (fixed-
  width) digit rendering — verified visually: digits should not cause column width to jitter as
  values change.
- The manual design-review checklist (TDD Testing Strategy) passes with zero unresolved items
  before this pack is considered done — this substitutes for the "does it feel enterprise-grade"
  question with a fixed, repeatable, binary-scored list instead of a one-time subjective judgment.
- **Zero** occurrences of the old "Rosty"/"ROSTY" spelling remain in application source text
  (case-insensitively grep-verifiable across `src/`) — all nine confirmed occurrences corrected.
- **100%** of order-cancellation attempts (from either the orders table or the order detail page)
  require an explicit confirm before the status actually changes to `CANCELLED` — verified by
  manual QA plus a component-test assertion once `window.confirm` is stubbed (see TDD).
- An inventory item referenced by a dish recipe or a past order **archives instead of erroring**
  on delete (matching the existing Dish behavior); an item with zero references **still
  hard-deletes** exactly as today — both verified by the (corrected) integration test suite.
- The admin dashboard's "Low Stock Alerts" count and every ingredient picker (Menu's recipe
  builder, the order detail page's "Extra Ingredients" editor) exclude archived items by default —
  grep/code-review verifiable against the single shared `getInventoryItems()` query.

## UX/Flow Summary
1. **Mobile nav.** On any admin page below the `md` breakpoint (~768px), a hamburger icon appears
   in the top header bar. Tapping it slides a full-height navigation drawer in from the left,
   containing the exact same nav content as the desktop sidebar (Operations: Dashboard, Orders;
   Management: Inventory, Menu, Customers), plus the Rostty logo at the top. Tapping any nav item,
   tapping the dark overlay behind the drawer, tapping the drawer's own close (X) button, or
   pressing Escape all close it. Above `md`, nothing changes — the existing always-visible sidebar
   remains exactly as-is, restyled to the same token/type system as everything else.
2. **Currency.** Every place a price renders — the orders table's Total column, the order-create
   and order-edit "Total Price" input labels, the order detail page (total, unit price, line
   total), the menu/dish catalog (price column, price input labels, dish picker options), and the
   customer's own order-history dashboard — now shows a properly formatted Naira amount (e.g.,
   `₦45,000.00`) instead of a `$`-prefixed number, and renders it with tabular digits so it doesn't
   jitter as the table updates.
3. **Due-date alerting.** When creating an order, the admin can optionally pick a due date (a
   plain date, no time-of-day). On the dashboard, two new stat cards — "Due Today" and "Overdue" —
   sit alongside the existing Total Orders/Customers/Active Orders/Low Stock cards, counting only
   active (non-completed, non-cancelled) orders. In the orders table, a new "Due" column shows the
   date plus a small colored badge with text (never color alone) reading "Due Today" or "Overdue"
   for qualifying active orders; the row itself gets a subtle background tint to reinforce the
   badge, not replace it. On the order detail page, the admin can also set/correct the due date
   after the fact, the same way they already change status inline — this new inline edit is a
   fully authenticated, validated Server Action, matching every other mutation in the app, not a
   trusted-client shortcut.
4. **Brand & installability.** The browser tab now shows the real Rostty favicon instead of
   Next.js's default icon. The sidebar's amber flame-icon brand mark is replaced with the real
   logo (presented on a small white "logo chip," since the source logo asset has an opaque white
   background — unrelated to and unaffected by the spelling decision below). The mobile header
   also gains a small logo mark, since today it has no brand identity at all when the sidebar is
   hidden. On a phone browser, "Add to Home Screen" now produces a correctly named ("Rostty"),
   correctly iconed, dark-themed app shortcut that opens straight into the app instead of a
   generic bookmark, and the browser's own UI chrome (status bar, scrollbars, native form
   controls) matches the dark theme instead of defaulting to light. **The brand spelling
   throughout the app's own text — sidebar wordmark, landing page hero and footer, page
   metadata/title, login page, customer portal header, and both transactional email templates —
   now consistently reads "Rostty" (double-t), matching the image assets, which were correct all
   along.**
5. **The redesign, as experienced end to end.** Nothing about *what* the admin can do changes —
   every button, form, and table does exactly what it did before. What changes is that every
   screen now reads as one coherent product instead of several independently-styled pages: the
   same page-title treatment, the same section-label treatment, the same card padding and table
   density, the same badge language for status/category/urgency everywhere it appears (including,
   for the first time, on the customer's own order-history page, which currently uses a visually
   unrelated light-pastel badge style that clashes with the rest of the app). Interactive elements
   get a real focus ring and real hover states — both of which are technically impossible today
   because most of the UI is styled with inline `style={{}}` props, which cannot express
   pseudo-classes or breakpoints at all. Empty tables ("No orders yet," "No dishes yet") get a
   slightly more considered treatment (icon + message) instead of a bare line of gray text, and
   admin pages get a lightweight loading skeleton instead of a blank flash while data streams in.
   The login page swaps its raw, unstyled-component `<input>`/`<button>` for the app's existing
   `Input`/`Button` components (used correctly, everywhere else), and its submit button now shows
   a pending state ("Sending…") instead of appearing to do nothing for the round trip to the
   magic-link email service.
6. **Order cancellation gets a confirmation step.** Selecting "Cancelled" in either the orders
   table's status dropdown or the order detail page's status dropdown now first asks the admin to
   confirm, naming the order, before the status actually changes. Declining leaves the order
   exactly as it was — no partial state, no visible flicker. This does not add any way to reverse
   a cancellation once confirmed; that remains permanently one-way, as it already is today.
7. **Inventory archive/retire.** On the Inventory screen, deleting an item that's referenced by a
   dish's recipe or a past order's history no longer produces an error — it archives the item
   instead (the exact behavior the Menu screen's dishes already have), and a toast/alert message
   tells the admin what happened. Archived items are hidden from the inventory list by default,
   with a "Show Archived" toggle to reveal and restore them, and from *every* place an admin picks
   an ingredient going forward (the Menu screen's recipe builder, the order detail page's "Extra
   Ingredients" editor) — but an already-saved recipe row or order line that references a now-
   archived ingredient still renders correctly and remains editable, exactly like the existing
   archived-dish behavior. An archived item never counts toward the dashboard's low-stock alert.
   An item genuinely referenced nowhere can still be permanently deleted, exactly as today.

## Open Questions
- ~~**Logo asset content** ("Rostty" vs. "Rosty")~~ — **RESOLVED.** "Rostty" (double-t) is
  confirmed correct; the image assets in `public/` were always right, and the nine app-text
  occurrences of the old spelling are being corrected to match (see UX/Flow Summary item 4). No
  longer open.
- **Due-date edit surface on the order detail page**: this PRD proposes a minimal inline date-edit
  control (mirroring the existing inline status-select pattern). If the business owner would
  rather this wait until a fuller "edit order" experience exists, the inline control can be
  trivially deferred — the dashboard widget and table badges still work with due dates set at
  creation time only. Non-blocking; default is to include it, per the "note on scope" above.
- **Mobile table layout as a follow-up**: this pack explicitly does not turn the orders/inventory/
  menu/customers tables into a mobile-friendly card layout — they remain horizontally scrollable
  below `md`. Is that acceptable for now (the owner primarily uses the *nav* on mobile, per the
  original problem statement — not necessarily deep table editing), or should a follow-up be
  scheduled? Recommend deferring; flagging so it isn't mistaken for an oversight.
- **`alert()`/`confirm()` → `toast`/confirmation-dialog migration**: `MenuClient.tsx` already uses
  the app's `toast` system for success/error feedback; every other admin screen still uses browser
  `alert()`/`confirm()`. This is a real, visible inconsistency an "enterprise grade" bar would
  ultimately want fixed, but it touches action-result-handling code in every screen rather than
  purely visual code, so it's deliberately left out of this pass. Confirm whether this should be
  scheduled as an immediate fast-follow or left for a later general polish pass.
- **Two broken `DialogTrigger render={<Button/>}` "Create" buttons found during this audit**
  (`InventoryClient.tsx`, `CustomerClient.tsx` — `OrderClient.tsx` also uses this pattern for its
  "Create Order" trigger) — `AGENTS.md` documents this exact pattern as silently broken in a real
  browser (click events swallowed), and `MenuClient.tsx` already uses the correct direct-`onClick`
  pattern instead. Since this pack is already touching all three of these files for the visual
  pass, the TDD proposes fixing the trigger pattern in the same diff (a one-line change per file,
  net risk reduction, not a new feature). Flagging here because it is, strictly speaking, a
  functional bugfix riding along with a visual pack — confirm this is acceptable, or it can be
  pulled into its own trivial follow-up PR instead.
- **Schema-change rollout coordination**: item 7 (inventory archive) is this pack's first and only
  database schema change (`InventoryItem.isActive`, additive, non-destructive). It must be applied
  to both the shared local dev database and the isolated integration-test database as an explicit,
  human-approved step before any archive code lands — see the TDD's Rollout Plan. Flagging at the
  PRD level too because it affects *when* this pack can safely be merged/deployed relative to any
  other concurrently active work sharing the same local Postgres instance, which is a scheduling
  question, not just an engineering one.
