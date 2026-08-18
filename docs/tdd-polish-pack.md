# TDD/RFC: Quick-Win Polish Pack + Enterprise UI Overhaul

## Status
Draft (revised 2026-08-17, second pass — three additional user decisions folded in on top of the
5-item revision below: the "Rostty" spelling is settled, order cancellation gets a client-side
confirmation instead of an undo path (item 6), and a new item 7 — inventory archive/retire — is
added as its own feature. See "What changed in this revision (round 2)" below.)

## Context & Motivation
See `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/docs/prd-polish-pack.md` for the
user-facing rationale. This document covers five items: mobile admin nav, currency localization,
due-date/overdue alerting, brand/PWA asset wiring, and an enterprise-grade UI overhaul of the
admin portal and (bounded, non-functional-change) customer-facing pages.

This repo is Next.js 16 (App Router, Turbopack), TypeScript strict, Prisma against Postgres via
`db push` (no migration files), Base UI + shadcn primitives, Tailwind v4, TanStack Table v8,
Supabase Auth. Full conventions are in
`/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/AGENTS.md`, read in full before drafting
this. **Two prior, separately-scoped RFCs have landed on this branch since the first draft of this
document**: an integrity-hardening pass (`requireAdmin()`, the `ActionResult`/typed-error pattern,
zod validation via `src/lib/validation.ts`, race-safe stock decrements via
`src/lib/inventory.ts`) and the Menu & Recipe System (`Dish`/`DishIngredient`/`OrderDish`,
dish-first order creation, `src/lib/recipe.ts`). Every code example in this document is written
against the **current, post-merge** shape of the codebase — the prior draft's `createOrder`
signature (`{ customerId, description, totalPrice, dishes }`, not `ingredients`) and its
unauthenticated, unvalidated `updateOrderDueDate` sketch are both corrected below.

