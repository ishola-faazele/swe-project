# TDD/RFC: Quick-Win Polish Pack (Phase 1)

## Status
Draft

## Context & Motivation
See `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/docs/prd-polish-pack.md` for the user-facing rationale. This document covers the four items from Phase 1 of `/home/ishola/.claude/plans/no-i-want-you-robust-moore.md`: mobile admin nav, currency localization, due-date/overdue alerting, and brand/PWA asset wiring.

This repo is Next.js 16 (App Router, Turbopack), TypeScript strict, Prisma against Postgres via `db push` (no migration files), Base UI + shadcn primitives, Tailwind v4, TanStack Table v8, Supabase Auth. Full conventions are in `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/AGENTS.md`, which I read in full before drafting this, along with the relevant guides under `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/` and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/` (`generate-metadata.md`, `generate-viewport.md`). All four items are additive/derived — no schema migration, no change to the established Server Component → Client Component → Server Action data flow, and (with one flagged exception below) no change to `src/proxy.ts`.

**Important non-obvious constraint surfaced during this design pass**: `Order.dueDate` is currently write-only-in-theory. `createOrder` in `src/app/admin/orders/actions.ts` already accepts `dueDate?: Date | null`, but `OrderClient.tsx`'s create form never collects it, and no screen anywhere lets an admin edit it post-creation. This TDD includes the minimal UI needed to actually populate the field — otherwise items 3(a) and 3(b) below ship permanently empty. This is called out again in the relevant section, not just here.

---

## Proposed Design

### 1. Mobile-responsive admin nav

**Files touched:**
- NEW `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/MobileNavTrigger.tsx`
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/Sidebar.tsx`
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/Header.tsx`
- **NOT MODIFIED**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/AdminLayout.tsx` (deliberately — see below)

**Decision: build the drawer on the existing `dialog.tsx`, do not add a new `sheet.tsx` primitive.**

I read `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/ui/dialog.tsx` and the underlying Base UI type definitions (`node_modules/@base-ui/react/dialog/root/DialogRoot.d.ts`, `.../popup/DialogPopup.d.ts`) before deciding. Base UI's `Dialog.Root` defaults to `modal: true`, which — for free, with zero custom code — gives:
- **Focus trap**: "user interaction is limited to just the dialog: focus is trapped, document page scroll is locked."
- **Body-scroll lock**: same `modal: true` default, confirmed in the type doc comment.
- **Escape-to-close**: `DialogRootChangeEventReason` includes `escapeKey` as a built-in close reason.
- **Focus management on open/close**: `DialogPopup`'s `initialFocus`/`finalFocus` props default to "move focus to first tabbable element on open" and "return focus to the trigger on close" — exactly what's required.

A hand-rolled `sheet.tsx` would mean reimplementing all four of those from scratch (a real, easy-to-get-wrong accessibility surface) to save only some CSS positioning work. Reusing `Dialog` costs one thing: its default popup styling is a centered, zoomed-in modal, not a left-edge drawer. That's a `className` override, not new logic — `DialogContent`'s `className` prop is merged through `cn()` (`clsx` + `tailwind-merge`), and `tailwind-merge` correctly dedupes same-family utilities (e.g., my `top-0 left-0` wins over the base `top-1/2 left-1/2`). This is a clean, low-risk win — reuse.

**`tw-animate-css` (already a dependency, already imported in `globals.css`) supports `slide-in-from-left` / `slide-out-to-left` base classes** (confirmed by reading `node_modules/tw-animate-css/README.md`) — same `data-open:`/`data-closed:` attribute-variant pattern the existing `dialog.tsx` already uses for its fade/zoom animations, so the drawer's enter/exit animation follows the exact same idiom already in the codebase.

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
        <Menu className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="mobile-admin-nav"
          className="top-0 left-0 h-full w-[280px] max-w-[85vw] translate-x-0
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

Note the `zoom-in-100`/`zoom-out-100` classes: they are a deliberate no-op used purely so `tailwind-merge` recognizes them as the same utility family as the base `DialogContent`'s `zoom-in-95`/`zoom-out-95` and drops the zoom effect (a drawer should slide, not zoom).

**Composition — why `AdminLayout.tsx` doesn't change at all.** `Header.tsx` is already an `async` Server Component (it calls `supabase.auth.getUser()`). It does **not** need to become a Client Component to host the trigger: a Server Component can import and render a Client Component as a normal child — that boundary is exactly what `"use client"` marks. So `Header.tsx` simply adds `<MobileNavTrigger />` to its existing left-side JSX, before the "Admin Portal" label:

```tsx
// Header.tsx — left side, add before the existing "Admin Portal" span
<div className="flex items-center gap-2">
  <MobileNavTrigger />
  {/* existing logo + "Admin Portal" text, see Section 4 */}
</div>
```

`AdminLayout.tsx`'s existing `<div className="hidden md:block"><Sidebar /></div>` is untouched — the desktop sidebar and the new mobile drawer are two independent renderings of the same `Sidebar` component, never both mounted-and-visible at once (one is `hidden` via CSS, the other only exists inside a closed-by-default portal). This satisfies "split without turning the whole admin shell into a client component" trivially, because we never touch the shell at all.

**Close-on-navigation, without introducing `useEffect`.** The codebase's established Client Component convention is `useState` only, no `useEffect` anywhere (see `/home/ishola/.claude/agent-memory/tpm-spec-writer/project_chop_with_rosty.md`). A `usePathname()` + `useEffect` close-on-route-change is the obvious approach and would work, but it'd be the first `useEffect` in the codebase for a problem that doesn't need one. Instead, `Sidebar.tsx` gets one small additive change — an optional `onNavigate` callback invoked from each `<Link>`'s `onClick`:

```tsx
// Sidebar.tsx
export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  // ...unchanged...
  <Link
    key={item.name}
    href={item.href}
    onClick={() => onNavigate?.()}
    // ...unchanged className/style...
  >
```

The desktop usage (`<Sidebar />` in `AdminLayout.tsx`) passes no prop, so `onNavigate` is `undefined` and `onClick` is a no-op there — zero behavior change for desktop.

**Accessibility attributes** (the audit found zero `aria-*` attributes anywhere in admin/dashboard/layout — this pack should not add a second UI surface with the same gap):
- Hamburger button: `aria-label="Open navigation menu"`, `aria-expanded={open}`, `aria-controls="mobile-admin-nav"`.
- Drawer: `DialogTitle` (visually hidden via `sr-only`) gives the popup an accessible name via Base UI's automatic `aria-labelledby` wiring — Base UI's own `DialogPopup` already sets `role="dialog"`/`aria-modal` internally, no manual work needed there.
- `Sidebar`'s `<nav>` element should also gain `aria-label="Admin navigation"` (small additive change, applies to both desktop and mobile renderings identically).

**375px-viewport correctness.** `w-[280px] max-w-[85vw]` means the drawer is 280px wide on anything ≥ 330px viewport, and shrinks to 85% of viewport width below that — at 375px this is 280px (~75% of the screen), leaving a visible dismiss-by-tap area on the right. This was chosen over a full-width drawer specifically so "tap outside to close" remains reachable one-handed without the user's thumb needing to cross the whole screen.

---

### 2. Currency localization