### Design direction — explicitly sourced from two mandated skills
The user required this pass follow `/frontend-design` and `/web-design-guidelines`
(Vercel's Web Interface Guidelines). Per the orchestrator's framing of `/frontend-design`: it
offers two valid modes — bold maximalism or refined minimalism — and **for this product the
correct mode is refined/industrial restraint**, not maximalism. This is a real kitchen-operations
tool used daily by a non-technical owner under time pressure; density, legibility, and scan-speed
beat decoration. The reference bar is Linear / Stripe Dashboard / Vercel dashboard. This document
deliberately does **not** propose decorative grain overlays, custom cursors, diagonal/asymmetric
grid-breaking layouts, or elaborate page-load choreography — those would read as exactly the
"ai-ish" output the user rejected, and would actively harm an operational tool. The existing
identity (near-black oklch neutrals at hue 65, amber/gold accent `oklch(0.72 0.15 65)`, Syne
display font + DM Mono data font) is evolved, not discarded — it already satisfies
`/frontend-design`'s "no generic AI fonts" rule.

Every rule pulled from `/web-design-guidelines` is called out inline, next to the specific
component it constrains, and re-collected as a single acceptance-criteria checklist in Testing
Strategy so it's traceable and reviewable, not just prose.

### What changed in this revision (for anyone diffing against the prior draft)
- **Scope**: added item 5, the enterprise UI overhaul, as a first-class, integrated part of the
  same pack — not a follow-on pass. The mobile-nav work is now also the shell redesign; the
  due-date widget work is now also the `.stat-card` visual-execution redesign.
- **Corrected**: the `DialogClose`/`render={<Button/>}` open question is **resolved** — a spike
  against the real `dialog.tsx` component confirmed `DialogClose` dispatches clicks correctly
  (unlike the separately-documented-broken `DialogTrigger render={<Button/>}` pattern). The
  drawer uses the standard `DialogContent` close button; no `showCloseButton={false}` workaround.
- **Corrected**: currency has **12** confirmed `$`-hardcoded render sites, not 4 (the Menu &
  Recipe System added 8 new ones: dish prices, dish-picker options, per-line unit/total prices).
  Exact file:line list below.
- **Corrected**: the timezone-boundary unit test case in the prior draft contradicted itself
  mid-sentence (it asserted "different UTC days" about a pair of instants that are actually the
  same UTC day). Fixed below with a concrete, correct instant pair.
- **Corrected**: `createOrder`'s call site and the new `updateOrderDueDate` action are written
  against the current dish-based, zod-validated, `requireAdmin()`-gated action shape — the prior
  draft's `{ ingredients }` payload and unauthenticated due-date-update sketch predate both merged
  RFCs and would have regressed the hardening work if implemented as originally written.
- **Corrected**: the Testing Strategy no longer proposes bootstrapping Vitest/jsdom/RTL from
  scratch — **139 tests already exist and are green** (60 unit + 79 integration; `jsdom` +
  `@testing-library/react` + `@testing-library/user-event` are already installed and already used
  by 3 component test files). The prior draft's "this repo has zero test files" framing is stale.
- **Corrected**: `.env.example` already exists in this worktree (created during a prior pass) —
  no longer proposed as a new file, just confirmed its `NEXT_PUBLIC_CURRENCY` entry is correct.
- **Added**: the foundational finding that motivated the design overhaul — `globals.css` already
  defines a complete semantic token set via Tailwind v4's `@theme inline` block, but 13 files
  bypass it with 196 inline `oklch(...)` literals in `style={{}}` props. This is sequenced as the
  *first* work item in Rollout Plan, because inline styles cannot express breakpoints (blocking
  the responsive-nav work) or hover/focus states (blocking the accessibility requirements below).

### What changed in this revision (round 2 — three decisions from the user, plus one bug found along the way)
1. **Brand spelling resolved: "Rostty" (double-t) is correct.** The image assets in `public/` were
   always right; nine app-text occurrences across six files had the typo. This is now a required
   fix (section 4), not a flagged-and-deferred Open Question. Doc-only occurrences in `README.md`/
   `AGENTS.md`/`.env.example` were already corrected directly on `main` (commit `e692724`) and are
   explicitly **out of scope here** — they are not this pack's files to touch, and re-touching them
   risks a spurious merge conflict with that commit.
2. **Cancellation stays terminal — a client-side confirm is added, `actions.ts` is untouched.** New
   section 6. Hard constraint: `updateOrderStatus` and its `leavingCancelled` rejection logic in
   `src/app/admin/orders/actions.ts` (already merged, already tested) do not change at all.
3. **New item 7: inventory archive/retire** (item 6 is cancellation-confirm, above; item 5 remains
   the enterprise UI overhaul from the first revision) — approved as a real feature addition,
   mirroring the already-shipped `Dish`/`deleteDish`/`toggleDishActive` pattern onto
   `InventoryItem`. This is this pack's **first and only database schema change**
   (`InventoryItem.isActive`) — see the new section 7 and the expanded Rollout Plan for the
   explicit, gated, two-database migration this requires.
4. **A latent bug found while designing item 7's delete path, fixed as part of the same change**:
   `deleteInventoryItem`'s existing pre-check only counts `OrderIngredientLog` references, not
   `DishIngredient` references — an ingredient used only in a recipe (never actually ordered)
   currently passes the pre-check and then hits a raw Prisma `P2003` at the actual `delete()` call.
   `toErrorResult`'s `P2003` branch prevents a crash, but the admin gets a generic fallback message
   instead of the specific one the pre-check exists to provide. Section 7 fixes this by counting
   both tables and archiving (not erroring) when either is non-zero.

---

## Proposed Design

### 0. Design foundations (read first — every section below builds on this)

#### 0.1 The core finding, and why it's sequenced first
`src/app/globals.css` already defines `--background`, `--foreground`, `--card`, `--border`,
`--primary`, `--muted-foreground`, `--sidebar*`, `--chart-1`..`--chart-5`, and more, and Tailwind
v4's `@theme inline` block already promotes every one of them into ordinary utility classes
(`bg-card`, `text-muted-foreground`, `border-border`, `bg-sidebar`, `text-sidebar-foreground`,
`bg-primary text-primary-foreground`, `bg-chart-3`, etc. — these are not new; they already exist
and already work, they are simply unused outside `Button`/`Input`/`Dialog`/`Toast`). Confirmed by
grep: 196 raw `oklch(...)` literals across 13 files, concentrated in
`src/components/layout/Sidebar.tsx` (12), `src/components/layout/Header.tsx` (9),
`src/app/page.tsx` (23), `src/app/login/page.tsx` (21), `src/app/admin/page.tsx` (31), and the
five admin `*Client.tsx` screens (6–21 each).

This is not just a style-consistency nit. Concretely, it blocks three of this pack's own
requirements:
- **Inline styles cannot express breakpoints** — this directly blocks the mobile-nav work (item
  1), which needs `md:` variants.
- **Inline styles cannot express `:hover`/`:focus-visible`** — this blocks the accessibility
  requirements below (every interactive element needs a visible focus ring; native `<select>`s
  need working hover/focus states).
- **No single source of truth** guarantees color and spacing drift over time — this is the
  concrete, structural reason three different badge-color systems already exist in this codebase
  (see 0.4 below), not a one-off mistake.

**Decision: extend, don't reinvent.** No new design-token build pipeline, no CSS-in-JS, no design
token JSON file. The fix is: (a) apply the *existing* semantic Tailwind utility classes in place
of inline `style={{}}` props wherever they map directly, and (b) add a small number of new
`@layer components` classes to `globals.css` for the handful of composite patterns that repeat
across every screen (page title, section label, stat value, table header cell, native-select
field) — the exact same lightweight mechanism `.stat-card`/`.status-*`/`.stock-*` already use.
This keeps the diff mechanical and low-risk: replacing `style={{ color: 'oklch(0.52 0.01 65)' }}`
with `className="text-muted-foreground"` is a value-preserving rename (the token *is* that exact
oklch value), not a redesign decision, for the vast majority of the 196 sites.

#### 0.2 Type scale & spacing rhythm — new `@layer components` classes in `globals.css`
Rather than inventing a parallel numbering system, this codifies the type/spacing choices this
pack already needs to make repeatedly, as reusable classes:

```css
@layer components {
  /* Type scale — one class per role, used everywhere that role appears */
  .page-title    { @apply text-2xl md:text-3xl font-extrabold tracking-tight text-foreground text-balance; }
  .eyebrow       { @apply text-xs font-semibold uppercase tracking-widest text-muted-foreground font-mono-data; }
  .section-title { @apply text-lg font-bold tracking-tight text-foreground; }
  .stat-value    { @apply text-3xl lg:text-4xl font-bold font-mono-data tabular-nums leading-none; }
  .meta-text     { @apply text-xs text-muted-foreground font-mono-data; }

  /* Table primitives — replaces the per-file inline <th>/<tr> style objects */
  .table-head-cell { @apply px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-mono-data; }
  .table-row       { @apply border-b border-border/60 transition-colors hover:bg-muted/40; }
  .table-cell-num  { @apply font-mono-data tabular-nums; }

  /* Native <select> — the shared, token-based, non-transparent field (see 0.5) */
  .select-field {
    @apply h-9 w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground
           shadow-sm outline-none transition-colors
           focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
           disabled:opacity-60 disabled:cursor-not-allowed;
  }
}
```

`tabular-nums` on `.stat-value` and `.table-cell-num` satisfies the web-interface-guideline
requirement that numeric columns (price, stock, order counts) use fixed-width digit rendering —
DM Mono is monospace already, but `font-variant-numeric: tabular-nums` is what the guideline
literally names and is applied explicitly rather than assumed from the font choice alone. `.
page-title` uses `text-balance` per the guideline's "use `text-wrap: balance`/`text-pretty` on
headings" rule.

This is a **documented convention**, not a rigid new abstraction layer — screens are free to
combine these with ordinary Tailwind utilities (`.page-title` plus a one-off `mb-1`, for example).
The goal is that every screen picks from the same six roles instead of improvising a new
`text-{xs,sm,base,lg,xl,2xl}` + letter-spacing + color combination per heading, which is what
happens today.

#### 0.3 Status/urgency/category badges — killing the three uncoordinated color systems
The audit found three genuinely different mechanisms doing the same job (a colored badge for a
categorical value) in three different files:
1. `globals.css`'s `.status-*`/`.stock-*` classes (Tailwind utility strings, dark-theme-correct) —
   used by `admin/page.tsx`'s recent-orders table.
2. Runtime string-concatenation of an inline `oklch(...)` literal with a hardcoded alpha suffix —
   `InventoryClient.tsx`'s `categoryColors` (`${color}20`/`${color}40`) and `MenuClient.tsx`'s
   `statusColors` for ACTIVE/ARCHIVED. This is the pattern the ground-truth audit specifically
   flagged: it can't express hover states, and it's the most fragile of the three (a typo in the
   hex-alpha suffix silently produces an invalid color, not an error).
3. `dashboard/page.tsx`'s local `statusColors` map using **light-mode pastel Tailwind classes**
   (`bg-yellow-100 text-yellow-800`, etc.) — the only place in the app still doing this, and it
   visually clashes with the otherwise-universal dark theme on the customer's own order-history
   card.

**Decision: one badge language, expressed as `@layer utilities` classes reusing existing tokens,
consumed everywhere the same categorical concept appears.**

New `globals.css` additions (same idiom as the existing `.status-*`/`.stock-*` block, extended):
```css
@layer utilities {
  /* Due-date urgency (item 3) */
  .due-overdue  { @apply inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-red-950/60 text-red-400 border border-red-800/50; }
  .due-today    { @apply inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-amber-950/60 text-amber-400 border border-amber-800/50; }

  /* Dish status (Menu screen) — same visual family as .status-ready/.status-completed */
  .dish-active   { @apply inline-flex items-center rounded px-2 py-0.5 text-xs font-medium font-mono-data bg-emerald-950/50 text-emerald-300 border border-emerald-700/40; }
  .dish-archived { @apply inline-flex items-center rounded px-2 py-0.5 text-xs font-medium font-mono-data bg-zinc-900/50 text-zinc-500 border border-zinc-800; }
}
```

Inventory category badges don't get new CSS classes — they get a static, compiled Tailwind
class-string map that reuses the **existing** `--chart-1`..`--chart-5` tokens (already promoted
to `bg-chart-3`/`text-chart-3`/`border-chart-3` etc. by `@theme inline`), chosen to preserve the
current color *intent* exactly (green for ingredients, blue for drinks, amber for packaging,
neutral for other) without any runtime string interpolation:

```ts
// InventoryClient.tsx — replaces the categoryColors oklch-concat map
const categoryBadgeClass: Record<Category, string> = {
  INGREDIENT: 'bg-chart-3/15 text-chart-3 border-chart-3/40',
  DRINK:      'bg-chart-4/15 text-chart-4 border-chart-4/40',
  PACKAGING:  'bg-primary/15 text-primary border-primary/40',
  OTHER:      'bg-muted text-muted-foreground border-border',
}
// cell: <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium font-mono-data border', categoryBadgeClass[cat])}>{cat}</span>
```

`dashboard/page.tsx`'s local `statusColors`/`statusEmojis` maps are deleted entirely and replaced
by a new shared module (below) so the customer portal's status badge is **the same badge** the
admin already sees, not a lookalike.

#### 0.4 New shared module: `src/lib/orderStatus.ts`
Order-status display metadata (label, emoji/icon, badge className) currently exists independently
in `admin/page.tsx` (`statusConfig`) and `dashboard/page.tsx` (`statusColors` + `statusEmojis`) —
two copies of the same six-entry lookup table that can silently drift (e.g. today, the admin's
"Prepping" badge is blue and the customer's is also blue, but there's nothing enforcing that; it's
coincidence, not a guarantee). This mirrors the precedent already set by `ACTIVE_ORDER_STATUSES`
in the due-date module (0.6 below) — one source of truth per cross-cutting concept, pure, no
Prisma/`next/*` imports (same discipline as `src/lib/recipe.ts`):

```ts
// src/lib/orderStatus.ts
import type { OrderStatus } from "@prisma/client"

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; emoji: string; className: string }> = {
  PENDING:   { label: 'Pending',   emoji: '⏳', className: 'status-pending' },
  PREPPING:  { label: 'Prepping',  emoji: '🔪', className: 'status-prepping' },
  COOKING:   { label: 'Cooking',   emoji: '🍳', className: 'status-cooking' },
  READY:     { label: 'Ready',     emoji: '✅', className: 'status-ready' },
  COMPLETED: { label: 'Completed', emoji: '🎉', className: 'status-completed' },
  CANCELLED: { label: 'Cancelled', emoji: '❌', className: 'status-cancelled' },
}
```
Both `admin/page.tsx` and `dashboard/page.tsx` import this instead of keeping local copies.
`dashboard/page.tsx`'s badge markup becomes `<span className={ORDER_STATUS_CONFIG[order.status].className}>...`
— the exact same `.status-*` classes the admin sees, closing the visual-clash gap called out in
0.3(3) with zero new CSS.

#### 0.5 Native `<select>` legibility — a real, concrete bug, not a style nit
Three different className treatments exist for native `<select>` elements across the app today:
`bg-transparent border rounded ...` (`OrderClient.tsx`'s status select), `bg-slate-100 dark:bg-
slate-800 border rounded ...` (`OrderDetailsClient.tsx`'s status select — note this uses **raw
Tailwind gray-scale classes, not this app's oklch theme tokens at all** — a third, unrelated color
system), and `border-input bg-transparent ...` (every dish/ingredient/category picker). None of
these set an explicit `color`. Per the web-interface-guidelines: *"native `<select>` needs explicit
`background-color` and `color`"* — and this is not theoretical here: a `bg-transparent` select
inherits whatever's behind it for the closed control's fill, but the browser's native dropdown
*popup list* (the part that opens on click) is rendered by the OS/browser chrome, not by CSS
inheritance, and without `color-scheme: dark` (currently unset — see 0.7) and an explicit `color`,
Windows Chrome/Edge render that popup with default light-mode black-on-white-ish styling — visible,
confirmed browser behavior, not a hypothetical.

**Fix**: every native `<select>` in the app adopts the new `.select-field` class from 0.2 (real
`bg-input` fill, explicit `text-foreground`, a real focus ring) — one class, one place to fix if
the token ever changes, replacing three inconsistent ad hoc treatments. Applies to: `OrderClient.
tsx` (status select, dish picker), `OrderDetailsClient.tsx` (status select, dish/ingredient
pickers), `InventoryClient.tsx` (category select), `MenuClient.tsx`'s `RecipeBuilder` (ingredient
picker).

#### 0.6 `src/lib/dueDate.ts` — unchanged design, corrected test case (see 3 below)
The timezone-pinning design from the prior draft is unchanged and still correct; only the
regression test case had a self-contradiction, fixed in section 3.

#### 0.7 Global accessibility, motion, and touch layer — new `globals.css` rules
A single, hard-to-forget safety net beats auditing every future `transition`/`animation` class by
hand for `prefers-reduced-motion` compliance:

```css
@layer base {
  html {
    color-scheme: dark; /* fixes native scrollbars/form-control chrome; belt-and-suspenders with
                            the Viewport export's colorScheme below, which sets the <meta> tag but
                            doesn't by itself change how this document's own elements render */
  }
  a, button, [role="button"], summary {
    touch-action: manipulation;      /* removes the ~300ms tap delay and double-tap-to-zoom on touch */
    -webkit-tap-highlight-color: transparent; /* intentional: focus-visible rings are the feedback
                                                  mechanism instead — every interactive primitive in
                                                  this app already has one (Button, Input, .select-field) */
  }
}

/* One global reduced-motion override, rather than auditing every transition/animation class for a
   motion-safe: variant individually. Impossible to forget on a class-by-class basis. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`color-scheme: dark` also matters for the raw-`<select>` popup-list rendering discussed in 0.5 —
it and the explicit `.select-field` colors are complementary fixes for the same underlying issue,
not redundant (browsers vary in how completely they honor `color-scheme` alone for native popup
chrome, hence *both*).

A **skip link** is added to `layout.tsx` (first child of `<body>`, visually hidden until
`:focus`), satisfying the guideline's "include a skip link to main content" rule:
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
  Skip to content
</a>
```
`id="main-content"` is added to the `<main>` element in both `AdminLayout.tsx` and
`dashboard/layout.tsx` (the two distinct app shells) as the link's target.

#### 0.8 Files touched — master list
Files already correctly token-based and require **no color-layer changes** (they use `Button`/
`Input`/`Label`/`Dialog`/`Toast`, or already read tokens): `src/components/ui/*`,
`src/components/providers.tsx`, `src/app/dashboard/layout.tsx` (minor — see 5.7).

**This table is now consolidated across all 7 items, including the round-2 decisions (Rostty text
fixes, item 6 cancel-confirm, item 7 inventory archive) — a file listed once here may be touched
for several unrelated reasons; each reason is enumerated, not just the first one found.**

| File | Change |
|---|---|
| `prisma/schema.prisma` | **MODIFY** — `InventoryItem.isActive Boolean @default(true)` (item 7 — this pack's only schema change; see 7.1 and the Rollout Plan's gated migration step) |
| `src/app/globals.css` | MODIFY — foundational: `@layer components` type/spacing/select classes (0.2), badge utilities (0.3), a11y/motion/touch/dark-mode base layer (0.7) |
| `src/lib/orderStatus.ts` | **CREATE** — shared status metadata (0.4) |
| `src/lib/currency.ts` + `.test.ts` | **CREATE** — item 2 |
| `src/lib/dueDate.ts` + `.test.ts` | **CREATE** — item 3 |
| `src/lib/validation.ts` | MODIFY — new `updateOrderDueDateSchema` (item 3) |
| `src/components/ui/skeleton.tsx` | **CREATE** — item 5, loading states (5.8) |
| `src/components/layout/MobileNavTrigger.tsx` | **CREATE** — item 1 |
| `src/components/layout/Sidebar.tsx` | MODIFY — tokens, `onNavigate` prop, real logo, `aria-label` (items 1, 4, 5); Rostty text fix at line 50 (item 4 round 2) |
| `src/components/layout/Header.tsx` | MODIFY — tokens, mobile trigger + logo mark, `Button` for sign-out (items 1, 4, 5) |
| `src/components/layout/AdminLayout.tsx` | MODIFY — `id="main-content"` only (0.7); grid/breakpoints untouched |
| `src/app/layout.tsx` | MODIFY — `metadata.icons`/`manifest`, new `viewport` export, skip link (item 4, 0.7); Rostty text fix in `title`/`description` (item 4 round 2) |
| `public/site.webmanifest` | MODIFY — item 4; `name`/`short_name`/`description` filled in with the Rostty spelling (item 4 round 2) |
| `.env.example` | **No change needed** — already exists with a correct `NEXT_PUBLIC_CURRENCY` entry. Its `FROM_EMAIL` example still says "Rosty," already fixed on `main`@`e692724` — deliberately not re-touched here (see item 4 round 2) |
| `src/lib/notifications/email.ts` | **MODIFY (new to this pack)** — Rostty text fix, `FROM_EMAIL` default + email-template `<h1>` (item 4 round 2) |
| `src/app/admin/page.tsx` | MODIFY — tokens, due-today/overdue stat cards (item 3), shared `orderStatus` import, `loading.tsx` sibling; low-stock query gains `where: { isActive: true }` (item 7, 7.4) |
| `src/app/admin/orders/OrderClient.tsx` | MODIFY — tokens, currency, due-date column/input, `.select-field`, fix broken `DialogTrigger` pattern; cancel-confirm guard on the status select (item 6) |
| `src/app/admin/orders/actions.ts` | MODIFY — call-site only: thread `dueDate` through (signature unchanged, already accepts it). **Not touched for item 6** — `updateOrderStatus`/`leavingCancelled` stay exactly as merged |
| `src/app/admin/orders/[id]/OrderDetailsClient.tsx` | MODIFY — tokens (incl. removing the stray `slate-100/800` classes), currency, inline due-date edit, `.select-field`; cancel-confirm guard (item 6); archived-ingredient `optionsForRow`-equivalent for the extra-ingredients editor (item 7, 7.4) |
| `src/app/admin/orders/[id]/actions.ts` | MODIFY — new `updateOrderDueDate` action. **Not touched for item 6** |
| `src/app/admin/inventory/actions.ts` | **MODIFY (new to this pack)** — corrected `deleteInventoryItem` (fixes the missing `DishIngredient` pre-check, archives on conflict), new `toggleInventoryItemActive`, `getInventoryItems({ includeArchived })` (item 7, 7.2) |
| `src/app/admin/inventory/page.tsx` | **MODIFY (new to this pack)** — `getInventoryItems({ includeArchived: true })`, active-only header count (item 7, 7.3) |
| `src/app/admin/inventory/InventoryClient.tsx` | MODIFY — tokens, category badge map (0.3), `.select-field`, fix broken `DialogTrigger` pattern; `showArchived` toggle + Archive/Restore action + corrected delete-result handling (item 7, 7.3) |
| `src/app/admin/menu/MenuClient.tsx` | MODIFY — tokens, currency, dish-status badges (0.3), `.select-field`; archived-ingredient `optionsForRow`-equivalent for `RecipeBuilder` (item 7, 7.4) |
| `src/app/admin/customers/CustomerClient.tsx` | MODIFY — tokens, fix broken `DialogTrigger` pattern |
| `src/app/dashboard/page.tsx` | MODIFY — currency, shared `orderStatus` badges (0.4), empty-state polish |
| `src/app/dashboard/layout.tsx` | MODIFY — `id="main-content"`, sign-out `Button` swap (minor); Rostty text fix at line 18 (item 4 round 2) |
| `src/app/login/page.tsx` | MODIFY — tokens, `Input`/`Label` reuse, `aria-live` message region; Rostty text fix at line 42 (item 4 round 2) |
| `src/components/layout/LoginSubmitButton.tsx` | **CREATE** — pending-state submit button (5.7) |
| `src/app/page.tsx` | MODIFY — tokens only; no content/logic change; Rostty text fixes at lines 98 and 214 (item 4 round 2) |
| `src/app/admin/loading.tsx`, `.../orders/loading.tsx`, `.../inventory/loading.tsx`, `.../menu/loading.tsx`, `.../customers/loading.tsx`, `src/app/dashboard/loading.tsx` | **CREATE** — item 5, loading states (5.8) |

---

### 1. Mobile-responsive admin nav

**Decision: build the drawer on the existing `dialog.tsx`, do not add a new `sheet.tsx`
primitive.** Base UI's `Dialog.Root` defaults to `modal: true`, which gives, for free: focus trap,
body-scroll lock, Escape-to-close, and focus-return-on-close. A hand-rolled `sheet.tsx` would mean
reimplementing all four (a real, easy-to-get-wrong accessibility surface) to save only CSS
positioning work. Confirmed: no `sheet.tsx` exists in `src/components/ui/` today.

**Resolved risk (was an open question in the prior draft): `DialogClose` works.** A spike against
the real `dialog.tsx` component in this repo confirmed `DialogClose` — including the built-in X
button rendered via `DialogPrimitive.Close render={<Button variant="ghost"/>}` inside
`DialogContent` — dispatches clicks correctly. This is a **different** composition than the
separately-documented-broken `DialogTrigger render={<Button/>}` pattern (AGENTS.md only documents
`Trigger`, not `Close`, as broken). **The drawer uses the default `DialogContent` close button —
no `showCloseButton={false}` workaround, no explicit fallback `onClick` close button.** This
simplifies the prior draft's design.

**New component — `MobileNavTrigger.tsx`** (client component, owns its own `open` state):
```tsx
"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Sidebar } from "./Sidebar"

export function MobileNavTrigger() {
  const [open, setOpen] = useState(false)

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-admin-nav"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="mobile-admin-nav"
          className="mobile-nav-drawer top-0 left-0 h-full w-[280px] max-w-[85vw] translate-x-0
                     translate-y-0 rounded-none gap-0 p-0
                     data-open:slide-in-from-left data-closed:slide-out-to-left
                     data-open:zoom-in-100 data-closed:zoom-out-100 sm:max-w-[85vw]"
        >
          <DialogTitle className="sr-only">Navigation Menu</DialogTitle>
          <Sidebar onNavigate={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
```
The `zoom-in-100`/`zoom-out-100` classes are a deliberate no-op used purely so `tailwind-merge`
recognizes them as the same utility family as `DialogContent`'s base `zoom-in-95`/`zoom-out-95`
and drops the zoom effect — a drawer should slide, not zoom. `tw-animate-css` (already a
dependency) supports `slide-in-from-left`/`slide-out-to-left`, the same `data-open:`/`data-closed:`
attribute-variant idiom `dialog.tsx` already uses.

New `.mobile-nav-drawer` utility (globals.css, 0.7 territory) covers two more web-interface-
guideline rules specific to a full-height edge drawer:
```css
.mobile-nav-drawer {
  overscroll-behavior: contain;                 /* prevents the drawer's own scroll from chaining
                                                    into a rubber-band scroll of the page behind it */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);       /* left-edge drawer — the only inset that matters
                                                     for a notch/rounded-corner device in this
                                                     orientation */
}
```

**Composition — `AdminLayout.tsx` needs zero structural changes.** `Header.tsx` is already an
`async` Server Component; it does not need to become a Client Component to host the trigger — a
Server Component can render a Client Component child without itself crossing the boundary.
`Header.tsx` adds `<MobileNavTrigger />` to its existing left-side JSX. `AdminLayout.tsx`'s
existing `<div className="hidden md:block"><Sidebar /></div>` is untouched — desktop sidebar and
mobile drawer are two independent renderings of the same `Sidebar`, never both visible at once.

**Close-on-navigation, without `useEffect`.** The codebase's established Client Component
convention is `useState` only — no `useEffect` anywhere. `Sidebar.tsx` gets one additive,
backward-compatible prop:
```tsx
export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  // ...
  <nav className="..." aria-label="Admin navigation">
    {/* ... */}
    <Link href={item.href} onClick={() => onNavigate?.()} className="...">
```
The desktop `<Sidebar />` call site passes no prop, so `onNavigate` is `undefined` and the
`onClick` is a no-op — zero behavior change for desktop.

**Accessibility**: hamburger button gets `aria-label`, `aria-expanded`, `aria-controls` (above).
`DialogTitle` (visually hidden via `sr-only`) gives the popup an accessible name via Base UI's
automatic `aria-labelledby` wiring; `DialogPopup` already sets `role="dialog"`/`aria-modal`
internally. `Sidebar`'s `<nav>` gets `aria-label="Admin navigation"` (applies to both desktop and
mobile renderings identically, since it's the same component).

**375px-viewport correctness.** `w-[280px] max-w-[85vw]` is 280px on anything ≥ 330px, and 85% of
viewport width below that — at 375px this is 280px (~75% of the screen), leaving a visible
dismiss-by-tap area on the right, chosen so "tap outside to close" stays reachable one-handed.

---

### 2. Currency localization

**Corrected file:line list — 12 confirmed sites, not 4** (re-audited against the current,
post-Menu-System codebase):
- `src/app/admin/orders/OrderClient.tsx` — table cell (`` `$${info.getValue()}` ``), "Total Price
  ($)" label, dish `<option>` price (`` `${dish.name} ($${dish.price})` ``)
- `src/app/admin/orders/[id]/OrderDetailsClient.tsx` — total price display, per-line unit price,
  per-line total (`unitPrice * quantity`), dish `<option>` price, "Total Price ($)" label
- `src/app/admin/menu/MenuClient.tsx` — table price cell, "Price ($)" label (create form), "Price
  ($)" label (edit form)
- `src/app/dashboard/page.tsx` — `` `$${order.totalPrice.toFixed(2)}` ``

Notification templates (`src/lib/notifications/email.ts`, `sms.ts`) never render `totalPrice` —
no changes needed there. `admin/page.tsx` has no price/revenue rendering — no changes needed there
either.

**Currency decision: NGN (Nigerian Naira), not GHS — unchanged from the prior draft.** Confirmed
by direct evidence in `prisma/seed.ts`: `+234` phone country codes (Nigeria; Ghana is `+233`) and
Nigerian customer names; seeded `totalPrice` magnitudes (₦3,500–₦45,000) are the right order for
Naira retail catering pricing. **Locale: `en-NG`.**

**`src/lib/currency.ts`** (unchanged design from the prior draft — reproduced for completeness,
now also exporting `BUSINESS_LOCALE` for reuse by date-formatting call sites in item 5, so the
locale choice lives in exactly one place):
```ts
export const BUSINESS_LOCALE = "en-NG"
const DEFAULT_CURRENCY = "NGN"

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: "en-NG", GHS: "en-GH", USD: "en-US", GBP: "en-GB", EUR: "en-IE",
}

function resolveCurrencyCode(): string {
  const raw = process.env.NEXT_PUBLIC_CURRENCY?.trim().toUpperCase()
  if (!raw) return DEFAULT_CURRENCY
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: raw }) // throws on invalid ISO 4217
    return raw
  } catch {
    console.warn(`[currency] Invalid NEXT_PUBLIC_CURRENCY="${raw}" — falling back to ${DEFAULT_CURRENCY}.`)
    return DEFAULT_CURRENCY
  }
}

const CURRENCY_CODE = resolveCurrencyCode()
const LOCALE = CURRENCY_LOCALES[CURRENCY_CODE] ?? BUSINESS_LOCALE
const formatter = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY_CODE })

export function formatCurrency(amount: number): string {
  return formatter.format(Number.isFinite(amount) ? amount : 0)
}
export function getCurrencySymbol(): string {
  return formatter.formatToParts(0).find((p) => p.type === "currency")?.value ?? CURRENCY_CODE
}
export function getCurrencyCode(): string {
  return CURRENCY_CODE
}
```

**Call sites** (updated to match the current dish-based screens):
```tsx
// OrderClient.tsx — table cell
cell: (info) => <span className="table-cell-num">{formatCurrency(info.getValue())}</span>,
// OrderClient.tsx — form label
<Label htmlFor="totalPrice">Total Price ({getCurrencySymbol()})</Label>
// OrderClient.tsx — dish picker option
<option key={dish.id} value={dish.id}>{dish.name} ({formatCurrency(dish.price)})</option>

// OrderDetailsClient.tsx
<p><span className="text-muted-foreground font-medium">Total Price:</span> <span className="table-cell-num">{formatCurrency(order.totalPrice)}</span></p>
<td className="table-cell-num">{formatCurrency(orderDish.unitPrice)}</td>
<td className="table-cell-num">{formatCurrency(orderDish.unitPrice * orderDish.quantity)}</td>

// MenuClient.tsx — table price cell
cell: (info) => <span className="font-mono-data table-cell-num text-foreground">{formatCurrency(info.getValue())}</span>,
// MenuClient.tsx — create/edit form labels
<Label htmlFor="price">Price ({getCurrencySymbol()})</Label>

// dashboard/page.tsx
<span className="table-cell-num text-sm font-medium">{formatCurrency(order.totalPrice)}</span>
```

**Why `NEXT_PUBLIC_`, why a shared module, why validated once at module load, why `en-NG`, why
silent-default-on-unset-but-warn-on-invalid** — all unchanged from the prior draft's reasoning;
preserved in Alternatives Considered rather than repeated here.

---

### 3. Due-date / overdue alerting

**`src/lib/dueDate.ts`** — design unchanged from the prior draft (pinned to `Africa/Lagos` via
`Intl.DateTimeFormat`, date-granular not timestamp-granular, injectable `now`):
```ts
import type { OrderStatus } from "@prisma/client"

const BUSINESS_TIMEZONE = "Africa/Lagos" // WAT, UTC+1, no DST

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
})

function toBusinessDateKey(date: Date): string {
  return dateKeyFormatter.format(date) // en-CA locale formats as YYYY-MM-DD
}

export type DueUrgency = "overdue" | "due-today" | "upcoming" | "none"
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["PENDING", "PREPPING", "COOKING", "READY"]

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return (ACTIVE_ORDER_STATUSES as string[]).includes(status)
}

export function getDueUrgency(
  dueDate: Date | string | null | undefined,
  now: Date = new Date()
): DueUrgency {
  if (!dueDate) return "none"
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  if (Number.isNaN(due.getTime())) return "none"

  const dueKey = toBusinessDateKey(due)
  const todayKey = toBusinessDateKey(now)

  if (dueKey < todayKey) return "overdue"
  if (dueKey === todayKey) return "due-today"
  return "upcoming"
}
```
`ACTIVE_ORDER_STATUSES` is the single source of truth for "active," reused in the Prisma `where`
clause (dashboard query) and table row-highlighting — matches the `orderStatus.ts` precedent (0.4).

**Corrected timezone-boundary test case.** The prior draft's case was self-contradictory (it
claimed two instants were "the same UTC calendar day... actually different UTC days already,"
which cannot both be true, and never actually constructed the pair it described). The correct
construction: Lagos is UTC+1, so any instant in the window **23:00:00 UTC through 23:59:59 UTC is
already the next calendar day in Lagos** (00:00–00:59 WAT). Concrete pair:
```ts
// dueDate = 2026-08-17T23:30:00Z is 2026-08-18T00:30 in Lagos — already "tomorrow" locally,
// even though it's still Aug 17 in UTC.
const dueDate = new Date("2026-08-17T23:30:00Z")
// now = 2026-08-18T00:15:00Z is 2026-08-18T01:15 in Lagos — also Aug 18 locally.
const now = new Date("2026-08-18T00:15:00Z")
// UTC calendar days: Aug 17 vs Aug 18 (different) — but Lagos calendar days: Aug 18 vs Aug 18 (SAME).
// A correct Lagos-pinned implementation says "due-today". A naive UTC-based implementation would
// compare Aug 17 < Aug 18 and wrongly say "overdue" — this is exactly the regression this test
// exists to catch.
expect(getDueUrgency(dueDate, now)).toBe("due-today")
```

**Parsing `<input type="date">` values.** Unchanged from the prior draft: a bare `"YYYY-MM-DD"`
string parses as UTC midnight per spec, and because Lagos is only UTC+1, that's still the same
calendar day locally — safe to use `new Date(dueDateStr)` as-is given the Lagos-pinned comparison
function. Documented inline in the code so a future edit doesn't "fix" this into local-time
parsing without understanding the interaction.

**Dashboard widget (`admin/page.tsx`)** — reuses the existing `.stat-card`/`stats` array pattern,
now restyled per 0.2's type scale (`.eyebrow` for the label, `.stat-value` for the number):
```ts
import { ACTIVE_ORDER_STATUSES, getDueUrgency } from '@/lib/dueDate'
import { CalendarClock, CalendarX } from 'lucide-react'

// added to the existing Promise.all(...):
prisma.order.findMany({ where: { status: { in: ACTIVE_ORDER_STATUSES } }, select: { dueDate: true } }),
```
```ts
const dueTodayCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'due-today').length
const overdueCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'overdue').length
```
Two entries appended to `stats`, growing the grid from 4 to 6 cards: change
`sm:grid-cols-2 lg:grid-cols-4` to `sm:grid-cols-2 lg:grid-cols-3` for a clean 2×3 layout.

**Orders table (`OrderClient.tsx`) — new "Due" column + row tint**, now expressed via `cn()` +
Tailwind classes instead of inline `style={{}}` (0.1's foundational fix applied concretely — this
is also what makes `hover:` on the row possible, which inline styles could not do):
```tsx
columnHelper.accessor("dueDate", {
  header: "Due",
  cell: (info) => {
    const dueDate = info.getValue()
    const urgency = isActiveOrderStatus(info.row.original.status) ? getDueUrgency(dueDate) : "none"
    if (!dueDate) return <span className="meta-text">—</span>
    const label = dueDate.toLocaleDateString(BUSINESS_LOCALE, { month: 'short', day: 'numeric' })
    if (urgency === 'overdue')   return <span className="due-overdue"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overdue · {label}</span>
    if (urgency === 'due-today') return <span className="due-today"><Clock className="h-3 w-3" aria-hidden="true" /> Due Today</span>
    return <span className="meta-text">{label}</span>
  },
}),
```
```tsx
// row className, replacing the inline style={{ background, borderBottom }} ternary
const urgency = isActiveOrderStatus(row.original.status) ? getDueUrgency(row.original.dueDate) : "none"
<tr className={cn(
  "table-row cursor-pointer",
  urgency === 'overdue'   && 'bg-destructive/8 hover:bg-destructive/12',
  urgency === 'due-today' && 'bg-primary/6 hover:bg-primary/10',
  urgency === 'none'      && (idx % 2 === 0 ? 'bg-card/40' : ''),
)}>
```
`bg-destructive/8`/`bg-primary/6` are the exact same alpha-composited colors the prior draft used
inline (`--destructive` **is** `oklch(0.62 0.22 25)`, `--primary` **is** `oklch(0.72 0.15 65)`) —
this is a value-preserving conversion from inline style to token-driven class, not a new palette
choice, and it's what unlocks the `hover:` variant on the same line.

**Accessibility**: the badge always pairs an icon (with `aria-hidden="true"`, since it's
decorative alongside the text, not the sole carrier of meaning) with text ("Overdue"/"Due Today"),
never color alone.

**Create-form due-date input (`OrderClient.tsx`)** — added to the existing form, next to Total
Price:
```tsx
<div className="space-y-2">
  <Label htmlFor="dueDate">Due Date (Optional)</Label>
  <Input id="dueDate" name="dueDate" type="date" autoComplete="off" />
</div>
```
`handleAdd` gains one line before calling `createOrder` — **the call site now matches the current,
dish-based `createOrder` signature**, correcting the prior draft's stale `{ ingredients }` payload:
```ts
async function handleAdd(formData: FormData) {
  const customerId = formData.get("customerId") as string
  const description = formData.get("description") as string
  const totalPrice = Number(formData.get("totalPrice"))
  const dueDateStr = formData.get("dueDate") as string
  const dueDate = dueDateStr ? new Date(dueDateStr) : null
  const orderedDishes = selectedDishes.filter(d => d.dishId && d.quantity > 0)

  const result = await createOrder({ customerId, description, totalPrice, dueDate, dishes: orderedDishes })
  // ...unchanged result.ok handling...
}
```
No change needed to `createOrder`'s exported signature in `actions.ts` — it already accepts
`dueDate?: Date | null` and already writes it (`dueDate: input.dueDate ?? null`), and
`createOrderSchema` in `src/lib/validation.ts` already validates it (`dueDate: z.date().nullish()`)
— this was, notably, already-implemented-but-unreachable code before this pack's call-site change.

**Inline due-date edit (`OrderDetailsClient.tsx` + new, correctly-gated `[id]/actions.ts`
action).** **This is the most significant correction to item 3**: the prior draft's
`updateOrderDueDate` sketch had no `requireAdmin()` call, no zod validation, and returned a bare
`void` instead of an `ActionResult` — it predates the integrity-hardening RFC landing on this
branch and, if implemented as originally written, would be the *only* mutating action in
`orders/[id]/actions.ts` without authorization or validation, directly regressing that hardening
work. Corrected to match `updateOrderItems`' exact pattern in the same file:

```ts
// src/lib/validation.ts — new schema, same file/idiom as every other schema
export const updateOrderDueDateSchema = z.object({
  id: idSchema,
  dueDate: z.date().nullish(),
})
```
```ts
// [id]/actions.ts — new export
import { updateOrderDueDateSchema } from '@/lib/validation'

export async function updateOrderDueDate(id: string, dueDate: Date | null): Promise<ActionResult<Order>> {
  await requireAdmin()

  let order: Order
  try {
    const input = updateOrderDueDateSchema.parse({ id, dueDate })
    order = await prisma.order.update({
      where: { id: input.id },
      data: { dueDate: input.dueDate ?? null },
    })
  } catch (err) {
    return toErrorResult(err, "Could not update this order's due date.")
  }

  revalidatePath(`/admin/orders/${id}`)
  revalidatePath('/admin/orders')
  return okResult(order)
}
```
`toErrorResult` already converts a Prisma `P2025` (row not found — e.g. deleted in another tab
concurrently) into a clean `NOT_FOUND` result; no extra existence check needed, matching the
existing convention in this file.

```tsx
// OrderDetailsClient.tsx — next to the existing status <select>, using the new .select-field-
// adjacent input treatment and the ActionResult contract every other mutation here already uses
<div className="flex items-center gap-2 mt-2">
  <Label htmlFor="dueDate" className="text-muted-foreground">Due Date:</Label>
  <input
    id="dueDate"
    type="date"
    autoComplete="off"
    defaultValue={order.dueDate ? order.dueDate.toISOString().slice(0, 10) : ''}
    onChange={async (e) => {
      const val = e.target.value ? new Date(e.target.value) : null
      try {
        const result = await updateOrderDueDate(order.id, val)
        if (!result.ok) {
          alert(result.error)
          return
        }
        router.refresh()
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not update this due date.')
      }
    }}
    className="select-field w-auto"
  />