**Files touched:**
- NEW `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/currency.ts`
- NEW `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/currency.test.ts`
- NEW `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/.env.example` (see note below — **this file does not currently exist in this worktree**, despite `AGENTS.md`'s repo-layout diagram listing it; I'm creating it fresh with the full existing env-var surface, not just the new one, otherwise it would be a misleading partial file)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/OrderClient.tsx` (lines 79, 148 per the audit — confirmed by direct re-read)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/[id]/OrderDetailsClient.tsx` (line 72 — confirmed)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/dashboard/page.tsx` (line 102 — confirmed)

I re-grepped for `$` price rendering across `src/` (pattern `\$\{|\$\$|"\$"|'\$'`) and also checked `src/lib/notifications/email.ts`, `src/lib/notifications/sms.ts`, and `prisma/seed.ts`. **Confirmed: exactly the four sites named in the roadmap, no more.** Notification templates never render `totalPrice` at all (only description/status/due-date text), so they need no change.

**Currency decision: NGN (Nigerian Naira), not GHS.** The roadmap doc frames the business generically as "West African" and asks me to choose between GHS/NGN. Direct evidence in this repo settles it: `prisma/seed.ts` uses `+234` phone country codes (`'+2348012345671'`, etc.) for every seeded customer — `+234` is Nigeria's country code (Ghana is `+233`) — and all seeded customer names (Adaeze Okonkwo, Emeka Nwachukwu, Tunde Bakare, Ngozi Eze...) are Nigerian names. Seeded `totalPrice` values (₦3,500–₦45,000 for orders ranging from a few soft drinks to a 50-pack birthday catering job) are exactly the right order of magnitude for Naira retail catering pricing; the same numbers in GHS would be implausibly large (≈$3,000 equivalent for a single party order), and as raw USD they'd be implausibly cheap. **Locale: `en-NG`.**

**Design — `src/lib/currency.ts`:**

```ts
const DEFAULT_CURRENCY = "NGN"

// Single-currency app by design (see PRD Non-Goals) — this is a lookup table,
// not a second env var, so there is exactly one knob to turn if the business
// ever changes currency: NEXT_PUBLIC_CURRENCY.
const CURRENCY_LOCALES: Record<string, string> = {
  NGN: "en-NG",
  GHS: "en-GH",
  USD: "en-US",
  GBP: "en-GB",
  EUR: "en-IE",
}

function resolveCurrencyCode(): string {
  const raw = process.env.NEXT_PUBLIC_CURRENCY?.trim().toUpperCase()
  if (!raw) return DEFAULT_CURRENCY

  try {
    // Constructing a formatter is the cheapest reliable ISO 4217 validation —
    // an invalid code throws a RangeError synchronously.
    new Intl.NumberFormat("en", { style: "currency", currency: raw })
    return raw
  } catch {
    console.warn(
      `[currency] Invalid NEXT_PUBLIC_CURRENCY="${raw}" — falling back to ${DEFAULT_CURRENCY}. ` +
      `Expected a 3-letter ISO 4217 code, e.g. "NGN".`
    )
    return DEFAULT_CURRENCY
  }
}

const CURRENCY_CODE = resolveCurrencyCode()
const LOCALE = CURRENCY_LOCALES[CURRENCY_CODE] ?? "en"
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

**Call sites:**
```tsx
// OrderClient.tsx:79 — table cell
cell: (info) => formatCurrency(info.getValue()),

// OrderClient.tsx:148 — form label
<Label htmlFor="totalPrice">Total Price ({getCurrencySymbol()})</Label>

// OrderDetailsClient.tsx:72
<p><span className="font-medium text-slate-500">Total Price:</span> {formatCurrency(order.totalPrice)}</p>

// dashboard/page.tsx:102
<span className="text-sm font-medium">{formatCurrency(order.totalPrice)}</span>
```

**Addressing the four things explicitly asked about:**
- **`NEXT_PUBLIC_` requirement**: `formatCurrency`/`getCurrencySymbol` are called from both Server Components (`dashboard/page.tsx`, `admin/page.tsx` if ever needed there) and Client Components (`OrderClient.tsx`, `OrderDetailsClient.tsx`). Only `NEXT_PUBLIC_`-prefixed env vars are readable from client bundles at all — using the un-prefixed form would work server-side and silently break (or worse, silently show a stale/default value with no error) client-side. This is why the roadmap's suggested name is used as-is.
- **Server/client consistency**: Next.js statically inlines `process.env.NEXT_PUBLIC_*` references into *every* bundle (server and client) at build time — it isn't read from the live process environment at request time the way un-prefixed vars are on the server. That means `formatCurrency` produces byte-identical output whether it runs during SSR or after client hydration, so there is no hydration-mismatch risk from this env var. The practical consequence worth documenting: **changing `NEXT_PUBLIC_CURRENCY` requires a rebuild/restart** (`next dev` picks it up on restart; a deployed app needs a redeploy), not a live config toggle — this is a real operational note for whoever manages this app in production, not just a dev-mode footnote.
- **Locale choice**: `en-NG`, justified above. The formatter/locale is resolved and constructed **once at module load** (not per-render/per-call) — both for performance (`Intl.NumberFormat` construction is the expensive part, not `.format()`) and because it removes any chance of the validation/warning logic re-running per request in production.
- **Unset or invalid**: unset → silently defaults to NGN (this is the expected, documented state for a correctly configured `.env`, not an error). Invalid (e.g., a typo like `NGM`) → falls back to NGN **and** logs a `console.warn` naming the bad value, so a misconfiguration is visible in server/build logs instead of silently showing the wrong currency forever.

---

### 3. Due-date / overdue alerting

**Files touched:**
- NEW `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/dueDate.ts`
- NEW `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/dueDate.test.ts`
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/page.tsx` (dashboard widget)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/OrderClient.tsx` (new "Due" column + row tint + create-form date input)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/actions.ts` (thread the new form field through — the `createOrder` signature already accepts `dueDate`, so this is a call-site change, not a signature change)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/[id]/OrderDetailsClient.tsx` (inline due-date edit)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/[id]/actions.ts` (new `updateOrderDueDate` action)
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/globals.css` (two new badge utility classes, matching the existing `.status-*`/`.stock-*` convention)

**Timezone design — the core decision.** `dueDate` is fundamentally a *calendar date* concept ("due Thursday"), captured via a plain `<input type="date">` (no time-of-day ever collected), but stored as a full `DateTime` column. The business is real, physically in Nigeria (WAT, UTC+1, **no DST** — Nigeria has not observed daylight saving since long before this app existed, which is a genuine simplification: no seasonal offset-shift edge case to handle). The app, per the roadmap's own framing, "may be deployed anywhere" — a serverless host's ambient server timezone is very commonly UTC and has nothing to do with Lagos. If "today" is computed using the server's ambient local timezone, a deploy on a UTC or US-timezone host would compute the wrong calendar day right around the WAT day boundary. The fix is to **pin "today" to the business's fixed timezone (`Africa/Lagos`) regardless of where the code happens to be running**, using `Intl.DateTimeFormat` with an explicit `timeZone`, which is dependency-free and doesn't require hand-rolled UTC-offset arithmetic:

```ts
// src/lib/dueDate.ts
import type { OrderStatus } from "@prisma/client"

/** WAT, UTC+1, no DST. Fixed to the business's real location regardless of
 *  where this app is deployed/hosted — see TDD "Timezone design." */
const BUSINESS_TIMEZONE = "Africa/Lagos"

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Returns a 'YYYY-MM-DD' calendar-date key for `date`, evaluated in the
 *  business's fixed timezone — independent of the server/runtime's own TZ. */
function toBusinessDateKey(date: Date): string {
  return dateKeyFormatter.format(date) // en-CA locale formats as YYYY-MM-DD
}

export type DueUrgency = "overdue" | "due-today" | "upcoming" | "none"

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["PENDING", "PREPPING", "COOKING", "READY"]

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return (ACTIVE_ORDER_STATUSES as string[]).includes(status)
}

/**
 * Pure, unit-testable date comparison. Deliberately date-granular, not
 * timestamp-granular — the UI never collects a time-of-day for `dueDate`,
 * so treating it as an instant would manufacture false precision.
 * `now` is injectable so tests never need to mock the system clock.
 */
export function getDueUrgency(
  dueDate: Date | string | null | undefined,
  now: Date = new Date()
): DueUrgency {
  if (!dueDate) return "none"
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  if (Number.isNaN(due.getTime())) return "none"

  const dueKey = toBusinessDateKey(due)
  const todayKey = toBusinessDateKey(now)

  // 'YYYY-MM-DD' strings compare correctly with plain string comparison.
  if (dueKey < todayKey) return "overdue"
  if (dueKey === todayKey) return "due-today"
  return "upcoming"
}
```

`ACTIVE_ORDER_STATUSES` is exported from this single module and reused both in the Prisma `where` clause (dashboard query, below) and in the table row-highlighting logic — "what counts as active" is defined in exactly one place, so the two call sites cannot drift out of sync with each other.

**Why this, concretely, is not just theoretical correctness.** An order with `dueDate = 2026-08-17T23:30:00Z` is `2026-08-18T00:30` in Lagos — already the *next* calendar day locally, even though it's still "today" in UTC. A naive UTC-based comparison would misclassify this order as due tomorrow when it's actually due in 30 minutes locally (or vice-versa, depending on which side of the render you're comparing on). The `Intl`-with-explicit-`timeZone` approach gets this right without manual offset math. This exact scenario is one of the required unit test cases below.

**Parsing the `<input type="date">` value.** The create-order form's date input yields a bare `"YYYY-MM-DD"` string. Per the ECMAScript spec, `new Date("2026-08-20")` parses as UTC midnight, **not** local midnight. Because Lagos is only UTC+1, UTC midnight on a given date is still 01:00 the *same* calendar day in Lagos — so `new Date(dueDateStr)` is safe to use as-is *given* the Lagos-pinned comparison function above. This is intentionally documented inline in the code so a future edit doesn't "fix" the parsing into local-time parsing without understanding the interaction (which would only matter if the business's timezone ever had a large negative UTC offset — it doesn't, and if it ever changed, `toBusinessDateKey`'s single `BUSINESS_TIMEZONE` constant is the one place to update).

**Dashboard widget (`admin/page.tsx`).** The existing `stats` array already renders as `.stat-card` — this reuses that exact pattern, per the instruction not to invent a new visual language. Add one more parallel query (cheap, `select`-only) alongside the existing `Promise.all`:

```ts
import { ACTIVE_ORDER_STATUSES, getDueUrgency } from '@/lib/dueDate'
import { CalendarClock, CalendarX } from 'lucide-react'

// added to the existing Promise.all(...) array:
prisma.order.findMany({
  where: { status: { in: ACTIVE_ORDER_STATUSES } },
  select: { dueDate: true },
}),
```
```ts
const dueTodayCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'due-today').length
const overdueCount = activeOrdersForDueCheck.filter(o => getDueUrgency(o.dueDate) === 'overdue').length
```

Two new entries appended to the existing `stats` array (same shape as the current four — `label`, `value`, `icon`, `sub`, optional `alert`):
```ts
{ label: 'Due Today', value: dueTodayCount, icon: CalendarClock, sub: 'active orders due today', alert: dueTodayCount > 0 },
{ label: 'Overdue',   value: overdueCount,  icon: CalendarX,     sub: 'past due, not completed', alert: overdueCount > 0 },
```
This grows the stat-card grid from 4 to 6 cards; change the grid classes from `sm:grid-cols-2 lg:grid-cols-4` to `sm:grid-cols-2 lg:grid-cols-3` so it lays out as a clean 2×3 (desktop) / 2×3 (tablet) grid rather than an uneven 4+2 wrap.

**Orders table (`OrderClient.tsx`) — new "Due" column + row tint.** A new `columnHelper.accessor("dueDate", ...)` column, positioned after "Status":
```tsx
columnHelper.accessor("dueDate", {
  header: "Due",
  cell: (info) => {
    const dueDate = info.getValue()
    const status = info.row.original.status
    const urgency = isActiveOrderStatus(status) ? getDueUrgency(dueDate) : "none"
    if (!dueDate) return <span style={{ color: 'oklch(0.40 0.008 65)' }}>—</span>
    const label = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (urgency === 'overdue') return <span className="due-overdue">⚠ Overdue · {label}</span>
    if (urgency === 'due-today') return <span className="due-today">● Due Today</span>
    return <span style={{ color: 'oklch(0.52 0.01 65)' }}>{label}</span>
  },
}),
```
Row-level background tint (extends the existing `idx % 2` inline-style ternary already on each `<tr>`):
```tsx
const urgency = isActiveOrderStatus(row.original.status) ? getDueUrgency(row.original.dueDate) : "none"
style={{
  background:
    urgency === 'overdue' ? 'oklch(0.62 0.22 25 / 0.08)' :
    urgency === 'due-today' ? 'oklch(0.72 0.15 65 / 0.06)' :
    idx % 2 === 0 ? 'oklch(0.10 0.004 65)' : 'transparent',
  borderBottom: '1px solid oklch(0.16 0.005 65)',
}}
```
**Accessibility**: the badge always pairs an icon glyph (`⚠`/`●`) with text ("Overdue"/"Due Today"), never relies on the row tint alone — a colorblind or low-vision admin reading the "Due" column text gets the same information as someone relying on the background color.

New utility classes in `globals.css`, matching the existing `.status-*`/`.stock-*` idiom exactly:
```css
.due-overdue  { @apply inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-red-950/60 text-red-400 border border-red-800/50; }
.due-today    { @apply inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-amber-950/60 text-amber-400 border border-amber-800/50; }
```

**Create-form due-date input (`OrderClient.tsx`).** Add to the existing form grid, next to Total Price:
```tsx
<div className="space-y-2">
  <Label htmlFor="dueDate">Due Date (Optional)</Label>
  <Input id="dueDate" name="dueDate" type="date" />
</div>
```
`handleAdd` already destructures `formData` fields; add:
```ts
const dueDateStr = formData.get("dueDate") as string
const dueDate = dueDateStr ? new Date(dueDateStr) : null
// ...
const newOrder = await createOrder({ customerId, description, totalPrice, dueDate, ingredients })
```
No change needed to `createOrder`'s signature in `actions.ts` — it already accepts `dueDate?: Date | null` and already passes it through to `prisma.order.create`. This was, notably, already-dead code before this change.

**Inline due-date edit (`OrderDetailsClient.tsx` + new `[id]/actions.ts` action).** Mirrors the existing inline status-`<select>` pattern (immediate save on change, no separate "edit mode"):
```ts
// [id]/actions.ts — new export
export async function updateOrderDueDate(id: string, dueDate: Date | null) {
  await prisma.order.update({ where: { id }, data: { dueDate } })
  revalidatePath(`/admin/orders/${id}`)
  revalidatePath('/admin/orders')
}
```
```tsx
// OrderDetailsClient.tsx — next to the existing status <select>
<div className="flex items-center gap-2 mt-2">
  <span className="font-medium text-slate-500">Due Date:</span>
  <input
    type="date"
    defaultValue={order.dueDate ? order.dueDate.toISOString().slice(0, 10) : ''}
    onChange={async (e) => {
      const val = e.target.value ? new Date(e.target.value) : null
      await updateOrderDueDate(order.id, val)
      router.refresh()
    }}
    className="bg-slate-100 dark:bg-slate-800 border rounded text-sm px-2 py-1"
  />
</div>
```

---

### 4. Brand assets + PWA install

**Files touched:**
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/layout.tsx`
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/public/site.webmanifest`
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/Sidebar.tsx`
- MODIFY `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/Header.tsx`

**A real, discovered asset problem — read before implementing.** I opened `public/rosty-logo.jpeg` and `public/android-chrome-512x512.png` directly. Both are square canvases with a **solid opaque white background** (JPEG has no alpha channel at all, so this can't be "fixed" by cropping — the white is baked into every pixel), with the actual logomark occupying roughly the center 55–60%. That's a completely normal, expected shape for a favicon/app-icon (icons always render in their own isolated square context — a browser tab, a home-screen grid cell — where a white fill is unremarkable), so **no special handling is needed for the favicon/manifest usage in Section 4 below.** It becomes a real visual problem only where the logo is dropped inline into the app's own **dark** chrome (the sidebar brand mark, the new mobile header mark) — a hard white square edge sitting directly on `oklch(0.10 0.005 65)` will read as a rendering glitch, not a logo. Fix: wrap it in a small, deliberate white "logo chip" (rounded white background, `object-contain` so nothing gets cropped) — a completely standard treatment for exactly this situation, and a one-line addition, not a redesign:
```tsx
<div className="flex h-8 w-8 items-center justify-center rounded overflow-hidden bg-white p-1">
  <Image src="/rosty-logo.jpeg" alt="Chop with Rosty" fill className="object-contain" />
</div>
```
Wait — `fill` requires the parent to be `position: relative`; the wrapping `div` above needs `className="relative flex h-8 w-8 ..."`. **Recommend flagging, not silently fixing, the actual logo content**: the wordmark baked into `rosty-logo.jpeg` reads "**Rostty**" (double-t) — the same spelling is present in the pre-generated `android-chrome-512x512.png`, so this is consistent across the whole asset set, not a one-off glitch. Every other piece of UI text in this app (`Sidebar.tsx`'s own "ROSTY" text, the landing page wordmark, `layout.tsx`'s `<title>`) spells it "Rosty." This is a brand content decision for the business owner, not something engineering should silently correct by editing the image — ship the assets as provided; flagged in the PRD's Open Questions.

**`next/image` usage.** Confirmed via grep that `next/image` is **not used anywhere in this codebase today** (the one hit in `src/proxy.ts` is just a routing-matcher comment referencing the `_next/image` optimization *route*, not the component) — this pack introduces the first usage. Since `rosty-logo.jpeg` is a `public/`-folder asset referenced by URL string (not a statically-imported module — `public/` isn't under the `@/*` → `src/*` alias, so Next can't infer intrinsic width/height the way it does for imported images), use the `fill` + a sized, `relative` parent + `object-contain` pattern shown above rather than guessing at hardcoded `width`/`height`, which would risk stretching/distorting the asset if the guess is wrong. `next.config.ts` has no `images` config today and needs none — this is a local `public/` asset, not a remote one, so no `remotePatterns` change is required.

**Sidebar mark**: replace the current amber-box `<Flame>` icon with the white-chip logo treatment above, same `h-8 w-8` footprint so no layout shift.

**Header mark**: `Header.tsx` currently has **no** brand-icon at all (only the text "Admin Portal" — the task brief's premise that it has "a generic Lucide icon" brand mark doesn't match the current file; its only Lucide icons are `LogOut` and `Circle`, which are functional, not brand marks). Since the sidebar (and its logo) is `hidden` below `md`, and the mobile header is the *only* persistently-visible chrome for a phone-first admin, add a small logo mark there too — same white-chip treatment, smaller (`h-6 w-6`), next to the hamburger trigger — so mobile users have brand identity even with the drawer closed. This is a small, justified extension of the stated intent, called out explicitly rather than silently assumed.

**`layout.tsx` metadata — the deprecated-`themeColor`-in-`metadata` trap.** I read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` in full. It explicitly states: *"`themeColor` — Deprecated: The `themeColor` option in `metadata` is deprecated as of Next.js 14. Please use the `viewport` configuration instead."* Same for `colorScheme`. This is exactly the kind of thing training data gets wrong (most tutorials/examples still show `themeColor` inside the `metadata` object) — in this Next.js version it must be a **separate `viewport` export**:

```tsx
// layout.tsx
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Chop with Rosty — Kitchen Command Center",
  description: "Enterprise order and inventory management for Chop with Rosty",
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
  themeColor: "#0d0b0a", // approximates --background: oklch(0.08 0.004 65); verify against devtools computed style before shipping
  colorScheme: "dark",   // the app forces `dark` on <html> unconditionally — tell the browser chrome/scrollbars/native form controls to match
};
```

Both `metadata.icons` (file-based icon *links*) and `manifest` are file-convention-agnostic here on purpose: the docs recommend the file-based convention (`app/icon.png`, `app/favicon.ico`) as the *preferred* mechanism, but that convention only auto-detects icon files placed **inside `app/`**, not `public/` — and all seven of these assets already live in `public/`, committed, sized, and presumably already correctly generated. Explicitly listing them in `metadata.icons` (rather than moving/duplicating them into `app/`) is the correct fit for assets that already exist as static `public/` files.

**`site.webmanifest` fixes.** Current content (read directly): `{"name":"","short_name":"","icons":[...192,512...],"theme_color":"#ffffff","background_color":"#ffffff","display":"standalone"}`. Missing `start_url` (required by Chrome/Android's installability checklist, even though the Web Manifest spec itself treats it as optional with a fallback), empty `name`/`short_name`, and `theme_color`/`background_color` set to white despite the app being permanently dark-themed (a white splash-screen background would flash on launch before the dark UI paints — a jarring, avoidable first impression). New content:
```json
{
  "name": "Chop with Rosty",
  "short_name": "Rosty",
  "description": "Kitchen order & inventory command center for Chop with Rosty",
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
`start_url: "/"` (not `/admin`) is deliberate: `src/app/page.tsx` is already a fully-built auth-redirect hub (logged-out → marketing/login CTA, logged-in admin → `/admin`, logged-in customer → `/dashboard`) — pointing the manifest at `/` lets that existing logic decide correctly for whichever kind of user opens the installed icon, rather than hardcoding an assumption.

**A pre-existing routing detail, not required to fix, flagged for awareness**: `src/proxy.ts`'s matcher excludes `favicon.ico` by name and a handful of image extensions (`svg|png|jpg|jpeg|gif|webp`), but **not** `.webmanifest` or `.ico`-in-general. That means a request for `/site.webmanifest` (and, if it were still requested directly, `/favicon.ico` — already excluded) passes through `proxy()` → `updateSession()` (a harmless Supabase cookie refresh, not an auth gate) before being served. This is a pre-existing pattern in `proxy.ts`, not something this pack needs to fix — noted here only so nobody mistakes the extra hop for a bug introduced by this change. If it's ever worth tightening, adding `webmanifest` to the excluded-extensions regex in `src/proxy.ts` is a one-line, low-risk follow-up — deliberately **not** included in this pack's diff, since `src/proxy.ts` is core routing infrastructure the task scope asked to leave alone.

---

## Alternatives Considered

**Mobile nav: new `sheet.tsx` primitive vs. reusing `dialog.tsx`.** Building a dedicated sheet primitive (the shadcn-style approach many teams reach for) would give more idiomatic-looking component naming (`Sheet`, `SheetTrigger`, `SheetContent`) but means re-deriving focus-trap, scroll-lock, and Escape handling from scratch on top of the same underlying Base UI primitives `dialog.tsx` already wraps — pure duplication with real a11y risk if any of those three is subtly wrong. Rejected in favor of reusing `dialog.tsx` with a positional `className` override, which is fewer lines, fewer new concepts, and inherits behavior that's already exercised elsewhere in the app (the Create Order / Add Inventory Item dialogs).

**Close-on-navigate: `usePathname` + `useEffect` vs. an `onNavigate` prop.** The `useEffect` approach is more "standard React" and doesn't require touching `Sidebar.tsx`, but it would be the first `useEffect` in a codebase that has consistently avoided it, and it's solving a problem ("run this after a specific user action") that a plain callback already solves without an effect. Rejected `useEffect` for consistency with the established pattern; the `onNavigate` prop is a two-line, backward-compatible addition (defaults to `undefined`/no-op, so the desktop `<Sidebar />` call site needs zero changes).

**Currency: read `NEXT_PUBLIC_CURRENCY` inline at each call site vs. a shared `src/lib/currency.ts` module.** Inlining `new Intl.NumberFormat(...)` at each of the four render sites was considered and rejected: it would mean re-validating the env var and reconstructing a formatter instance on every single render of every table row, and it would make "what happens on an invalid currency code" an answer that has to stay consistent across four independently-edited call sites instead of one.

**Due-date comparison: timestamp-granular vs. date-granular.** Comparing full instants (e.g., "overdue if `now > dueDate`") was considered. Rejected because the UI never collects a time-of-day for `dueDate` (`<input type="date">` only) — an order due "today" would flip to "overdue" at some arbitrary sub-day instant (whatever time it happened to be created, or midnight, depending on how the missing time component defaults), which is a false-precision bug waiting to happen, not a real requirement. Date-granular comparison in the business's fixed timezone matches what the UI actually captures and what a human means by "due today."

---

## Edge Cases & Failure Modes

- **`dueDate` is `null`** (the common case today, and always the case for every existing seeded/historical order, since the field was previously unreachable from any UI) → `getDueUrgency` returns `"none"`; no badge, no row tint, excluded from both dashboard counts. Explicitly unit-tested.
- **`dueDate` on a `COMPLETED`/`CANCELLED` order is in the past** → the pure `getDueUrgency` function would still say `"overdue"` in isolation (it's status-unaware by design), but every call site gates on `isActiveOrderStatus(status)` first — a completed order delivered on time last month never shows as "overdue" today. Explicitly unit-tested as an interaction between the two exported functions, not just each in isolation.
- **Timezone boundary crossing** (e.g., `dueDate` stored as `23:30 UTC`, which is already the next calendar day in Lagos) → covered by the `Intl`-with-explicit-`timeZone` design; explicitly unit-tested with a fixed, injected `now`.
- **Malformed/unparseable `dueDate` string** (defensive — shouldn't happen given Prisma's typed `DateTime?` column, but the function accepts `Date | string | null | undefined` for testability and safety) → `Number.isNaN(due.getTime())` guard returns `"none"` rather than throwing.
- **Invalid `NEXT_PUBLIC_CURRENCY`** (typo, unsupported code) → falls back to NGN with a logged warning rather than crashing the render (an uncaught `RangeError` from a bad `Intl.NumberFormat` currency code would otherwise take down every page that renders a price).
- **Server deployed with a non-Lagos ambient timezone** (the realistic serverless-hosting case) → both the currency module (build-time-inlined env var, timezone-independent by construction) and the due-date module (explicit `Africa/Lagos` `Intl` timezone, ambient-TZ-independent by construction) are designed to be identical in output regardless of host timezone — this is the central design goal of both modules, not an incidental property.
- **Rapid double-tap of the hamburger trigger, or tapping a nav link mid-slide-in-animation** → Base UI's `Dialog.Root` state machine (controlled via a single `open`/`onOpenChange` boolean) handles rapid toggles without a custom debounce; `onNavigate` firing `setOpen(false)` while the open-animation is still running just triggers the close-animation from wherever the open-animation currently is — no crash, no dev-console warning class of bug expected, but **worth a manual spot-check during implementation** since this specific transition (open→close before open-animation completes) isn't covered by the recommended manual QA checklist below by default; add it.
- **Order created with no due date, then later given one via the new inline edit, while the dashboard/table are already rendered** → both are Server Components (`admin/page.tsx`) or read `initialData` via `useState` (`OrderClient.tsx`); the new `updateOrderDueDate` action calls `revalidatePath` on both `/admin/orders/[id]` and `/admin/orders`, matching the existing revalidation pattern used by `updateOrderIngredients` — the *list* page picks up the change on next navigation/refresh, consistent with how every other admin mutation in this codebase already behaves (no optimistic due-date update on the detail page beyond the existing `router.refresh()` call, matching the existing status-select pattern exactly).
- **Concurrent edits to the same order's due date from two admin tabs** → last-write-wins, identical to every other field in this app today (`updateOrderStatus`, `updateOrderIngredients`) — not a new risk introduced by this pack, and explicitly not being fixed here (would require optimistic-concurrency/versioning across the whole `actions.ts` surface, which is Phase 0/broader-hardening territory).

---

## Security Considerations

- **No new auth surface.** `updateOrderDueDate` follows the exact (lack of) authorization pattern every existing action in `src/app/admin/orders/**/actions.ts` already has — zero `supabase.auth.getUser()`/role check. This is a **known, pre-existing, explicitly out-of-scope gap** (Phase 0 hardening, tracked separately) — adding one more action with the same shape doesn't make the aggregate risk meaningfully worse, but it does mean `updateOrderDueDate`, like its siblings, is technically a callable-by-anyone-with-a-session POST endpoint. **Flagging explicitly, not silently inheriting.**
- **No new input validation.** The new `dueDate` input accepts any browser-supplied date string; there is no server-side format/range validation (e.g., nothing stops a due date 100 years in the future or in 1900) — consistent with, not worse than, every other field in `createOrder` today (also unvalidated). Explicitly not adding validation here, per the PRD's Non-Goals, to avoid quietly expanding this pack into Phase-0 territory.
- **No new data exposure.** `dueDate` was already selected/returned by every existing `Order` query (`getOrders`, the detail-page query) — this pack only adds *rendering* of a value that was already being fetched and, in the customer dashboard's case, already displayed. No new field crosses a trust boundary that wasn't already crossing it.
- **`NEXT_PUBLIC_CURRENCY` is, by definition, public.** `NEXT_PUBLIC_*` variables are bundled into client-visible JavaScript — this is fine here (a currency code is not sensitive), but worth stating plainly so nobody later reaches for the same prefix for something that shouldn't be public.
- **No new rate-limiting need.** None of the four items introduce a new unauthenticated or high-frequency endpoint.

---

## Testing Strategy

**Framework: Vitest**, per the task brief (a parallel pipeline is independently bootstrapping Vitest for this repo; duplicate config at merge time is expected and acceptable). This pack adds its own minimal `vitest.config.ts` rather than assuming the other pipeline's config lands first.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node' }, // pure-function tests only — no DOM needed, see below
})
```
`package.json` additions: `"test": "vitest run"` script, `vitest` devDependency. No `jsdom`, no `@testing-library/*` — justified below.

**Unit tests REQUIRED (per task brief) — and where the real correctness risk lives:**

1. `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/dueDate.test.ts` — the primary target. Required cases:
   - `dueDate = null` / `undefined` → `"none"`.
   - `dueDate` far in the past, `now` today → `"overdue"`.
   - `dueDate === now`'s calendar day (same-day, different time-of-day) → `"due-today"`.
   - `dueDate` far in the future → `"upcoming"`.
   - **Timezone boundary regression case**: `dueDate = new Date("2026-08-17T23:30:00Z")`, `now = new Date("2026-08-18T00:15:00Z")` → both instants are the same UTC calendar day (Aug 17 vs Aug 18 — actually different UTC days already in this example; construct the precise pair so that the UTC calendar days differ from the Lagos calendar days) → asserts the Lagos-timezone-pinned result, not a naive-UTC result — this is the test that would fail if someone "simplified" the implementation back to plain UTC comparison.
   - Malformed date string (e.g., `"not-a-date"`) → `"none"`, does not throw.
   - `isActiveOrderStatus` × `getDueUrgency` interaction: a `COMPLETED` order with a long-overdue `dueDate` — the *caller-level* combination (as used in `OrderClient.tsx`/`admin/page.tsx`) must resolve to "not flagged," tested as an explicit combined case, not just each function in isolation.
   - `now` injected explicitly in every case (no reliance on the real system clock / no `vi.setSystemTime` needed) — this is precisely why `now` is a parameter with a default rather than an internal `new Date()` call.

2. `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/currency.test.ts`:
   - Default (`NEXT_PUBLIC_CURRENCY` unset) formats as NGN with the `₦` symbol.
   - A valid override (e.g., `GHS`) formats with the `GH₵`/localized-equivalent symbol correctly.
   - An invalid code falls back to NGN and does not throw.
   - `formatCurrency` handles `NaN`/non-finite input by formatting `0` rather than throwing or rendering `"NaN"`.
   - `getCurrencySymbol()` returns just the symbol, not a full formatted amount.
   - **Test-environment note**: since `resolveCurrencyCode()` reads `process.env.NEXT_PUBLIC_CURRENCY` and the formatter is built once at module load, tests that need different env values must use `vi.resetModules()` + dynamic `import()` per test case (setting `process.env` and re-importing), not a single static top-level import — call this out in the test file itself as a comment so the pattern isn't accidentally "simplified" into a single shared import that can't actually test the fallback branches.

**Mobile nav and brand-asset wiring: explicit recommendation is manual verification, not a jsdom/RTL component-test harness — and here's the reasoning, not just the conclusion.** This repo has zero test files and zero test-related devDependencies today. Standing up `jsdom` + `@testing-library/react` + `@testing-library/user-event` (plus, likely, working around Base UI's portal-based rendering in a jsdom environment, which has known rough edges for dialogs/popovers specifically) is a real, non-trivial one-time investment — and the two things being tested here (does a drawer *feel* right at 375px, does a logo *look* right against a dark background) are fundamentally visual/interaction judgments that a DOM-assertion test wouldn't meaningfully validate anyway (a passing "the dialog has `role=dialog`" assertion tells you nothing about whether the drawer is usable one-handed). Given this is explicitly a small, mostly-presentational "quick win" pack, not the start of this repo's frontend test strategy, the disproportionate-effort bar is met — **recommend deferring automated component tests for this pack** and using a manual checklist instead:

- [ ] At 375px viewport width (Chrome DevTools device toolbar or a real phone): hamburger visible, tappable, opens drawer within one tap.
- [ ] Drawer covers ≤ 85% of viewport width, leaving a visibly tappable dismiss area.
- [ ] Tapping a nav link inside the drawer both navigates **and** closes the drawer (single tap, not two).
- [ ] Tapping the dark overlay closes the drawer.
- [ ] Pressing `Escape` (external keyboard, or a keyboard-accessible test) closes the drawer.
- [ ] Tab key, from page load, reaches the hamburger button; opening the drawer moves focus inside it; closing returns focus to the hamburger button (Base UI defaults — verify they actually hold in this app's DOM structure).
- [ ] **Specifically verify the drawer's built-in close (X) button actually dispatches a click** — see the flagged risk below; this is not assumed to work by default.
- [ ] Body does not scroll behind the open drawer (scroll-lock).
- [ ] Above `md` (≥768px), behavior is pixel-identical to before this change (no hamburger, sidebar always visible).
- [ ] Favicon renders correctly in a browser tab (not the default Next.js icon).
- [ ] "Add to Home Screen" (Android Chrome and iOS Safari, at least one of each if devices are available) produces the correct name ("Rosty"), correct icon, and opens directly into the app with no visible white flash before the dark theme paints.
- [ ] Logo renders cleanly (no stray white edge bleeding into the dark chrome) in both the sidebar and the mobile header.
- [ ] Every price on every one of the four call sites shows `₦`, not `$` — a quick manual pass plus the `grep` check named in the PRD's Success Metrics.

If the team later wants automated coverage for this surface, the next increment (not part of this pack) would be a minimal `jsdom` + RTL smoke test asserting `aria-expanded` toggles and the dialog mounts/unmounts — deliberately deferred, not forgotten.

---

## Rollout Plan
- No feature flags — all four items are additive UI/derived-logic changes with no destructive schema or data migration, and `dueDate`/currency rendering degrade gracefully (null due dates show nothing; an unset currency env var silently defaults) even if only partially deployed.
- No data migration required. `npx prisma db push` is a no-op for this pack (zero schema changes) — confirm this explicitly during implementation by running it and confirming no diff, since "no schema change" is a claim worth verifying, not just asserting.
- Suggested merge/land order, since each item is fully independent of the others: (1) currency (smallest, purely mechanical, lowest risk), (2) brand/PWA assets (isolated to `layout.tsx`/`site.webmanifest`/two components), (3) due-date alerting (touches the most files, depends on nothing else in this pack), (4) mobile nav (new component, touches `Header.tsx`/`Sidebar.tsx`, independent of the other three but recommended last since it's the most interaction-heavy and benefits from being reviewed/QA'd on its own).
- Rollback: each item is a self-contained diff against files with no cross-item dependencies (the only shared file is `globals.css`, which only gains new classes, never removes/renames existing ones) — any single item can be reverted independently without touching the other three.
- Set `NEXT_PUBLIC_CURRENCY=NGN` in the real deployed `.env` (or accept the code-level default) before/at the same time as this deploy — otherwise there's a brief window where the build-time-inlined default is relied upon, which is safe (NGN is the correct default) but should be a conscious choice, not an accident.

## Open Questions
- **Verify the Base UI `DialogClose`/`render={<Button/>}` composition actually dispatches clicks before relying on it for the drawer's built-in close button.** `AGENTS.md` documents `DialogTrigger render={<Button/>}` as broken (click events silently swallowed) but does **not** mention `DialogClose`, which uses the same `render`-prop composition pattern internally inside `DialogContent`'s `showCloseButton` branch (`src/components/ui/dialog.tsx`, lines ~62–77). I did not have a running browser to test this myself. **This is a first-hour implementation task, not a blocking design question**: open any existing dialog (e.g., "Create Order") and click its X button. If it works, no change needed anywhere in this design. If it's broken like the Trigger case, the fix is small and already anticipated: pass `showCloseButton={false}` to the drawer's `DialogContent` and rely on outside-tap/Escape (both handled outside the broken `render`-prop path) plus, optionally, an explicit `<Button onClick={() => setOpen(false)}>` using the known-working direct-handler pattern.
- **Confirm the "Rostty" vs. "Rosty" spelling with the business owner** before this ships anywhere a real customer sees it (favicon, home-screen icon, PWA name — the PWA name is already sourced correctly from `site.webmanifest`'s `short_name: "Rosty"`, so this only affects the *image* assets, not text metadata). Not blocking implementation — ship the assets as provided; this is a content sign-off, not an engineering task.