</div>
```

---

### 4. Brand assets + PWA install

Unchanged from the prior draft in substance; folded structurally into the Sidebar/Header rewrite
in section 5 since it's the same files. Summary (full reasoning preserved from the prior draft),
**plus the now-resolved spelling decision and its full text-fix task list below**:

- `rosty-logo.jpeg` and the pre-generated `android-chrome-512x512.png` both have a **solid opaque
  white background** (confirmed by direct inspection) and both render the wordmark as "**Rostty**"
  (double-t) — consistent across the asset set, not a one-off glitch. Fine as-is for
  favicon/manifest usage (icons always sit in an isolated square context); needs a small white
  "logo chip" (`bg-white`, rounded, `object-contain`) wherever used inline in the app's dark
  chrome, otherwise the white edge reads as a rendering glitch. **This white-chip treatment is
  unaffected by the spelling decision below** — it exists because of the JPEG's opaque background,
  a purely visual/technical concern, not because of anything about the wordmark's text.

**RESOLVED: "Rostty" (double-t) is the correct spelling — the prior draft's Open Question is
closed.** The image assets were always right; the app's own text had the typo. Nine occurrences
across six files, confirmed by a case-insensitive grep (a naive case-sensitive `grep 'Rosty'` would
miss the two `ROSTY`/uppercase ones):

| File:line | Current text | Corrected to |
|---|---|---|
| `src/components/layout/Sidebar.tsx:50` | `ROSTY` | `ROSTTY` |
| `src/app/page.tsx:98` | `ROSTY` | `ROSTTY` |
| `src/app/page.tsx:214` | `© 2025 CHOP WITH ROSTY — ALL RIGHTS RESERVED` | `© 2025 CHOP WITH ROSTTY — ALL RIGHTS RESERVED` |
| `src/app/layout.tsx:20` | `title: "Chop with Rosty — Kitchen Command Center"` | `"Chop with Rostty — Kitchen Command Center"` |
| `src/app/layout.tsx:21` | `description: "...for Chop with Rosty"` | `"...for Chop with Rostty"` |
| `src/app/login/page.tsx:42` | `Chop with Rosty` | `Chop with Rostty` |
| `src/app/dashboard/layout.tsx:18` | `🍽️ Chop with Rosty` | `🍽️ Chop with Rostty` |
| `src/lib/notifications/email.ts:11` | `FROM_EMAIL` default `'Chop with Rosty <onboarding@resend.dev>'` | `'Chop with Rostty <onboarding@resend.dev>'` |
| `src/lib/notifications/email.ts:49` | `<h1 ...>🍽️ Chop with Rosty</h1>` | `🍽️ Chop with Rostty` |

**Out of scope, deliberately not touched**: `.env.example`'s `FROM_EMAIL` example value still
reads "Chop with Rosty" in this worktree as of this revision. This has already been corrected
directly on `main` (commit `e692724`) as a doc-only fix — re-editing it here would risk a spurious
conflict against that commit when this branch next rebases/merges, for a file this pack doesn't
otherwise touch. Left as-is intentionally; will arrive correctly via the next rebase.

The `next/image` `alt` text on the logo-chip (below) and `public/site.webmanifest`'s `name`/
`short_name`/`description` (which were empty/unset, not merely misspelled) are updated to the
correct "Rostty" spelling as part of this same change — not a separate task, since both files are
already being touched in this section.
- First `next/image` usage in this codebase (confirmed via grep — the only prior hit is a routing-
  matcher comment in `src/proxy.ts`, not component usage). Since `rosty-logo.jpeg` is a
  `public/`-folder asset referenced by URL string (not a static import — `public/` isn't under the
  `@/*` alias), Next can't infer intrinsic size — use `fill` + a sized `relative` parent +
  `object-contain`, not guessed hardcoded `width`/`height`.
- `layout.tsx`'s `themeColor`/`colorScheme` must be a separate `export const viewport: Viewport`,
  **not** inside `metadata` — confirmed by reading
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` directly;
  `themeColor` inside `metadata` is deprecated as of Next.js 14 and silently no-ops in this
  version rather than warning.
```tsx
// layout.tsx
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Chop with Rostty — Kitchen Command Center",
  description: "Enterprise order and inventory management for Chop with Rostty",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0b0a", // approximates --background: oklch(0.08 0.004 65); verify against
                          // devtools computed style before shipping
  colorScheme: "dark",
};
```
- `metadata.icons`/`metadata.manifest` (not the `app/icon.png` file-convention) are correct here
  because all seven brand assets already live in committed `public/` files, not `app/`.
- `public/site.webmanifest` fixes: empty `name`/`short_name`, missing `start_url`, and
  `theme_color`/`background_color` set to white on a permanently-dark app (a white splash-screen
  flash before the dark UI paints):
```json
{
  "name": "Chop with Rostty",
  "short_name": "Rostty",
  "description": "Kitchen order & inventory command center for Chop with Rostty",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0d0b0a",
  "theme_color": "#0d0b0a",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```
`start_url: "/"` (not `/admin`) is deliberate: `src/app/page.tsx` is already a fully-built
auth-redirect hub that correctly routes an installed-icon launch to `/admin` or `/dashboard`
depending on who's logged in.

**Sidebar/Header logo placement** — now specified against the *redesigned* Sidebar/Header markup
in section 5.2, not the current inline-styled version, since both files are being rewritten in
the same diff:
```tsx
<div className="relative flex h-8 w-8 items-center justify-center rounded overflow-hidden bg-white p-1">
  <Image src="/rosty-logo.jpeg" alt="Chop with Rostty" fill className="object-contain" />
</div>
```
(The asset's filename, `rosty-logo.jpeg`, keeps its existing single-t spelling — renaming a
committed binary asset for a text-only correction is unnecessary churn; only user-visible text
changes.)

---

### 5. Enterprise-grade UI overhaul

Per-surface treatment. Every surface below applies 0.1–0.7's foundations (tokens replace inline
`oklch`, the new `.page-title`/`.eyebrow`/`.section-title`/`.stat-value`/`.meta-text`/
`.table-head-cell`/`.select-field` classes, `tabular-nums` on numeric columns, real focus/hover
states now that inline styles are gone). What's listed per surface below is what's *specific* to
that surface, not a repeat of the shared foundation.

#### 5.1 `src/lib/orderStatus.ts` — see 0.4. Shared by 5.3 and 5.7.

#### 5.2 Admin shell — `Sidebar.tsx`, `Header.tsx`, `AdminLayout.tsx`
- `Sidebar.tsx`: replace all 12 inline-`oklch` sites with token classes (`bg-sidebar`,
  `text-sidebar-foreground`, `border-sidebar-border`; active nav item →
  `bg-sidebar-accent text-sidebar-primary border-l-2 border-sidebar-primary`, inactive →
  `text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50` — the `hover:`
  variant is new; it was impossible to express with the prior inline-style implementation). Nav
  group labels use `.eyebrow`. Brand mark becomes the real logo-chip (item 4). Adds the
  `onNavigate` prop (item 1) and `aria-label="Admin navigation"` on `<nav>`.
- `Header.tsx`: replace all 9 inline-`oklch` sites with tokens, consolidating the header's
  slightly-different-from-card background (`oklch(0.09...)` vs. `--card`'s `oklch(0.11...)`, an
  imperceptible, unintentional-looking difference) onto `bg-card`/`border-border` directly rather
  than inventing a dedicated header token for a distinction nobody can see. Adds
  `<MobileNavTrigger />` (item 1) and a small logo mark (item 4, `h-6 w-6`, since the header is the
  *only* persistently-visible brand chrome on mobile once the sidebar is hidden). The sign-out
  `<button>` (currently a raw styled element) becomes `<Button variant="ghost" size="sm">` —
  picking up a real focus ring and hover state for free instead of hand-rolling both.
- `AdminLayout.tsx`: **only** change is `id="main-content"` on the `<main>` element (0.7's skip
  link target). Grid/breakpoint structure is untouched, matching item 1's original finding that
  this file doesn't need to change for the drawer to work.

#### 5.3 Dashboard — `admin/page.tsx`
- Page header restyled with `.page-title`/`.meta-text`; the "LIVE DATA" pill becomes a token-based
  badge instead of inline `oklch`.
- Stat cards (existing 4 + new 2 from item 3) restyled: `.eyebrow` for the label, `.stat-value`
  for the number (picks up `tabular-nums` automatically), icon chip uses `bg-primary/10`/
  `text-primary` (alert state: `bg-destructive/12`/`text-destructive`) instead of inline
  conditional `style` objects.
- Order-pipeline cards and the recent-orders table: same token/type-scale treatment; recent-orders
  table's status badges now import from `orderStatus.ts` (0.4) instead of the local
  `statusConfig` object, so this becomes the *canonical* copy the customer dashboard also reads.
- Empty state ("No orders yet.") gets a small icon + message treatment (5.9) instead of a bare
  gray text row.
- Date header (`new Date().toLocaleDateString(...)`) is server-rendered text with no client-side
  re-render — **no hydration-mismatch risk here** (see 5.10 for where the real hydration risk
  actually lives). Switched to `BUSINESS_LOCALE` (`en-NG`, imported from `src/lib/currency.ts`)
  instead of the current hardcoded `'en-US'`, for consistency with the rest of the app's locale
  choice — a one-word change, not a new formatting mechanism.

#### 5.4 Orders — `OrderClient.tsx`, `OrderDetailsClient.tsx`
- Table chrome (header row, zebra striping, empty state) restyled per 0.2 (`.table-head-cell`,
  `.table-row`); Total column gets `.table-cell-num`.
- **Fixes the broken `DialogTrigger render={<Button/>}` "Create Order" trigger** — this file is
  already being touched for currency + due-date + the visual pass, so the one-line fix (matching
  `MenuClient.tsx`'s already-correct direct-`onClick` pattern) rides along at effectively zero
  incremental risk:
  ```tsx
  // Before: <DialogTrigger render={<Button />}>Create Order</DialogTrigger>
  const [isOpen, setIsOpen] = useState(false) // already exists
  <Button onClick={() => setIsOpen(true)}>Create Order</Button>
  <Dialog open={isOpen} onOpenChange={setIsOpen}>
    <DialogContent>{/* DialogTrigger import removed */}</DialogContent>
  </Dialog>
  ```
  RTL-based tests locate this button by role/accessible name (`getByRole('button', { name: /create order/i })`),
  not by the `DialogTrigger`/`Button` composition detail — this change should not require test
  updates, but **must be spot-checked against `OrderClient.test.tsx` during implementation**,
  since that file's own docstring is specifically about this exact composition pattern (see
  Testing Strategy).
- Status and dish `<select>`s adopt `.select-field` (0.5).
- Due-date column + row tint (item 3), create-form due-date input (item 3).
- `OrderDetailsClient.tsx`: replaces the stray `bg-slate-100 dark:bg-slate-800` status-select
  classes and the `text-slate-500` labels (a third, unrelated color system found during the audit
  — this file is the only one in the app using raw Tailwind gray-scale instead of either the oklch
  literals or the theme tokens) with `.select-field` and `text-muted-foreground` respectively.
  Adds the inline due-date edit control (item 3).

#### 5.5 Inventory — `InventoryClient.tsx`
- Table chrome per 0.2; `StockBadge`'s progress-bar fill color switches from an inline
  conditional-`oklch` object to a small static class map (`stock-critical`/`stock-warning`/
  `stock-ok` → `bg-destructive`/`bg-primary`/`bg-chart-3` for the fill bar specifically, reusing
  the same three tokens the existing `.stock-*` badge classes already encode).
- Category badges: the `categoryColors` string-concatenation map is replaced by the static
  `categoryBadgeClass` Tailwind-class map from 0.3.
- **Fixes the broken `DialogTrigger render={<Button/>}` "Add Item" trigger**, same treatment and
  same reasoning as 5.4.
- Category `<select>` (create form) adopts `.select-field`.

#### 5.6 Menu — `MenuClient.tsx`
- Table chrome per 0.2; price column gets `.table-cell-num` + currency formatting (item 2).
- Dish-status badges (`ACTIVE`/`ARCHIVED`): the `statusColors` string-concatenation map is
  replaced by the new `.dish-active`/`.dish-archived` classes (0.3).
- `RecipeBuilder`'s ingredient `<select>` adopts `.select-field`. This file already uses the
  correct direct-`onClick` "Add Dish" trigger (confirmed by its own inline comment referencing
  AGENTS.md) — no trigger fix needed here.

#### 5.7 Customers — `CustomerClient.tsx`
- Table chrome per 0.2 only (no currency/due-date surface on this screen).
- **Fixes the broken `DialogTrigger render={<Button/>}` "Add Customer" trigger**, same treatment
  as 5.4/5.5.

#### 5.8 Customer-facing pages — `dashboard/page.tsx`, `dashboard/layout.tsx`, `login/page.tsx`, `page.tsx`
- `dashboard/page.tsx`: the local `statusColors`/`statusEmojis` light-pastel maps are deleted and
  replaced by `ORDER_STATUS_CONFIG` from `orderStatus.ts` (0.4) — this is the fix for the
  visual-clash finding in 0.3(3): the customer's own order-history badges become the *same*
  dark-theme-correct `.status-*` classes the admin already sees, not a lookalike. Currency (item
  2) applied to the price display. Empty states get the same icon+message treatment as 5.9.
- `dashboard/layout.tsx`: minor — `id="main-content"` (0.7), sign-out `<button>` becomes
  `<Button variant="ghost" size="sm">` (same reasoning as 5.2's Header change). Already mostly
  token-based (`bg-muted/40`, `text-muted-foreground`) — smallest diff of any file in this pack.
- `login/page.tsx`: replaces all 21 inline-`oklch` sites with tokens, and — a **behavior-neutral,
  UI-only** change worth calling out explicitly since it's the one place this pack touches a form
  submission's affordance rather than pure color/spacing — swaps the raw `<input>`/`<button>` for
  the app's existing `Input` component and a new small pending-state submit button:
  ```tsx
  // src/components/layout/LoginSubmitButton.tsx — first use of useFormStatus in this codebase
  "use client"
  import { useFormStatus } from "react-dom"
  import { Button } from "@/components/ui/button"

  export function LoginSubmitButton() {
    const { pending } = useFormStatus()
    return (
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send Magic Link"}
      </Button>
    )
  }
  ```
  `useFormStatus` must be called from a component that is a **child** of the `<form>`, which is
  why this is a new, separate Client Component rather than a change inline in the (Server
  Component) `login/page.tsx` — `login/page.tsx` itself stays a Server Component; only the button
  crosses the client boundary, and the `formAction={login}` prop, the server action itself, and
  the redirect-on-success behavior are all completely unchanged. The status/error message region
  (`resolvedSearchParams?.message`) gets `role="status" aria-live="polite"` so a screen-reader
  user is told about a validation/success message without needing to re-scan the page — this is
  the guideline's "async updates need `aria-live=\"polite\"`" rule, applied to a message that
  currently just silently appears. The existing `you@example.com` placeholder is left as-is — the
  "placeholders end with `…`" guideline governs in-progress/loading text, not example values, and
  misapplying it here would actually make the placeholder read worse, not better.
- `page.tsx` (landing): all 23 inline-`oklch` sites replaced with tokens; hero wordmark and stat
  row restyled with `.page-title`/`.eyebrow`. **No content or logic change** — same redirect hub
  behavior, same copy, same links. Small a11y cleanup: the purely decorative divider lines and
  bullet dots (`h-px w-10`, `h-2 w-2 rounded-full`) get `aria-hidden="true"`, since they currently
  expose empty, meaningless nodes to the accessibility tree.

#### 5.9 Empty states
Every table's existing "No X yet/found." row is upgraded from a bare centered gray-text `<td>` to
an icon + primary message + (where applicable) a one-line hint, still inside the same `<tr>`/
`colSpan` structure — no new component, no new state, just more considered content for a state
that was already handled (never a broken/blank render for an empty array, which was already true
before this pack and remains true). Example (`OrderClient.tsx`):
```tsx
<td colSpan={columns.length} className="px-4 py-16 text-center">
  <ShoppingCart className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
  <p className="mt-3 text-sm font-medium text-foreground">No orders yet</p>
  <p className="mt-1 text-xs text-muted-foreground">Orders you create will show up here.</p>
</td>
```

#### 5.10 Loading states — `loading.tsx` files + new `src/components/ui/skeleton.tsx`
Next.js's `loading.tsx` file convention automatically wraps a route segment in a `<Suspense>`
boundary — this is purely additive (a new static file per route), requires no change to any
existing `page.tsx`, and cannot break existing data-fetching behavior. New shared primitive,
matching the existing shadcn-style primitive convention in `src/components/ui/`:
```tsx
// src/components/ui/skeleton.tsx
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)} {...props} />
}
export { Skeleton }
```
`motion-safe:` (not a bare `animate-pulse`) is deliberate belt-and-suspenders with 0.7's global
`prefers-reduced-motion` override — the global rule alone already neutralizes the animation
duration, but scoping the class itself communicates intent at the call site too. Each
`loading.tsx` composes `<Skeleton>` rectangles roughly matching that route's real layout (a row of
`.stat-card`-shaped skeletons for `/admin`, a table-shaped skeleton for `/admin/orders`, etc.) —
intentionally simple, not pixel-perfect content-aware skeletons.

**Hydration-safety note specific to this component**: `Skeleton` renders no dynamic data (no
dates, no counts, no user-specific content) — it is server-renderable with byte-identical output
on the client, so it introduces no hydration-mismatch risk. See 5.11 for the one place in this
pack where that risk is real.

#### 5.11 Hydration safety — where the real risk is, and where it isn't
The guideline flags date/time rendering as a real hydration-mismatch risk when server and client
disagree. Auditing every date-rendering call site added or touched by this pack:
- **`admin/page.tsx`'s date header, `dashboard/page.tsx`'s order dates, `OrderClient.tsx`'s due
  column** — all render inside **Server Components** (`admin/page.tsx`, `dashboard/page.tsx`) or
  from **server-provided `initialData`** rendered synchronously on first client render before any
  user interaction (`OrderClient.tsx`). None of these call `new Date()` (an inherently
  non-deterministic, environment-dependent value) *during render* — they format an already-fixed
  `Date` value (`order.createdAt`, `order.dueDate`) that is identical on server and client because
  it came from the same serialized prop. **No hydration risk.**
- **`getDueUrgency`'s default `now = new Date()`** — this default parameter only matters if a
  caller omits `now`. Every call site added by this pack (`admin/page.tsx`'s dashboard query,
  `OrderClient.tsx`'s due column) is inside a Server Component or a value computed once from
  server-provided data — meaning `now` is effectively evaluated once, server-side, per request,
  not independently on the client. **This is the one place a genuine risk was theoretically
  possible** (if a future change called `getDueUrgency` with no `now` argument from inside a
  Client Component's render body, the server-rendered urgency and the client-hydrated urgency
  could disagree by the few hundred milliseconds between SSR and hydration, and — far more
  seriously — near the Lagos day boundary, could disagree by an entire day if the SSR pass and the
  hydration pass straddle midnight WAT). This is exactly why `now` is a parameter, not an internal
  call, in the module's design: **any future client-side call site must pass an explicit,
  server-sourced `now`** (e.g. threaded down as a prop from the Server Component that already
  fetched it), never call `new Date()` itself inside a Client Component's render body. This
  constraint is now stated explicitly in the module's own doc comment, not just implied by the
  function signature.

---

### 6. Order cancellation — confirm-before-cancel (client-side only)

**Hard constraint, restated because it's the single most important thing to get right in this
section**: `updateOrderStatus` and its `leavingCancelled` rejection logic in
`src/app/admin/orders/actions.ts` are **already merged and already tested** and **do not change at
all** in this section. This is purely a client-side guard added *before* the existing action is
called — the Server Action's contract, its validation, and its cancellation-is-terminal behavior
are untouched. `deleteOrder`, `updateOrderItems`, and every other action in this file are likewise
untouched.

**Why a confirm, not an undo window.** The web-interface-guidelines rule this pack is measured
against says destructive actions need "a confirmation modal or undo window." An undo window is not
viable here: undoing a cancellation would mean reversing it, which is exactly the un-cancel flow
the user explicitly rejected (re-deducting stock through the guarded path, reopening exactly the
integrity-hardening work closed). A confirmation *before* the irreversible action is therefore the
only one of the guideline's two options that's actually compatible with cancellation staying
terminal — this isn't a partial implementation of the guideline, it's the correct one of its two
named mechanisms for this specific action.

**Why `window.confirm()`, not the `toast` system.** `InventoryClient.tsx`, `CustomerClient.tsx`,
and `MenuClient.tsx`'s delete flows all already gate on native `confirm()` before calling their
delete action. Introducing a toast-based confirmation here would mean this pack's newest
destructive-action guard uses a *different* mechanism than every existing one — the opposite of
the consistency this whole pass is trying to build. `confirm()` is the established pattern; this
change follows it. **This does not resolve the deferred `alert()`/`confirm()` → `toast` migration
question (PRD Open Questions)** — it deliberately does the consistent thing with what exists today.
If that migration ever happens, this cancel-confirmation moves with it, in the same pass, not left
behind as a holdout old-pattern call site.

**Change — `OrderClient.tsx`'s status `<select>`:**
```tsx
onChange={async (e) => {
  const val = e.target.value as OrderStatus
  if (val === 'CANCELLED') {
    const confirmed = confirm(
      `Cancel order #${info.row.original.shortId}? This cannot be undone — a new order must be ` +
      `created if this was a mistake.`
    )
    if (!confirmed) return // controlled <select> reverts to `data`'s current value on its own —
                            // the exact same mechanism already used below when result.ok is false
  }
  try {
    const result = await updateOrderStatus(info.row.original.id, val)
    // ...unchanged...
```

**Change — `OrderDetailsClient.tsx`'s status `<select>`:** identical guard, same message shape,
referencing `order.shortId` (already in scope) instead of `info.row.original.shortId`.

No shared helper/constant is introduced for the two-line guard or the confirm message — this is
two call sites, and the codebase's established grain (documented in `AGENTS.md` and this repo's
own conventions) is per-screen duplication over introducing the app's first shared UI-interaction
abstraction for a two-line snippet.

**Why this is safe against the `disabled` attribute already on both selects.** Both selects already
render `disabled={status === 'CANCELLED'}` — once an order *is* cancelled, its select can't be
interacted with at all, so the new confirm can only ever fire on the "entering `CANCELLED`"
transition, never on an already-cancelled row. This means the client-side guard's scope is
naturally, structurally limited to exactly the transition Decision 2 asks it to guard — no extra
condition needed to exclude the already-cancelled case.

**Testing consequence — required, not optional, per the addendum from the orchestrator.** `jsdom`
does not implement `window.confirm`; the existing suite already emits "Not implemented: window.
alert()"-class warnings for calls it doesn't stub. Left unstubbed, `window.confirm()` returns
`undefined` in jsdom (not a throw), which is falsy — so **any existing or new component test that
exercises the cancel path without stubbing `confirm` will silently take the "declined" branch every
time**, meaning `updateOrderStatus` never gets called and a test asserting the cancel flow works
would fail (or, worse, a test that doesn't assert on this at all would pass while silently never
exercising the path it thinks it's testing). Any test added or touched for the cancel path must
stub it explicitly:
```ts
beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true) // or .mockReturnValue(false) for the
                                                       // decline-path test case
})
```
This is a note **for the test-engineer**, not a new test this TDD is authoring — per the Testing
Strategy's existing scope boundary, this pack's own component-level changes don't get new
automated coverage unless they change an accessible name/role/label (they don't, here — the
`<select>`'s options and behavior are otherwise unchanged). If a future pass does add coverage for
this path, this stubbing requirement is the reason it must, not a nice-to-have.

---

### 7. Inventory archive/retire

**A real feature addition, not a design-only change** — approved as its own coherent unit even
though it touches `InventoryClient.tsx`, a file the design overhaul also restyles. Mirrors the
already-shipped `Dish`/`deleteDish`/`toggleDishActive` pattern (`src/app/admin/menu/actions.ts`)
onto `InventoryItem`, extended to fit `inventory/actions.ts`'s stricter, already-established
`requireAdmin()` + zod + `ActionResult` contract (Dish's actions predate that contract and don't
use it — this section explicitly does **not** copy Dish's looser shape; it extends Inventory's own
existing, stricter one, per the instruction to "extend within that pattern, do not bypass it").

#### 7.1 Schema change — the first in this pack
```prisma
model InventoryItem {
  id               String   @id @default(uuid())
  name             String
  category         Category
  unit             String
  currentStock     Float    @default(0)
  minimumThreshold Float    @default(0)
  isActive         Boolean  @default(true)   // NEW
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  orderLogs        OrderIngredientLog[]
  dishIngredients  DishIngredient[]
}
```
`InventoryItem` is referenced by **two** relations, neither with an `onDelete` clause (both
default to `RESTRICT`, matching this schema's established convention — see AGENTS.md/memory on
"no `onDelete` anywhere, clean up explicitly in app code"): `OrderIngredientLog.inventoryItem` and
`DishIngredient.inventoryItem`. This is precisely why archiving is required, not a nice-to-have —
a referenced row genuinely cannot be hard-deleted at the database level.

`@default(true)` makes this an **additive, non-destructive, backward-compatible** column: Postgres
backfills every existing row with `true` at `ADD COLUMN` time (via `prisma db push`'s generated
DDL). No existing `InventoryItem` row's meaning changes, and — critically — **no reseed is
required or should be run**: `prisma/seed.ts` opens with a sequence of `deleteMany()` calls (it is
a full wipe-and-repopulate script, not an incremental one), so casually re-running it against
either database as a "just to be safe" step would destroy existing fixture/dev data for no reason.
See 7.4 for the exact, gated procedure this schema change requires before any application code
depending on it can land.

#### 7.2 `src/app/admin/inventory/actions.ts` — corrected `deleteInventoryItem` + new `toggleInventoryItemActive`

**`deleteInventoryItem`'s existing pre-check has a real bug** (found while designing this section,
not a hypothetical): it only counts `OrderIngredientLog` rows, never `DishIngredient` rows. A dish
recipe can reference an ingredient that's never actually been ordered — that ingredient currently
passes the existing pre-check, then the `prisma.inventoryItem.delete()` call itself throws a raw
`P2003`, caught by `toErrorResult`'s generic FK-constraint branch instead of the specific, useful
message the pre-check exists to produce. This section's corrected version fixes that bug and adds
the archive-instead-of-error behavior in the same change:

```ts
export async function deleteInventoryItem(id: string): Promise<ActionResult<{ archived: boolean }>> {
  await requireAdmin()

  try {
    const parsedId = idSchema.parse(id)

    // Two independent FK sources reference InventoryItem — a dish's recipe can reference an
    // ingredient that has never actually been ordered, so checking only OrderIngredientLog (the
    // historical-usage table) would let a hard-delete through here and then fail at the DB the
    // moment a DishIngredient row also pointed at it. Both must be checked.
    const [orderUsageCount, recipeUsageCount] = await Promise.all([
      prisma.orderIngredientLog.count({ where: { inventoryItemId: parsedId } }),
      prisma.dishIngredient.count({ where: { inventoryItemId: parsedId } }),
    ])

    if (orderUsageCount > 0 || recipeUsageCount > 0) {
      // Referenced somewhere — archive instead of erroring, exactly like deleteDish.
      await prisma.inventoryItem.update({ where: { id: parsedId }, data: { isActive: false } })
      revalidatePath('/admin/inventory')
      return okResult({ archived: true })
    }

    await prisma.inventoryItem.delete({ where: { id: parsedId } })
  } catch (err) {
    return toErrorResult(err, 'Could not delete this inventory item. Please try again.')
  }

  revalidatePath('/admin/inventory')
  return okResult({ archived: false })
}

export async function toggleInventoryItemActive(id: string, isActive: boolean): Promise<ActionResult<InventoryItem>> {
  await requireAdmin()

  let item: InventoryItem
  try {
    const parsedId = idSchema.parse(id)
    item = await prisma.inventoryItem.update({ where: { id: parsedId }, data: { isActive } })
  } catch (err) {
    return toErrorResult(err, 'Could not update this inventory item.')
  }

  revalidatePath('/admin/inventory')
  return okResult(item)
}
```
`deleteInventoryItem`'s return type changes from `ActionResult<void>` to
`ActionResult<{ archived: boolean }>` — a call-site change in `InventoryClient.tsx` (7.3) is
required; this is a controlled, single-caller breaking change to an internal action signature, not
a public API. `toggleInventoryItemActive` gives the admin an **explicit, manual** archive/restore
action, separate from `deleteInventoryItem`'s automatic-archive-on-conflict fallback — mirroring
`toggleDishActive`'s relationship to `deleteDish` exactly. Both new/changed exports use `idSchema`
(Inventory's existing, stricter validation convention), not Dish's looser unvalidated `id: string`.

**`getInventoryItems` gains an optional `includeArchived` flag, defaulting to active-only** — this
is the single enforcement point for "what counts as a selectable/usable inventory item," matching
the same one-source-of-truth philosophy already used for `ACTIVE_ORDER_STATUSES` (`dueDate.ts`) and
`ORDER_STATUS_CONFIG` (`orderStatus.ts`) elsewhere in this pack:
```ts
export async function getInventoryItems(
  options: { includeArchived?: boolean } = {}
): Promise<InventoryItem[]> {
  await requireAdmin()
  return await prisma.inventoryItem.findMany({
    where: options.includeArchived ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
  })
}
```
Backward compatible: every existing no-argument call site (`menu/page.tsx`, `orders/page.tsx`,
`orders/[id]/page.tsx`) automatically starts receiving **only active items** with **zero changes to
those three call sites** — which is exactly the correct behavior for all three, since all three use
the result as picker/reference data (menu's recipe builder, the order-detail extra-ingredients
editor, and `OrderClient`'s currently-unused-but-fetched `inventory` prop), never as a management
view. Only `inventory/page.tsx` (7.3) is changed, to explicitly opt into `{ includeArchived: true }`.

#### 7.3 UI — `InventoryClient.tsx` (archive/restore, reveal toggle) and `inventory/page.tsx`
`inventory/page.tsx` changes its one query call and its header count computation:
```ts
const items = await getInventoryItems({ includeArchived: true })
const activeCount = items.filter(i => i.isActive).length
// header text uses activeCount, not items.length — "N items tracked" should mean actively
// tracked; archived items are still fetched (for InventoryClient's reveal toggle) but shouldn't
// inflate the headline count.
```

`InventoryClient.tsx` gains a `showArchived` toggle (client-side filter over the full `data` array
— no new query, matching the `useState`-only convention) and a per-row Archive/Restore action,
mirroring `MenuClient.tsx`'s `handleToggleActive`/Archive-Restore button UI **exactly**, with one
deliberate divergence called out below:
```tsx
const [showArchived, setShowArchived] = useState(false)
const visibleData = data.filter(i => showArchived || i.isActive)
const archivedCount = data.filter(i => !i.isActive).length
// ...
<Button variant="outline" size="sm" onClick={() => setShowArchived(s => !s)}>
  {showArchived ? 'Hide Archived' : `Show Archived (${archivedCount})`}
</Button>
```
```ts
async function handleDelete(item: InventoryItem) {
  if (!confirm(`Delete "${item.name}"?`)) return
  const result = await deleteInventoryItem(item.id)
  if (!result.ok) { alert(result.error); return }
  if (result.data.archived) {
    setData(prev => prev.map(i => i.id === item.id ? { ...i, isActive: false } : i))
    alert(`"${item.name}" is still referenced by a recipe or a past order, so it was archived instead of deleted. Use "Show Archived" to restore it.`)
  } else {
    setData(prev => prev.filter(i => i.id !== item.id))
  }
}

async function handleToggleActive(item: InventoryItem) {
  const nextIsActive = !item.isActive
  const result = await toggleInventoryItemActive(item.id, nextIsActive)
  if (!result.ok) { alert(result.error); return }
  setData(prev => prev.map(i => i.id === item.id ? { ...i, isActive: nextIsActive } : i))
}
```
**Deliberate divergence from `MenuClient.tsx`**: `MenuClient` shows archived dishes inline (dimmed
via `opacity`), always visible, no reveal toggle. `InventoryClient` **hides** archived items by
default with an explicit reveal toggle — this is Decision 3's specific instruction for this screen,
not an oversight or an inconsistency to "fix" toward matching Menu. The reasoning holds up on its
own merits too: an inventory list is checked far more frequently, for stock-taking, than the menu
is edited, so keeping retired items out of the way by default reduces day-to-day noise more than it
costs in an extra click to reveal them.

**Deliberate non-adoption of `MenuClient`'s `toast` feedback for this screen**: `handleDelete`/
`handleToggleActive` above use `alert()`, matching `InventoryClient`'s own existing convention, not
`MenuClient`'s `toast` one — consistent with section 6's reasoning and the still-deferred
`alert()`/`confirm()` → `toast` migration question. Not fixed here.

Archived rows (visible only when `showArchived` is true) get the same `opacity-60`-class dimming
treatment `MenuClient` already uses for archived dishes, restated as a token-based class per the
design-overhaul work in section 5, not a new visual language.

#### 7.4 Picker exclusion + historical-render integrity — `MenuClient.tsx`, `OrderDetailsClient.tsx`
Per `getInventoryItems()`'s new default (7.2), the `inventory` prop `MenuClient.tsx`'s
`RecipeBuilder` and `OrderDetailsClient.tsx`'s "Extra Ingredients" editor already receive is
**active-only** — archived items are excluded from both "add a new ingredient" pickers with zero
changes to either component's own data-fetching. This alone would, however, silently break the
already-selected-row case: `RecipeBuilder`'s existing code computes
`inventory.find(inv => inv.id === row.inventoryItemId)` for the "selected" display and renders the
`<option>` list from the same `inventory` array — if a row references an item no longer present in
that (now-filtered) array, its `<select>` shows an unmatched value and its unit label goes blank.
This is **exactly the class of bug `OrderDetailsClient.tsx`'s existing `optionsForRow` helper
already solves for archived dishes** — the fix here is to apply the identical pattern to
ingredients, not invent a new one.

`RecipeBuilder` gains an `optionsForRow`-equivalent, sourced from data it already has: an existing
dish's recipe rows are seeded from `dish.ingredients` (`getDishes()`'s `include: { ingredients: {
include: { inventoryItem: true } } }`), which carries each ingredient's full name/unit
**independently of the `inventory` prop's own query** — so the archived item's display data is
already present, it just isn't being offered as an option today:
```tsx
function optionsForRow(row: RecipeRow, inventory: InventoryItem[], dish: DishWithIngredients | null) {
  const options = inventory.map(inv => ({ id: inv.id, name: inv.name, unit: inv.unit }))
  if (row.inventoryItemId && !options.some(o => o.id === row.inventoryItemId)) {
    const fromRecipe = dish?.ingredients.find(i => i.inventoryItemId === row.inventoryItemId)?.inventoryItem
    if (fromRecipe) options.unshift({ id: fromRecipe.id, name: `${fromRecipe.name} (archived)`, unit: fromRecipe.unit })
  }
  return options
}
```
`OrderDetailsClient.tsx`'s extra-ingredients editor gets the same treatment, sourced from
`order.ingredientLogs[].inventoryItem` (already included in that page's own Prisma query) instead
of `dish.ingredients`.

**`OrderClient.tsx` needs no change here** — it doesn't render a raw ingredient picker at all
(order creation is dish-first only, per the already-shipped Menu & Recipe System), and its
`inventory` prop is fetched-but-unused (confirmed by its own existing comment). It silently starts
receiving active-only data with no observable effect.

**`admin/page.tsx`'s low-stock computation** is a **direct** Prisma call
(`prisma.inventoryItem.findMany({ select: { currentStock, minimumThreshold } })`), not routed
through `getInventoryItems()` — it needs its own explicit filter, added directly:
```ts
prisma.inventoryItem.findMany({
  where: { isActive: true },
  select: { currentStock: true, minimumThreshold: true },
}),
```
This is the concrete fix for "an archived item shouldn't raise a restock alert" — without it, an
ingredient the business has deliberately stopped stocking (likely sitting at `currentStock: 0`)
would nag the dashboard forever.

**Historical integrity, restated as the acceptance bar**: a past order's `OrderIngredientLog` rows
(rendered read-only in `OrderDetailsClient.tsx`'s "Ingredients Used" table) already join
`inventoryItem: true` directly and render `log.inventoryItem.name`/`.category`/`.unit` regardless
of that item's current `isActive` value — **this table needs no change at all**, since it was never
routed through the now-filtered `getInventoryItems()` query in the first place. The only places
that needed the reinjection fix above are the two *editable* pickers (recipe builder, extra-
ingredients editor), not the read-only historical views.

#### 7.5 Files touched (item 7 additions to the 0.8 master table)
| File | Change |
|---|---|
| `prisma/schema.prisma` | MODIFY — `InventoryItem.isActive Boolean @default(true)` |
| `src/app/admin/inventory/actions.ts` | MODIFY — corrected `deleteInventoryItem` (fixes the `DishIngredient` pre-check gap, archives on conflict), new `toggleInventoryItemActive`, `getInventoryItems({ includeArchived })` |
| `src/app/admin/inventory/page.tsx` | MODIFY — `getInventoryItems({ includeArchived: true })`, active-only header count |
| `src/app/admin/inventory/InventoryClient.tsx` | MODIFY (extends the 5.5 design-overhaul entry) — `showArchived` toggle, Archive/Restore action, corrected delete-result handling |
| `src/app/admin/menu/MenuClient.tsx` | MODIFY (extends the 5.6 entry) — `optionsForRow`-equivalent for `RecipeBuilder`'s ingredient picker |
| `src/app/admin/orders/[id]/OrderDetailsClient.tsx` | MODIFY (extends the 5.4 entry) — same reinjection pattern for the extra-ingredients editor |
| `src/app/admin/page.tsx` | MODIFY (extends the 5.3 entry) — low-stock query gains `where: { isActive: true }` |

---

## API Changes
No new HTTP API surface. Server Action changes:
- `createOrder` (`src/app/admin/orders/actions.ts`) — **signature unchanged**; only its
  `OrderClient.tsx` call site changes, to actually pass the `dueDate` the signature and zod schema
  already accept.
- `updateOrderDueDate` (**new**, `src/app/admin/orders/[id]/actions.ts`) —
  `(id: string, dueDate: Date | null) => Promise<ActionResult<Order>>`. `requireAdmin()`-gated,
  `updateOrderDueDateSchema`-validated, same `ActionResult`/`toErrorResult` contract as every
  sibling action in this file.
- `updateOrderStatus` (`src/app/admin/orders/actions.ts`) — **signature and behavior unchanged**
  (item 6 is a client-side guard only; restated here because it's the action most likely to be
  mistakenly "touched" by anyone implementing item 6 without re-reading this constraint).
- `deleteInventoryItem` (`src/app/admin/inventory/actions.ts`) — **return type changes**, from
  `ActionResult<void>` to `ActionResult<{ archived: boolean }>`; behavior changes from "error if
  referenced" to "archive if referenced by either `OrderIngredientLog` or `DishIngredient`, hard-
  delete only if referenced by neither." Still `requireAdmin()`-gated, still `idSchema`-validated.
- `toggleInventoryItemActive` (**new**, `src/app/admin/inventory/actions.ts`) —
  `(id: string, isActive: boolean) => Promise<ActionResult<InventoryItem>>`. `requireAdmin()`-gated,
  `idSchema`-validated, mirrors `toggleDishActive`'s manual archive/restore role but returns
  `ActionResult` per Inventory's stricter existing contract.
- `getInventoryItems` (`src/app/admin/inventory/actions.ts`) — **signature gains an optional
  parameter**: `(options?: { includeArchived?: boolean }) => Promise<InventoryItem[]>`. Backward
  compatible — every existing no-argument call site now implicitly receives active-only results,
  which is the correct behavior for all of them (see 7.2/7.4). Still `requireAdmin()`-gated.

## Database Changes
**One schema change — item 7's `InventoryItem.isActive`, additive and backward-compatible:**
```prisma
model InventoryItem {
  // ...existing fields unchanged...
  isActive Boolean @default(true)
}
```
`Order.dueDate` (item 3) already existed in `schema.prisma` (nullable `DateTime?`) from before
this pack — no change needed there. **Unlike the first revision of this document, "no migration
required" no longer holds overall** — see the Rollout Plan's explicit, gated, two-database
migration procedure (dev database + the isolated `rosty_integrity_test` integration database),
which must complete, with human approval, before any item-7 application code is written.

## Domain & Service Layer
New pure modules (no Prisma import, no `next/*` import — same discipline as `src/lib/recipe.ts`):
- `src/lib/currency.ts` — `formatCurrency(amount): string`, `getCurrencySymbol(): string`,
  `getCurrencyCode(): string`, `BUSINESS_LOCALE: string`.
- `src/lib/dueDate.ts` — `getDueUrgency(dueDate, now?): DueUrgency`,
  `isActiveOrderStatus(status): boolean`, `ACTIVE_ORDER_STATUSES: OrderStatus[]`.
- `src/lib/orderStatus.ts` — `ORDER_STATUS_CONFIG: Record<OrderStatus, {label, emoji, className}>`.

Item 7 introduces no new pure module — `getInventoryItems`'s `includeArchived` filtering and the
`optionsForRow`-equivalent reinjection logic in `MenuClient.tsx`/`OrderDetailsClient.tsx` are both
small enough, and specific enough to their one call site each, that extracting them into
`src/lib/` would be premature abstraction for two call sites — consistent with this TDD's existing
reasoning against a shared helper for item 6's two-line confirm guard.

## Frontend Changes
Covered in full, per-file, in sections 5–7 and the 0.8 master table above — not repeated here to
avoid these sections drifting out of sync with each other.

---

## Alternatives Considered

**Mobile nav: new `sheet.tsx` primitive vs. reusing `dialog.tsx`.** Rejected a dedicated sheet
primitive — it would re-derive focus-trap, scroll-lock, and Escape handling from scratch on top of
the same underlying Base UI primitives `dialog.tsx` already wraps, for no benefit beyond more
idiomatic component names. Reusing `dialog.tsx` with a positional `className` override inherits
behavior already exercised elsewhere in the app.

**Close-on-navigate: `usePathname` + `useEffect` vs. an `onNavigate` prop.** Rejected `useEffect`
for consistency with the established `useState`-only convention; the `onNavigate` prop is a
two-line, fully backward-compatible addition.

**Currency: inline `Intl.NumberFormat` at each call site vs. a shared module.** Rejected inlining
— it would reconstruct a formatter on every render of every table row and make "what happens on an
invalid currency code" an answer that has to stay consistent across (now) 12 independently-edited
call sites instead of one.

**Due-date comparison: timestamp-granular vs. date-granular.** Rejected timestamp-granular — the
UI only ever collects a date (`<input type="date">`), so comparing full instants would introduce
false precision an order due "today" would arbitrarily flip to "overdue" at some sub-day instant
that has nothing to do with what a human means by "due today."

**Order cancellation: un-cancel/reactivation vs. confirm-before-cancel.** Rejected building an
un-cancel path (a real alternative the user explicitly considered and rejected, not a strawman) —
reversing a cancellation would need to re-deduct stock through the same guarded, race-safe path a
fresh order uses, and by the time an admin notices a misclick, the ingredients it would have
consumed may already be committed to other orders. That's exactly the class of complexity the
integrity-hardening work closed off; reopening it to save a rare misclick isn't a good trade. A
confirmation before the irreversible step is a one-line guard with none of that risk, and is the
same mechanism this app already uses for every other destructive action.

**Inventory delete: hard-delete-with-cascade vs. archive-on-conflict.** Hard-deleting and cascading
the delete into `OrderIngredientLog`/`DishIngredient` was not seriously considered — it would
silently rewrite order history (an `OrderIngredientLog` row is the historical record of what a
completed order actually consumed) and would mean introducing `onDelete: Cascade` into a schema
that deliberately has none anywhere, a much bigger and riskier change than this feature needs.
Archiving — already proven by `Dish`/`deleteDish` — keeps every historical record byte-for-byte
intact and needed no new schema convention, only the same `isActive` pattern Dish already uses.

**Design system: a new token/design-system layer vs. extending the existing `@theme inline`
tokens.** Rejected building a parallel token system (a JSON design-tokens file, a CSS-in-JS
theme object, or a new Tailwind config layer) — `globals.css` already defines a complete,
well-named semantic token set that Tailwind v4 already promotes to ordinary utility classes; the
actual problem was that components don't use it, not that it doesn't exist. Extending it with a
handful of `@layer components` classes for the roles that repeat across every screen (0.2) is a
strictly smaller, lower-risk diff that produces the same outcome (a coherent, enforceable type/
color system) without introducing a second parallel mechanism a future contributor could confuse
with the first.

**Tables: rewrite as a mobile card layout vs. keep horizontal scroll, improve polish.** Considered
turning the four admin tables into a responsive card list below `md`, matching the "enterprise
grade" bar more completely. Rejected **for this pack**: it requires redesigning column priority
and information density per table (which columns matter most when space is constrained is a
product decision, not a mechanical restyle), is a materially larger change than "apply tokens and
add `tabular-nums`," and the PRD's own primary problem statement is about *navigation*
reachability on mobile, not deep table editing on mobile. Flagged as a candidate follow-up in the
PRD's Open Questions rather than silently folded in or silently dropped.

**Loading states: `loading.tsx` skeletons vs. a spinner/no visible loading state at all.**
Rejected "no visible loading state" (the current behavior — a blank flash during navigation) as
inconsistent with the guideline's explicit "handle empty/loading states" requirement and with the
Linear/Stripe/Vercel reference bar, all of which show skeleton placeholders. Rejected a generic
centered spinner in favor of layout-matching skeletons because a spinner communicates "wait" but a
skeleton also communicates "here's roughly what's coming," which reduces perceived layout shift
when the real content arrives.

---

## Edge Cases & Failure Modes

- **`dueDate` is `null`** (the common case today, and every existing seeded/historical order,
  since the field was previously unreachable from any UI) → `getDueUrgency` returns `"none"`; no
  badge, no row tint, excluded from both dashboard counts. Explicitly unit-tested.
- **`dueDate` on a `COMPLETED`/`CANCELLED` order is in the past** → `getDueUrgency` alone would
  still say `"overdue"` (status-unaware by design), but every call site gates on
  `isActiveOrderStatus(status)` first — a completed order delivered on time last month never shows
  as "overdue." Explicitly unit-tested as a combined case, not just each function in isolation.
- **Timezone boundary crossing** (`dueDate` at `23:30 UTC`, already the next calendar day in
  Lagos) → covered by the corrected test case in section 3.
- **Malformed/unparseable `dueDate` string** (defensive — shouldn't happen given Prisma's typed
  `DateTime?` column, but the function accepts `Date | string | null | undefined` for testability)
  → `Number.isNaN(due.getTime())` guard returns `"none"` rather than throwing.
- **Invalid `NEXT_PUBLIC_CURRENCY`** (typo, unsupported code) → falls back to NGN with a logged
  warning rather than crashing the render (an uncaught `RangeError` from a bad `Intl.NumberFormat`
  currency code would otherwise take down every page that renders a price).
- **Server deployed with a non-Lagos ambient timezone** — both `currency.ts` (build-time-inlined
  env var, timezone-independent by construction) and `dueDate.ts` (explicit `Africa/Lagos` `Intl`
  timezone) are designed to be identical in output regardless of host timezone.
- **Rapid double-tap of the hamburger trigger, or tapping a nav link mid-slide-in-animation** —
  Base UI's `Dialog.Root` state machine (a single controlled `open` boolean) handles rapid toggles
  without a custom debounce; `onNavigate` firing `setOpen(false)` mid-open-animation just triggers
  the close-animation from wherever the open-animation currently is. Worth a manual spot-check
  during implementation (listed in the QA checklist below); not expected to crash or warn.
- **Concurrent edits to the same order's due date from two admin tabs** — last-write-wins,
  identical to every other field in this app today (`updateOrderStatus`, `updateOrderItems`) — not
  a new risk introduced by this pack.
- **`updateOrderDueDate` called against an order deleted in another tab** — `prisma.order.update`
  throws Prisma `P2025`; `toErrorResult` converts this to a clean `NOT_FOUND` `ActionResult`
  rather than an unhandled server error, matching every other mutation's not-found handling.
- **Very long customer/dish/description strings** — every table cell that renders free-text
  (order description, customer name/email, dish "recipe summary") must use `truncate` or
  `line-clamp-*` with `min-w-0` on its flex/table-cell ancestor per the guideline's "containers
  must handle long content" rule; several of these already have `max-w-[220px] truncate` (the
  admin dashboard's recent-orders description column) — the redesign audits and applies the same
  treatment to any cell in the five restyled tables that doesn't already have it (notably:
  `MenuClient.tsx`'s recipe-summary cell, which currently has no truncation at all and could grow
  unbounded for a dish with many ingredients).
- **A dish with a very large `RECIPE_SUMMARY_LIMIT` overflow, or an order with many `dishes`/
  `ingredientLogs` rows** — already handled by existing "+N more" truncation logic
  (`MenuClient.tsx`) and unbounded-but-scrollable detail tables (`OrderDetailsClient.tsx`); the
  redesign does not change this behavior, only its visual presentation.
- **`prefers-reduced-motion: reduce`** — the drawer's slide-in, the skeleton pulse, and any table
  row hover-transition all collapse to nearly-instant via the single global override (0.7) rather
  than relying on every future animation remembering a `motion-safe:` variant individually.
- **A user on a very small phone (< 330px) or with the OS text-size scaled up significantly** —
  `max-w-[85vw]` on the drawer and `text-balance`/`truncate` on headings and long text prevent
  layout breakage, but this is not exhaustively tested against extreme OS-level text scaling in
  this pass — flagged as a manual-checklist item, not a guaranteed-covered case.
- **Declining the cancel-confirm dialog** (item 6) — `confirm()` returns `false`, the `onChange`
  handler returns immediately before calling `updateOrderStatus`, and the controlled `<select>`
  reverts to its bound value (`data`'s current status / `order.status`) on the next render — the
  exact same "controlled select reverts on its own" mechanism already relied on for the
  `!result.ok` early-return case a few lines below it. No partial/flickered state is possible.
- **An order is cancelled by one admin tab while a second admin tab has that same order's detail
  page open** — unrelated to and unchanged by item 6; this is the same last-write-wins behavior
  already true for every other field, restated above.
- **An `InventoryItem` is archived while an admin has it open in an unrelated tab's dish-recipe or
  extra-ingredients editor** — the open tab's already-rendered `<select>` options were computed
  from data fetched before the archive happened, so it may still show the item as pickable until
  the page is refreshed/revalidated. This is the same class of staleness every other admin screen
  in this app already accepts (no live-update mechanism exists anywhere), not a new risk item 7
  introduces. If the admin actually submits a selection referencing the now-archived item, the
  write still succeeds (archiving never deletes the row, so the foreign key is still valid) — the
  only consequence is that a just-retired ingredient could be picked one more time in a race that
  requires two admins acting within the same short window, which is an acceptable risk for a
  single-admin-in-practice tool.
- **An `InventoryItem` is archived and then the admin tries to restore it via "Show Archived" →
  Restore, but a dish's recipe or an order's ingredient list was edited in the meantime to no
  longer reference it** — restoring is a pure `isActive: true` flip with no dependency on current
  references (unlike deleting, which does check references) — always succeeds, matching
  `toggleDishActive`'s equally unconditional restore behavior.
- **`toggleInventoryItemActive`/corrected `deleteInventoryItem` called against an item deleted in
  another tab** — `prisma.inventoryItem.update()`/`.delete()` both throw Prisma `P2025`;
  `toErrorResult` converts this to a clean `NOT_FOUND` result, matching every other mutation's
  not-found handling in this codebase (restated here because it's the same mechanism as
  `updateOrderDueDate`'s equivalent case above, not a new one invented for this action).
- **A very large inventory with many archived items** — `showArchived`'s client-side filter and
  the picker's `optionsForRow`-equivalent are both `O(n)` array operations over a list this app's
  actual usage pattern (a single small catering business, tens of items) never approaches a size
  where that matters; no pagination is introduced, matching every other admin table in this app.

## Security Considerations
- **`updateOrderDueDate` is fully gated** — `requireAdmin()` + `updateOrderDueDateSchema.parse()`,
  matching every sibling mutation in `[id]/actions.ts`. This is a correction from the prior draft,
  not a new risk: the prior draft's unauthenticated sketch would have been the one action in this
  file without the protection every other action already has.
- **No new data exposure** — `dueDate` was already selected/returned by every existing `Order`
  query; this pack only adds *rendering* of a value already fetched and (on the customer
  dashboard) already displayed.
- **`NEXT_PUBLIC_CURRENCY` is, by definition, public** — bundled into client-visible JavaScript.
  Fine here (a currency code is not sensitive); stated plainly so nobody later reaches for the
  same prefix for something that shouldn't be public.
- **No new rate-limiting need** — no new unauthenticated or high-frequency endpoint is introduced.
- **The `DialogTrigger` → `onClick` fixes in 5.4/5.5/5.7 are a strict security/reliability
  improvement, not a new surface** — they make three already-shipped "Create" buttons reliably
  open their dialog in a real browser; they don't add a new code path or change what the resulting
  form submits to.
- **No auth/authorization pattern from the integrity-hardening RFC is touched, weakened, or
  bypassed anywhere in this pack** — restated explicitly because it is the single hardest
  constraint on this work and worth a direct, unambiguous confirmation rather than only an
  implication from the diff.
- **Item 6's cancel-confirm is a client-side UX guard, not a security control, and must never be
  treated as one.** `updateOrderStatus`'s server-side authorization and its `leavingCancelled`
  rejection are the actual enforcement; the `confirm()` dialog only prevents an accidental click
  from a legitimate, already-authorized admin. This is stated explicitly so nobody later "removes"
  the confirm as a simplification under the mistaken impression it was providing access control.
- **Item 7's `toggleInventoryItemActive` and corrected `deleteInventoryItem` are fully gated** —
  `requireAdmin()` + `idSchema.parse()` on both, matching `updateInventoryItem`/`createInventoryItem`
  in the same file exactly. `getInventoryItems({ includeArchived })` is also still
  `requireAdmin()`-gated, unchanged from today — the new optional parameter only changes which rows
  a already-authorized caller sees, not who can call it.
- **No new data exposure from item 7** — `isActive` is a boolean on a record already fully returned
  to any authenticated admin; archiving doesn't create a "hidden" record with different visibility
  rules, it's the same row with one more field, and `includeArchived: true` is only ever passed
  from the one Server Component (`inventory/page.tsx`) that's already behind the same admin-only
  route gate as everything else in `/admin`.

## Testing Strategy

**Framework and baseline — corrected from the prior draft.** Vitest is already fully configured
via `vitest.config.mts` (a `node` project for `src/**/*.test.ts` and a `jsdom` + React Testing
Library project for `src/**/*.test.tsx`) and `vitest.integration.config.mts`. **139 tests already
exist and are green** (60 unit + 79 integration) — this is the regression baseline, not a
greenfield test-setup task. No new Vitest config file is needed; new `.test.ts` files are
auto-discovered by the existing `node` project's `include: ['src/**/*.test.ts']` glob.

**New unit tests required (the two genuinely new correctness surfaces):**

1. `src/lib/dueDate.test.ts`:
   - `dueDate = null`/`undefined` → `"none"`.
   - `dueDate` far in the past, `now` today → `"overdue"`.
   - `dueDate` === `now`'s calendar day (same day, different time-of-day) → `"due-today"`.
   - `dueDate` far in the future → `"upcoming"`.
   - **Corrected timezone-boundary case** (section 3's `2026-08-17T23:30:00Z` /
     `2026-08-18T00:15:00Z` pair) → `"due-today"`, asserting the Lagos-pinned result against what
     a naive UTC-only implementation would wrongly compute (`"overdue"`).
   - Malformed date string (`"not-a-date"`) → `"none"`, does not throw.
   - `isActiveOrderStatus` × `getDueUrgency` interaction: a `COMPLETED` order with a long-overdue
     `dueDate`, tested as the *caller-level* combination used in `OrderClient.tsx`/`admin/page.tsx`
     — must resolve to "not flagged," not just each function correct in isolation.
   - `now` injected explicitly in every case — no `vi.setSystemTime`, matching why `now` is a
     parameter with a default rather than an internal `new Date()` call.

2. `src/lib/currency.test.ts`:
   - Default (`NEXT_PUBLIC_CURRENCY` unset) formats as NGN with the `₦` symbol.
   - A valid override (e.g. `GHS`) formats with the correct localized symbol.
   - An invalid code falls back to NGN and does not throw.
   - `formatCurrency` handles `NaN`/non-finite input by formatting `0`, not throwing or rendering
     `"NaN"`.
   - `getCurrencySymbol()` returns just the symbol, not a full formatted amount.
   - **Test-environment note, stated as a comment in the test file itself**: since
     `resolveCurrencyCode()` reads `process.env.NEXT_PUBLIC_CURRENCY` and the formatter is built
     once at module load, tests exercising different env values must use `vi.resetModules()` +
     dynamic `import()` per case, not a single static top-level import.

**Existing test files require lockstep updates. Three categories of expected, intentional
breakage — a developer or test-engineer seeing any of these fail must update the assertion to the
new intended behavior, not revert the underlying feature:**

**(a) Currency — 9 confirmed sites, listed by file:line:**
- `OrderClient.test.tsx:117` — `expect.arrayContaining(['Jollof Rice ($1200)', 'Meat Pie ($350)'])`
- `OrderClient.test.tsx:143`, `:172` — `getByLabelText('Total Price ($)')`
- `OrderDetailsClient.test.tsx:174` — `getByLabelText('Total Price ($)')`
- `MenuClient.test.tsx:95` — `getByText('$1200')`; `:209` — `getByText('$1500')`
- `MenuClient.test.tsx:156`, `:184`, `:198` — `getByLabelText('Price ($)')`

**(b) `deleteInventoryItem`'s `FK_CONSTRAINT` → archived behavior change (item 7):**
`tests/integration/fk-guarded-deletes.integration.test.ts:57-69` asserts
`deleteInventoryItem` on a referenced item resolves `{ ok: false, code: 'FK_CONSTRAINT' }` and that
the row still exists. Once referenced items archive instead of erroring, the action now resolves
`{ ok: true, data: { archived: true } }` — the first assertion inverts entirely; the "row still
exists" assertion happens to still pass, but now because it was archived, not because the delete
was rejected, so the test's *reason* for passing needs updating even where its literal boolean
outcome doesn't change. `tests/integration/inventory-actions.integration.test.ts` also imports and
exercises `deleteInventoryItem` — review required there too, including any case that references an
item via `DishIngredient` only (never `OrderIngredientLog`), since that's the specific gap the
corrected pre-check fixes and is exactly the kind of case worth adding *new* integration coverage
for, not just fixing existing assertions.

**(c) `getInventoryItems()` now filters `isActive: true` by default (item 7):**
Any existing assertion that counts or enumerates rows returned by `getInventoryItems()` — directly,
or indirectly via `InventoryClient`'s `initialData`, `MenuClient`'s `inventory` prop, or
`OrderDetailsClient`'s `inventory` prop — will see one fewer row per archived item once any test
fixture includes one. This pack does not introduce archived fixtures into the *existing* test
suite's setup (existing fixtures are unaffected, since every pre-existing row defaults to
`isActive: true`), so this is a forward-looking correctness note rather than a guaranteed-broken
assertion today — but any *new* test added for item 7's archive behavior that also asserts on
`getInventoryItems()`'s row count must account for the default filter, and this is exactly the
"which callers see a different result" list the design in 7.2/7.4 exists to make exhaustive: the
inventory list page (opts out via `includeArchived: true`), the low-stock dashboard computation
(uses a separate direct query, now also filtered), and both ingredient pickers (menu recipe
builder, order-detail extra-ingredients editor).

**Additional test-file impact from this pack's own changes, flagged for the implementation/test
plan (not called out in the prior draft, since these files didn't exist yet when it was written):**
- `OrderDetailsClient.test.tsx` currently mocks `./actions` as `{ updateOrderItems: vi.fn() }`
  (`vi.mock('./actions', () => ({ updateOrderItems: vi.fn() }))`) — once `OrderDetailsClient.tsx`
  imports and calls the new `updateOrderDueDate`, this mock factory needs
  `updateOrderDueDate: vi.fn()` added, or any test that exercises the due-date input will fail
  with "updateOrderDueDate is not a function."
- `OrderClient.test.tsx` carries an explicit docstring finding that, under RTL/jsdom, the current
  `DialogTrigger render={<Button/>}` "Create Order" trigger opens the dialog reliably (contrary to
  `AGENTS.md`'s documented real-browser behavior) — after 5.4's fix to the direct-`onClick`
  pattern, this specific documented finding becomes moot for this file (the test's *outcome*
  should be unaffected, since RTL locates the button by role/name either way, but the *docstring's
  claim* about `DialogTrigger` specifically will no longer describe this file's actual
  implementation once fixed — worth a one-line docstring update, not a test-logic change).
- **`window.confirm` stubbing requirement (item 6), stated once here and cross-referenced from
  section 6** — `jsdom` does not implement `window.confirm`; called unstubbed, it returns
  `undefined` (falsy), not a throw. Any test — existing or new — that exercises a status-`<select>`
  transition to `CANCELLED` in `OrderClient.test.tsx` or `OrderDetailsClient.test.tsx` will silently
  take the "declined" branch and never reach `updateOrderStatus` unless it first stubs
  `vi.spyOn(window, 'confirm').mockReturnValue(true)`. This is not a change to any *existing*
  passing test (neither file's current suite exercises a transition to `CANCELLED`, per a review of
  their existing test cases), but it is a hard requirement for the test-engineer's next pass over
  this path, called out here so it isn't rediscovered the hard way via a mysteriously-never-called
  mock.

**Component-level visual/styling changes do not get new automated coverage.** Unlike the prior
draft's reasoning (which argued this repo had no jsdom/RTL investment yet — **no longer true**,
since 3 component test files already use it successfully), the reasoning here is narrower and
still holds: the changes in section 5 are almost entirely `className`/CSS changes with identical
DOM structure and identical `data-*`/role/accessible-name attributes, which is precisely the kind
of change RTL-style tests are *insensitive* to by design (they query by role/label/text, not by
class name) — so writing new assertions wouldn't catch the failure modes that actually matter here
(does the drawer feel right at 375px, is the contrast correct, does the logo look right against
the dark background). Those are manual/visual judgments. **Exception**: if a `className`/structure
change in section 5 also changes an accessible name, role, or label text (e.g. the "Create Order"
`DialogTrigger` fix in 5.4, or the sign-out `<button>` → `<Button>` swap in 5.2/5.8), the existing
test suite already exercises that query and will simply pass or fail normally — no new test is
written *for* the visual change, but the existing coverage is expected to remain green through it,
and any failure is a real signal, not noise to suppress.

**Manual verification checklist** — required before this pack is considered done, organized by
concern and traceable to the specific web-interface-guideline rule it satisfies:

*Mobile nav (item 1):*
- [ ] At 375px viewport width: hamburger visible, tappable, opens drawer within one tap.
- [ ] Drawer covers ≤ 85% of viewport width, leaving a visibly tappable dismiss area.
- [ ] Tapping a nav link both navigates **and** closes the drawer (single tap).
- [ ] Tapping the overlay closes the drawer; pressing `Escape` closes the drawer.
- [ ] Tab from page load reaches the hamburger; opening moves focus inside the drawer; closing
      returns focus to the hamburger (Base UI defaults).
- [ ] The drawer's built-in close (X) button dispatches a click and closes the drawer.
- [ ] Body does not scroll behind the open drawer; drawer's own internal scroll (if content
      overflows) does not rubber-band into the page behind it (`overscroll-behavior: contain`).
- [ ] Above `md` (≥768px), behavior is pixel-identical to before this change.
- [ ] Rapid double-tap of the hamburger, and tapping a nav link mid-animation, do not crash or
      produce a console warning.

*Currency, due-date, brand (items 2–4):*
- [ ] Every price on every one of the 12 confirmed sites shows `₦`, not `$` — grep-verified plus a
      quick visual pass.
- [ ] Numeric columns (price, stock, counts) render with fixed-width digits — no jitter as values
      change.
- [ ] Favicon renders correctly in a browser tab; "Add to Home Screen" produces the correct name,
      icon, and no white flash before the dark theme paints.
- [ ] Logo renders cleanly (no stray white edge) in the sidebar and the mobile header.
- [ ] Due-today/overdue stat cards and the orders table's "Due" column/row-tint agree with each
      other and with manual expectation for at least one order in each urgency state.

*Design system / accessibility (item 5, traced to specific guideline rules):*
- [ ] `grep -rn "oklch(" src/` (excluding `globals.css` itself) returns zero hits across
      `src/components/layout/`, `src/app/admin/**`, `src/app/dashboard/page.tsx`,
      `src/app/login/page.tsx`, `src/app/page.tsx`.
- [ ] Every icon-only button (hamburger, dialog close buttons) has a non-empty `aria-label`.
- [ ] Every interactive element shows a visible focus ring on keyboard `Tab` (not just on click) —
      spot-check nav links, table row status selects, buttons, the skip link.
- [ ] Skip link is the first focusable element on page load and jumps to `#main-content`.
- [ ] Every native `<select>` (status, category, dish/ingredient pickers) renders with a visible,
      non-transparent background and legible text — spot-check on Windows/Chrome or Windows/Edge
      if a machine is available, since this is specifically a Windows-dark-mode-prone bug.
- [ ] `prefers-reduced-motion: reduce` (OS-level or DevTools emulation) collapses the drawer
      animation and skeleton pulse to near-instant.
- [ ] Empty tables (temporarily clear a table's `initialData` or view a fresh seed with zero rows
      in one category) render the icon+message empty state, not a blank/broken layout.
- [ ] Navigating to each restyled admin route shows a loading skeleton (not a blank flash) on a
      throttled connection (Chrome DevTools "Slow 3G").
- [ ] Login page: submit button shows "Sending…" and is disabled for the duration of the request;
      the status/error message is announced (verify via a screen reader or the accessibility tree
      inspector, not just visually).
- [ ] Customer dashboard's order-status badges visually match the admin's status badges (same
      color per status) — confirms the `orderStatus.ts` unification actually took effect.

*Order cancellation (item 6):*
- [ ] Selecting "Cancelled" in the orders table's status select prompts a native confirm naming
      the order; declining leaves the status visibly unchanged (no flicker).
- [ ] Selecting "Cancelled" in the order detail page's status select prompts the same confirm;
      confirming actually transitions the order and (per the untouched server logic) restores
      stock exactly as it already does today.
- [ ] Once `CANCELLED`, the select is disabled in both places (pre-existing behavior) — confirm
      the new guard hasn't accidentally made a *non*-cancel status change also prompt a confirm.

*Inventory archive/retire (item 7):*
- [ ] Deleting an inventory item with zero references still hard-deletes it (no change from
      today's behavior).
- [ ] Deleting an item referenced only by a `DishIngredient` (a recipe that's never actually been
      ordered) archives it with a specific message, rather than surfacing a generic/raw error —
      this is the corrected-bug case, worth deliberately constructing during QA.
- [ ] Deleting an item referenced by a past order's `OrderIngredientLog` archives it, same as
      today's already-checked case.
- [ ] Archived items are hidden from the inventory list by default; "Show Archived" reveals them
      with the correct count in its own label.
- [ ] An archived item does not appear as a selectable option in Menu's recipe builder or the
      order detail page's "Extra Ingredients" editor for a *new* row — but an existing recipe row
      or extra-ingredient row that already references it still renders its real name/unit
      correctly and remains editable (not blank, not "undefined").
- [ ] An archived item does not contribute to the dashboard's "Low Stock Alerts" count, even if
      its `currentStock` is at or below `minimumThreshold`.
- [ ] "Restore" on an archived item returns it to every picker and to the default (non-archived)
      list view immediately.
- [ ] The inventory page's header count ("N items tracked") reflects only active items, not the
      total including archived ones.

## Rollout Plan
- **No feature flags** — every item is an additive UI/derived-logic change, or (item 7) a single
  additive, backward-compatible schema column; `dueDate`/currency rendering degrade gracefully even
  if only partially deployed, and existing `InventoryItem` rows are unaffected by the new column
  (see the gated migration step below).
- **Item 7 is this pack's only schema change — treat its migration as its own gated phase, not a
  scripted side effect of "just run `db push`."** The prior assumption ("`prisma db push` is
  expected to be a no-op") no longer holds once `InventoryItem.isActive` exists. This step must
  happen, in full, **before any inventory-archive application code is written** — the generated
  Prisma Client needs the new field to exist before `deleteInventoryItem`/`toggleInventoryItemActive`
  can reference `isActive` at all — and it is an explicit, human-approved action, not something a
  developer or an agent scripts into a normal `npm run dev`/test loop:
  1. Update `prisma/schema.prisma` with the new field (7.1), then run `npx prisma generate` to
     regenerate the TypeScript client/types.
  2. **Push to the local dev database** (`postgres` on `127.0.0.1:54322`, the default `DATABASE_URL`)
     — a human-approved `npx prisma db push`. This database may be shared with other concurrently
     active worktrees/pipelines against the same local Supabase Docker stack (this has been true of
     this project's setup before — see `vitest.integration.config.mts`'s own header comment on the
     subject); **confirm no other active pipeline depends on `InventoryItem`'s current shape before
     pushing**, since an additive column is low-risk but not zero-risk to a concurrently-running
     process that constructs its own `PrismaClient` against a schema snapshot from before this push.
  3. **Push to the isolated integration-test database** (`rosty_integrity_test`) — required, or all
     79 integration tests break, since the integration suite's generated `PrismaClient` will select
     a column (`isActive`) the test database doesn't have yet. `vitest.integration.config.mts`'s own
     header comment is explicit that this is "a manual, explicitly human-approved push against
     `rosty_integrity_test` only," never scripted into a test run, and
     `tests/integration/guard-database-url.ts` will hard-fail any test run pointed anywhere else —
     so this step cannot be skipped or automated around. Run it as an explicit, isolated command,
     never by temporarily swapping `.env`/`.env.test` (too easy to forget to swap back and push
     against the wrong database):
     ```bash
     DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test" \
     DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test" \
     npx prisma db push
     ```
  4. **Do not run `prisma db seed` against either database as part of this step, or casually at
     any other point in this pack's implementation.** `prisma/seed.ts` opens with a sequence of
     `deleteMany()` calls — it is a destructive wipe-and-repopulate script. The additive column
     backfills every existing row with `isActive: true` at the database level (Postgres's own
     `ADD COLUMN ... DEFAULT true` semantics) — there is no data-shape reason to reseed, and doing
     so would needlessly destroy whatever fixture/dev data currently exists (including, potentially,
     a concurrently-running pipeline's data on the shared dev database).
  5. Only after steps 1–4 are confirmed complete does any of section 7's application code
     (`actions.ts`, `InventoryClient.tsx`, `MenuClient.tsx`, `OrderDetailsClient.tsx`,
     `admin/page.tsx`'s low-stock query) get written or merged.
- **Sequencing — the design-foundations work (section 0) must land first**, because it's a
  dependency of every other item, not merely a nice-to-have that could ship last:
  1. **Foundations** (0.1–0.7): `globals.css` additions, `orderStatus.ts`, `currency.ts`
     (including `BUSINESS_LOCALE`), `dueDate.ts` — none of these have any visible UI effect on
     their own (new CSS classes and new pure modules with no call sites yet), so this step is
     low-risk to land and review in isolation, and every subsequent step depends on it existing.
  2. **Admin shell** (5.2, folding in items 1 and 4's Sidebar/Header work together, since both
     already touch the same two files — sequencing them separately would mean two review passes
     over the same diff): `MobileNavTrigger.tsx`, `Sidebar.tsx`, `Header.tsx`, `AdminLayout.tsx`
     (skip-link target only), `layout.tsx` (metadata/viewport/skip-link), `site.webmanifest` — and
     the Rostty text fixes (item 4 round 2), since they land in these same files plus
     `email.ts`/`login/page.tsx`/`dashboard/layout.tsx`/`page.tsx`.
  3. **The gated schema-migration step above** — lands on its own, reviewed and approved in
     isolation, before step 4's inventory work begins. Nothing about steps 1–2 depends on it, so it
     does not need to happen first chronologically, only before item 7's *code*.
  4. **Per-screen passes** (5.3–5.7 + items 2–3's per-screen currency/due-date work, plus items 6
     and 7 riding along on the screens they already touch, same reasoning — each screen is touched
     once per pass, not once per item): orders (both files + both actions files — this is where
     items 2, 3, and 6 all land together, since all three touch `OrderClient.tsx`/
     `OrderDetailsClient.tsx`), inventory (item 5's restyle + item 7's archive feature together,
     since both touch `InventoryClient.tsx`/`inventory/actions.ts`/`inventory/page.tsx`), menu
     (item 5's restyle + item 7's picker-exclusion fix in `RecipeBuilder`), dashboard, customers —
     in roughly that order, since orders was the screen every other item's design decisions
     (badge language, `.select-field`, currency call-site pattern) were validated against first.
  5. **Customer-facing pages** (5.8): dashboard, login, landing — independent of the admin-portal
     work above, could in principle land in parallel, but sequenced last here since they're lowest
     traffic/lowest risk and benefit from the badge/token conventions being already-proven on the
     admin side first.
  6. **Loading/empty states** (5.9–5.10): additive `loading.tsx` files and empty-state markup —
     genuinely independent of everything else; can land any time after Foundations, listed last
     only because it's the lowest-risk, most mechanical step.
- **Rollback**: every step except the schema migration is a self-contained diff; `globals.css` only
  gains new classes in this pack, it never removes/renames an existing one (`.stat-card`/
  `.status-*`/`.stock-*` are all preserved), so any step can be reverted independently without
  breaking a later step that happened to land first in review. **The schema migration is the one
  step that isn't trivially reversible** — `isActive` is additive and could be dropped via another
  `db push` against a schema with the field removed, but only after confirming no application code
  (item 7's, in either database) still references it; treat rolling back the schema as its own
  gated, human-approved action mirroring the forward migration, not a quick `git revert`.
- Set `NEXT_PUBLIC_CURRENCY=NGN` in the real deployed `.env` (or accept the code-level default)
  before/at the same time as this deploy.

## Open Questions
Product/content questions are tracked in the PRD (mobile table-card follow-up, `alert()`→`toast()`
migration, the `DialogTrigger` bugfixes riding along, schema-migration scheduling coordination).
The "Rostty" spelling question is **closed** (resolved in this revision; see section 4). Remaining
**engineering** questions for the implementation plan to resolve, not the spec:
- **`.stat-card`'s hover/focus treatment**: stat cards are currently static (non-interactive,
  non-clickable). Should the redesign make them clickable (e.g. "Overdue" card → filtered orders
  view) as part of this pass, or stay static with only a visual refresh? Recommend staying static
  — turning them into navigation is a scope decision, not a restyle, and the PRD doesn't ask for
  it. Flagging so it isn't assumed either way.
- **Skeleton fidelity**: 5.10 proposes simple, roughly-layout-matching skeletons, not
  pixel-accurate content-aware ones. Confirm this bar is acceptable before the implementation plan
  budgets time per-route, since a more faithful skeleton (e.g. matching exact column widths) is a
  meaningfully larger effort per `loading.tsx` file.
- **Header/card background token consolidation** (5.2): this document proposes collapsing the
  header's near-imperceptibly-different background onto `--card` rather than keeping a separate
  token. If a reviewer can see the current 2-lightness-point difference and considers it
  intentional, this should be raised before implementation, not discovered after.
- **Cancel-confirm message wording** (item 6): this document proposes near-identical confirm text
  in `OrderClient.tsx` and `OrderDetailsClient.tsx` ("Cancel order #N? This cannot be undone — a
  new order must be created if this was a mistake."). Confirm this is the wording the business
  owner is comfortable with — it's the first time this app has ever surfaced "this cannot be
  undone" language to the admin, and getting the tone right for a non-technical daily user matters
  more than getting the mechanism right.
- **Should there be a seeded archived `InventoryItem` for manual QA of the "Show Archived" reveal
  toggle?** This TDD deliberately does not propose modifying `prisma/seed.ts` — the reveal toggle
  and archive/restore flow can be fully manually verified by archiving any existing seeded item
  directly through the new UI during QA, with no seed-data change required. If the implementation
  plan would rather have a pre-archived fixture item for repeatable QA/demo purposes, that's a
  small, independent addition to `seed.ts` — not assumed here, since seed data changes carry their
  own re-run/coordination considerations (see the Rollout Plan's gated-migration step) and weren't
  part of what was asked for.
