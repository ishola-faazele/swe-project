# Engineering Task List: Quick-Win Polish Pack + Enterprise UI Overhaul
**Generated**: 2026-08-18 (revision 2 — scope expanded from 4 items to 7)
**Source PRD**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/docs/prd-polish-pack.md`
**Source TDD**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/docs/tdd-polish-pack.md`
**Worktree**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack` (branch `feature/polish-pack` @ `321cdba`)
**Total Tasks**: 58 (53 core + 5 proactively suggested) across 7 phases
**Revises**: the 2026-08-17 version of this file (30 tasks, 4 items). See **Revision Log** below for exactly what changed.

---

## Revision Log (read this first)

The spec this list was built from grew from 4 items to 7 (added: enterprise-grade UI overhaul,
brand-text correction, inventory archive/retire) and picked up a real database schema change for
the first time. This is a correction-and-expansion pass, not a from-scratch rewrite — task IDs are
preserved wherever the underlying work is unchanged, so this file's diff against the prior version
stays reviewable.

**DROPPED (8 tasks):**
- `INFRA-001` (Bootstrap Vitest) — **its premise is now false**. Independently confirmed against
  the repo: `vitest.config.mts` and `vitest.integration.config.mts` both already exist, fully
  configured (`node` + `jsdom` projects, path aliases, a `next/cache` mock), and `package.json`
  already has `test`/`test:watch`/`test:integration` scripts wired to them. `npm test` and
  `npm run test:integration` both run today (139 tests, 60 unit + 79 integration, green per the
  orchestrator's pipeline-state verification). This is a genuine additional stale-claim finding on
  top of the two the orchestrator called out — see **Defects Found** below.
- `VERIFY-001` (confirm `DialogClose` dispatches clicks) — **resolved**. The orchestrator ran the
  spike; `DialogClose` works (including the default `DialogContent` X button). No fallback needed.
- `VERIFY-002` (confirm `prisma db push` is a zero-diff no-op) — **premise dead**. Item 7 adds
  `InventoryItem.isActive`, so there is now a real, intentional schema diff. Replaced by
  `MIGRATE-001`, a single gated, human-approved migration task (see below).
- `FE-012`, `FE-013`, `FE-014`, `FE-015`, `FE-016` — the old Sidebar/Header/MobileNavTrigger split
  is superseded by a consolidated set (`FE-024`–`FE-027`). The TDD's own Rollout Plan now
  explicitly recommends folding *all* of Sidebar's changes (tokens, `onNavigate`, real logo,
  `aria-label`, the Rostty text fix) into one diff, and same for Header (tokens, mobile-trigger
  mount, logo mark, `Button` sign-out swap) — "sequencing them separately would mean two review
  passes over the same diff." Splitting them as before would now mean *three* competing tasks
  touching the same two files (mobile-nav, brand/PWA, and the new UI overhaul all touch
  `Sidebar.tsx`/`Header.tsx`), which is exactly the collision the orchestrator flagged as the most
  important thing to avoid. `MobileNavTrigger.tsx`'s own design is unchanged in substance; it's
  carried forward as `FE-025` with `VERIFY-001`'s now-unnecessary fallback branch removed.

**REVISED (17 tasks):** `INFRA-002`, `BE-001`, `BE-002`, `TEST-001`, `TEST-002`, `FE-001`, `FE-002`,
`FE-004`, `FE-005`†, `FE-006`†, `FE-007`†, `BE-003`†, `TEST-003`, `FE-008`, `FE-009`, `FE-010`,
`FE-011`, `TEST-004` (18 total — see individual entries; `†` = dependency-only change, e.g.
dropping a reference to a now-dropped `VERIFY-002`).

**NEW (36 tasks):** every item-5 (design overhaul), item-6 (cancel-confirm), and item-7 (inventory
archive) task, plus the currency sites the Menu & Recipe System added since the last planning pass,
plus explicit test-churn tasks for the three categories of expected breakage the orchestrator
called out, plus two doc-drift corrections and two new proactive suggestions.

**UNCHANGED (2 tasks):** `PROACTIVE-001`, `PROACTIVE-002` carry forward with no edits.
`PROACTIVE-003` is lightly revised (the reduced-motion rule is now also codified globally in
Foundations, so this task is narrowed to a verification).

### Defects found while revising (cross-checked against the actual codebase, not just the TDD text)
1. **`INFRA-001` is stale** (see Dropped, above) — the TDD's own "What changed in this revision"
   section already flags this ("139 tests already exist and are green... no new Vitest config file
   is needed"), and a direct read of `vitest.config.mts`, `vitest.integration.config.mts`, and
   `package.json` confirms it. Carried forward from the TDD, independently re-verified here.
2. **The TDD's own master "Files touched" table (§0.8) mislabels `src/app/admin/orders/actions.ts`
   as needing a `MODIFY`** for the due-date work, captioned "call-site only: thread `dueDate`
   through." A direct read of that file confirms `createOrder` already accepts and persists
   `dueDate?: Date | null`, and `createOrderSchema` in `src/lib/validation.ts` already validates it
   — the *only* file that actually changes is `OrderClient.tsx` (the real call site). This is the
   same defect the previous planning round already caught and correctly worked around (no task was
   created against `orders/actions.ts` for this reason) — it persists unfixed in this TDD revision,
   so it's re-flagged here rather than silently re-absorbed. No task in this list touches
   `orders/actions.ts` for the due-date item.
3. **`RecipeBuilder` (in `MenuClient.tsx`) does not currently accept a `dish` prop**, but the TDD's
   §7.4 `optionsForRow(row, inventory, dish)` code sample requires one (to read
   `dish.ingredients` for the archived-item reinjection fallback). This is an inferred, not
   literal, implementation detail the TDD leaves implicit — `FE-022` below makes it explicit
   (threading `editingDish`/`null` into `RecipeBuilder` as a new prop) rather than leaving it
   ambiguous for the implementer.
4. **`FE-008`'s dashboard stat cards and `FE-009`'s orders "Due" column silently gained a new
   dependency** on this revision's Foundations work (`FE-017`) that the original TDD text doesn't
   flag as a dependency change: §3's dashboard code sample now describes the cards as "restyled
   per 0.2's type scale," and the orders-table row now uses `cn()` + a `.table-row` class (a *new*
   `@layer components` class from `FE-017`) instead of the old inline `style={{}}` ternary. Both
   tasks' Dependencies are updated accordingly below.

---

## Summary

This pack now ships seven items on top of the existing "Chop with Rosty" admin portal: a mobile
navigation drawer, Naira currency formatting, due-date/overdue alerting, brand/PWA asset wiring, an
enterprise-grade visual overhaul of the entire admin portal and customer-facing pages, a
confirm-before-cancel guard on order cancellation, and an inventory archive/retire feature mirroring
the already-shipped Dish archive pattern. Four of these (nav, currency, due-date, brand) were already
planned; three (overhaul, cancel-confirm, archive) are new since the last planning pass, and the
archive item brings this pack's first and only database schema change.

The single most important structural fact driving this plan's phase order: `globals.css` already
defines a complete semantic design-token set, but ~196 call sites across 13 files bypass it with raw
inline `oklch(...)` literals, and inline styles are structurally incapable of expressing either CSS
breakpoints or `:hover`/`:focus-visible` states. That means the design-foundations work (a new
`@layer components` type/spacing/select-field layer, badge utilities, and a global a11y/motion/
dark-mode base layer) is not just one more item — it is a hard prerequisite for the mobile nav
drawer (needs `md:` breakpoints) and for every accessibility requirement in the PRD (needs
`focus-visible`/`hover:`). Phase 1 puts this foundation, plus the pack's pure logic modules
(`currency.ts`, `dueDate.ts`, and the new `orderStatus.ts`), ahead of everything else.

The second structural fact: item 7's schema change (`InventoryItem.isActive`) requires an explicit,
human-approved push against **two** databases — the shared local dev database and the isolated
`rosty_integrity_test` integration database — before any application code can reference the new
field, or all 79 integration tests break. This is modeled as `MIGRATE-001`, a single blocking gate
task with no code dependencies of its own. Because it has no code dependencies, it does **not** need
to wait for Phase 1 — it should be scheduled as early as possible in parallel with everything else,
since it is gated on human approval and cross-pipeline database coordination, which will likely take
longer in wall-clock time than any single engineering task in this plan.

Finally, `Sidebar.tsx` and `Header.tsx` are each touched by three different concerns in this
revision (mobile nav, brand/PWA, and the design overhaul) — consolidated per-file tasks
(`FE-024`–`FE-027`) replace the previous plan's finer split specifically to avoid three tasks
generating competing diffs against the same two ~100-line files, per the TDD's own Rollout Plan
recommendation.

---

## Dependency Graph

```
Phase 1 — Foundations (design tokens, pure logic, docs)         [no dependencies; start immediately]
  FE-017 (type-scale/select-field classes) ─┬─→ everything in Phases 4-6 that uses .table-row/
  FE-018 (a11y/motion/dark-mode base layer) ┘   .select-field/.eyebrow/.stat-value/skip-link
  FE-001 (due-* + dish-* badge classes)     ──→ FE-009 (orders due column), FE-032 (menu badges)
  BE-001 (currency.ts) ──→ TEST-001, every FE currency task (Phase 2)
  BE-002 (dueDate.ts)  ──→ TEST-002, FE-008, FE-009
  BE-004 (orderStatus.ts) ──→ FE-028 (dashboard restyle), FE-034 (customer dashboard restyle)
  INFRA-002, INFRA-003 — independent, no downstream dependents

MIGRATE-001 — Gated schema migration                             [no code deps — schedule ASAP,
  (human-approved, two databases)                                 in parallel with Phase 1]
  └─→ BE-005 → BE-006, BE-007, FE-022, FE-023, TEST-007, TEST-008 → FE-031, FE-032 (partial)

Phase 2 — Currency, Due-Date & Cancel-Confirm (Orders + Menu)     depends on Phase 1
  FE-002, FE-003, FE-004, FE-019, FE-005 (currency call sites)
  FE-006 → FE-007 → BE-003 (due-date create/edit)
  BE-002, FE-001, FE-017 → FE-008 (dashboard stat cards), FE-009 (orders Due column)
  FE-020, FE-021 (cancel-confirm guards, independent of currency/due-date but same files)
  → TEST-003 (re-grep), TEST-005 (mock factory), TEST-006 (assertion rewrites)

Phase 3 — Gated Migration & Inventory Archive Backend             MIGRATE-001 is the only hard gate;
  (runs in parallel with Phases 1-2 once MIGRATE-001 clears)      rest of Phase 3 has no Phase 1/2 dep

Phase 4 — Admin Shell & Mobile Nav                                depends on Phase 1 only
  FE-024 (Sidebar) → FE-025 (MobileNavTrigger) → FE-026 (Header)
  FE-027 (AdminLayout), FE-010 (layout.tsx), FE-011 (manifest) — independent of the above chain

Phase 5 — Per-Screen Design Overhaul                              depends on Phase 1 + the Phase 2/3
  FE-028 (dashboard) ← FE-008                                     tasks touching the same file
  FE-029 (orders)     ← FE-002/003/006/007/009/FE-020
  FE-030 (order detail) ← FE-004/007/FE-021
  FE-031 (inventory)  ← BE-005, BE-006
  FE-032 (menu)       ← FE-019, FE-022
  FE-033 (customers)  ← Phase 1 only

Phase 6 — Customer-Facing Pages & Loading/Empty States            depends on Phase 1 (+ FE-005/BE-004
  FE-034, FE-035, FE-036, FE-037, FE-038, FE-039, FE-040           for FE-034 specifically)

Phase 7 — Testing & Polish                                        depends on ALL prior phases
  TEST-004 (manual QA checklist, final gate before merge)
```

| Phase | Theme | Task count | Hard gate |
|---|---|---|---|
| 1 — Foundations | Design tokens, pure logic modules, doc fixes | 10 | Nothing elsewhere may use `.table-row`/`.select-field`/`.eyebrow`/etc. before this lands |
| 2 — Currency/Due-Date/Cancel-Confirm | Orders + Menu logic wiring | 15 | Depends on Phase 1's pure modules and badge/table-row classes |
| 3 — Gated Migration & Inventory Archive | Schema change + archive backend | 8 | `MIGRATE-001` blocks all item-7 code; otherwise independent of Phases 1-2 |
| 4 — Admin Shell & Mobile Nav | Sidebar/Header/layout/manifest | 6 | Depends on Phase 1 only; independent of Phases 2-3 |
| 5 — Per-Screen Design Overhaul | Restyle every admin screen | 6 | Each task depends on Phase 1 + whichever Phase 2/3 tasks already touched that same file |
| 6 — Customer-Facing & Loading States | Dashboard, login, landing, skeletons | 7 | Depends on Phase 1 (+ Phase 2 currency work for the customer dashboard) |
| 7 — Testing & Polish | Final manual QA | 1 | Depends on everything above |

**Critical path** (longest engineering chain, excluding `MIGRATE-001`'s human-approval wall-clock
time, which runs in parallel): `FE-017`/`FE-018` (Foundations) → `FE-002`→`FE-006`→`FE-007`→`BE-003`
→`FE-009`→`FE-020` (Orders logic, Phase 2) → `FE-029` (Orders restyle, Phase 5) → `TEST-004` (final
manual QA). The inventory-archive chain (`MIGRATE-001`→`BE-005`→`FE-022`/`FE-023`/`FE-031`→`FE-032`)
is a **parallel** critical path whose start time is bounded by how quickly human approval for the
migration can be obtained, not by engineering effort — schedule `MIGRATE-001` first, today, so it
isn't the pack's actual bottleneck.

---

## Phase 1: Foundations

### BE-001 · Create `src/lib/currency.ts`
**Status**: UNCHANGED · **Category**: Backend (shared/isomorphic logic) · **Phase**: 1 · **Dependencies**: None

**Description**: A single module resolving the app's currency from `NEXT_PUBLIC_CURRENCY` (default
`NGN`/`en-NG`) and exposing `formatCurrency`, `getCurrencySymbol`, `getCurrencyCode`, and (new in
this revision) `BUSINESS_LOCALE`. This is the one place currency/locale formatting logic lives, so
every render site across Orders, Menu, and the customer dashboard stays consistent by construction.

**Technical Notes**: Implement exactly per TDD §2's code block — `CURRENCY_LOCALES` lookup table,
`resolveCurrencyCode()` validated via a throwaway `Intl.NumberFormat` + `RangeError` catch,
formatter built **once at module load**. Export `BUSINESS_LOCALE = "en-NG"` alongside the existing
three exports — the TDD now reuses this constant for date-formatting call sites in the overhaul
(§5.3's dashboard date header, §3's orders-table due-date label), so the locale choice lives in
exactly one place, not duplicated as a second hardcoded `"en-NG"` string elsewhere.

**Definition of Done**:
- [ ] File created at `src/lib/currency.ts` exporting `formatCurrency`, `getCurrencySymbol`, `getCurrencyCode`, `BUSINESS_LOCALE`.
- [ ] Unset `NEXT_PUBLIC_CURRENCY` → defaults to NGN with no warning logged.
- [ ] Invalid code (e.g., `"NGM"`) → falls back to NGN **and** logs a `console.warn` naming the bad value.
- [ ] `formatCurrency(NaN)` / `formatCurrency(Infinity)` formats `0` rather than throwing or rendering `"NaN"`.
- [ ] `getCurrencySymbol()` returns the bare symbol (e.g., `"₦"`), not a full formatted amount.
- [ ] TypeScript compiles with no errors.

**Estimated Complexity**: Medium — the validation/fallback branching and module-load-time singleton pattern have real edge cases, though the TDD provides near-complete code.

---

### BE-002 · Create `src/lib/dueDate.ts`
**Status**: UNCHANGED · **Category**: Backend (shared/isomorphic logic) · **Phase**: 1 · **Dependencies**: None

**Description**: A pure, timezone-pinned module exporting `getDueUrgency`, `ACTIVE_ORDER_STATUSES`,
and `isActiveOrderStatus`. Single source of truth for "what counts as active" and "is this order due
today/overdue," consumed by both the dashboard widget (`FE-008`) and the orders table (`FE-009`) so
the two can never drift out of sync.

**Technical Notes**: Implement exactly per TDD §3's code block — "today" computed via
`Intl.DateTimeFormat` pinned to `timeZone: "Africa/Lagos"` (UTC+1, no DST), comparison is
date-granular (`en-CA` `'YYYY-MM-DD'` string compare), `now` is an injectable second parameter
(default `new Date()`). The module's doc comment must state explicitly that **any future
client-side call site must pass an explicit, server-sourced `now`**, never call `new Date()` inside
a Client Component's render body — this is a hard design constraint stated in TDD §5.11, not just
implied by the signature, because a client-evaluated `now` could disagree with the server-rendered
value by a full day near the Lagos midnight boundary.

**Definition of Done**:
- [ ] File created at `src/lib/dueDate.ts` exporting `getDueUrgency`, `ACTIVE_ORDER_STATUSES`, `isActiveOrderStatus`, and the `DueUrgency` type.
- [ ] `getDueUrgency` uses `Intl.DateTimeFormat` with an explicit `timeZone: "Africa/Lagos"`, not `Date.prototype.getDate()`/ambient-TZ methods.
- [ ] `null`/`undefined`/malformed `dueDate` string returns `"none"` without throwing (`Number.isNaN(due.getTime())` guard).
- [ ] `ACTIVE_ORDER_STATUSES` is `["PENDING", "PREPPING", "COOKING", "READY"]`.
- [ ] `now` is a real second parameter with a default; doc comment states future client-side callers must pass an explicit server-sourced value.
- [ ] TypeScript compiles cleanly; `OrderStatus` imported from `@prisma/client`.

**Estimated Complexity**: Medium — the timezone-pinning logic is the highest-risk correctness surface in this whole pack; low line count but easy to get subtly wrong.

---

### BE-004 · Create `src/lib/orderStatus.ts`
**Status**: NEW · **Category**: Backend (shared/isomorphic logic) · **Phase**: 1 · **Dependencies**: None

**Description**: Order-status display metadata (label, emoji, badge className) currently exists as
two independent copies — `admin/page.tsx`'s local `statusConfig` and `dashboard/page.tsx`'s local
`statusColors`/`statusEmojis` (confirmed by direct read of both files) — that can silently drift.
This creates one shared, pure lookup table both screens import, so the customer's own order-status
badge becomes the *same* badge the admin sees, not a lookalike that happens to currently match by
coincidence.

**Technical Notes**: Per TDD §0.4. `ORDER_STATUS_CONFIG: Record<OrderStatus, {label, emoji,
className}>` mapping all six `OrderStatus` values to the existing `.status-*` classes already in
`globals.css` (no new CSS needed here — those classes already exist). No Prisma/`next/*` import,
same discipline as `src/lib/recipe.ts`. `dashboard/page.tsx`'s local `statusColors`/`statusEmojis`
maps (currently light-pastel Tailwind classes — `bg-yellow-100 text-yellow-800` etc., confirmed at
lines 5-21) are deleted in `FE-034`, not here — this task only creates the shared module.

**Definition of Done**:
- [ ] File created at `src/lib/orderStatus.ts` exporting `ORDER_STATUS_CONFIG`.
- [ ] All six `OrderStatus` values (`PENDING`, `PREPPING`, `COOKING`, `READY`, `COMPLETED`, `CANCELLED`) present with `label`/`emoji`/`className`.
- [ ] `className` values reference the existing `.status-*` classes in `globals.css` verbatim (no new class names invented here).
- [ ] No Prisma import beyond the `OrderStatus` type; no `next/*` import.
- [ ] TypeScript compiles cleanly.

**Estimated Complexity**: Low — a static lookup table, directly modeled on the already-shipped `ACTIVE_ORDER_STATUSES` precedent.

---

### FE-001 · Add due-date and dish-status badge utility classes to `globals.css`
**Status**: REVISED (scope expanded) · **Category**: Frontend · **Phase**: 1 · **Dependencies**: None

**Description**: Adds `.due-overdue`/`.due-today` (unchanged from the prior plan) **and now also**
`.dish-active`/`.dish-archived` (new in this revision — replaces `MenuClient.tsx`'s runtime
`statusColors` string-concatenation map). Both pairs land here because they're the same `@layer
utilities` idiom the file's existing `.status-*`/`.stock-*` classes already use, and both are
prerequisites for downstream tasks (`FE-009`, `FE-032`).

**Technical Notes**: Per TDD §0.3. Insert inside the existing `@layer utilities` block. `.due-overdue`
(`bg-red-950/60 text-red-400 border-red-800/50`), `.due-today` (`bg-amber-950/60 text-amber-400
border-amber-800/50`) — unchanged from before. New: `.dish-active` (`bg-emerald-950/50
text-emerald-300 border-emerald-700/40`, same visual family as `.status-ready`) and `.dish-archived`
(`bg-zinc-900/50 text-zinc-500 border-zinc-800`, same family as `.status-completed`). Purely
additive — no existing class renamed or removed.

**Definition of Done**:
- [ ] `.due-overdue`, `.due-today`, `.dish-active`, `.dish-archived` added to `src/app/globals.css` (MODIFY, additive only) inside the existing `@layer utilities` block.
- [ ] All four classes follow the existing `inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium` shape used by `.stock-*`.
- [ ] No existing class in the file renamed, removed, or restyled.
- [ ] `npm run dev` / `npm run build` compiles the stylesheet with no Tailwind errors.

**Estimated Complexity**: Low — four small `@apply` blocks copy-pasted from an established pattern already in the file.

---

### FE-017 · Add type-scale, spacing, and `.select-field` component classes to `globals.css`
**Status**: NEW · **Category**: Frontend · **Phase**: 1 · **Dependencies**: None

**Description**: The foundational task the entire design overhaul depends on. Codifies six reusable
type-scale/role classes (`.page-title`, `.eyebrow`, `.section-title`, `.stat-value`, `.meta-text`)
plus three table primitives (`.table-head-cell`, `.table-row`, `.table-cell-num`) and one native-
`<select>` fix (`.select-field`) as a **new** `@layer components` block — confirmed via direct read
that `globals.css` currently has no `@layer components` block at all, only `@layer base` and
`@layer utilities`. Every per-screen restyle task in Phases 4-6, plus `FE-009`'s due-column row
styling in Phase 2, depends on this landing first.

**Technical Notes**: Per TDD §0.2, verbatim. `.stat-value`/`.table-cell-num` both apply
`tabular-nums` — the PRD's explicit "numeric columns must not jitter" success metric. `.select-field`
is the concrete fix for the confirmed native-`<select>` legibility bug (§0.5): three different,
inconsistent `<select>` className treatments exist today (`bg-transparent` in `OrderClient.tsx`,
raw `bg-slate-100 dark:bg-slate-800` in `OrderDetailsClient.tsx`, `border-input bg-transparent` in
every picker) and none set an explicit `color`, which is a real, confirmed Windows-dark-mode
legibility bug, not a style nit. This is a decision to **extend** the existing `@theme inline` token
system, not build a parallel one (TDD Alternatives Considered) — every value used here already maps
to a token defined in `:root`/`.dark`.

**Definition of Done**:
- [ ] New `@layer components` block added to `src/app/globals.css` with all six type-scale classes, three table primitives, and `.select-field`.
- [ ] Every declared value maps to an existing `--*` token already defined in `:root`/`.dark` — no new raw color value introduced.
- [ ] `.select-field` includes explicit `bg-input`, `text-foreground`, and a `focus-visible:` ring — not `bg-transparent`.
- [ ] `.stat-value` and `.table-cell-num` both include `tabular-nums`.
- [ ] `.page-title` includes `text-balance`.
- [ ] `npm run build` compiles the stylesheet with no Tailwind errors; no existing `@layer utilities`/`@layer base` rule touched.

**Estimated Complexity**: Medium — small in line count, but every downstream restyle task (Phases 4-6) depends on getting these class names and semantics exactly right the first time; a late rename here would cascade into every restyled file.

---

### FE-018 · Add global accessibility, motion, and dark-mode base layer to `globals.css`
**Status**: NEW · **Category**: Frontend · **Phase**: 1 · **Dependencies**: None

**Description**: A single `@layer base` addition covering `color-scheme: dark` (fixes native
scrollbar/form-control chrome, complementary to `.select-field`'s explicit colors — TDD §0.5 notes
browsers vary in how completely they honor `color-scheme` alone), `touch-action: manipulation` on
interactive elements, and one global `prefers-reduced-motion: reduce` override that collapses every
animation/transition duration to near-zero — a single hard-to-forget safety net instead of auditing
every future `transition`/`animation` class by hand.

**Technical Notes**: Per TDD §0.7, verbatim CSS block. This task is CSS-only; the accompanying
`<main id="main-content">` skip-link target and the `<a href="#main-content">Skip to content</a>`
JSX itself are added in `FE-010` (root `layout.tsx`), `FE-027` (`AdminLayout.tsx`'s `<main>`), and
`FE-035` (`dashboard/layout.tsx`'s `<main>`) — not here, since those are three separate files this
task doesn't otherwise touch.

**Definition of Done**:
- [ ] `html { color-scheme: dark; }` added inside `@layer base` in `globals.css`.
- [ ] `a, button, [role="button"], summary { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }` added.
- [ ] A `@media (prefers-reduced-motion: reduce)` block collapsing `animation-duration`/`animation-iteration-count`/`transition-duration`/`scroll-behavior` to near-instant, applied globally (`*, *::before, *::after`).
- [ ] `npm run build` compiles with no Tailwind errors; no existing rule in `@layer base` removed.
- [ ] Manual check in DevTools "reduce motion" emulation: an existing transition (e.g. a `Button` hover) visibly collapses to near-instant.

**Estimated Complexity**: Low — a fixed, fully-specified CSS block from the TDD; the only risk is scope (global `*` selector) which is deliberate and stated in the TDD's own reasoning.

---

### TEST-001 · Unit tests for `src/lib/currency.ts`
**Status**: UNCHANGED · **Category**: Testing · **Phase**: 1 · **Dependencies**: BE-001

**Description**: Covers the fallback/validation branches that are easy to silently break —
particularly "invalid code falls back without throwing" and "NaN input doesn't render `NaN`."

**Technical Notes**: Per TDD Testing Strategy #2, **must** use `vi.resetModules()` + dynamic
`import()` per test case needing a different `NEXT_PUBLIC_CURRENCY` value — `resolveCurrencyCode()`
runs once at module load, so a single static top-level import cannot exercise the fallback branches.
Document this pattern in a comment in the test file itself.

**Definition of Done**:
- [ ] `src/lib/currency.test.ts` created.
- [ ] Test: unset `NEXT_PUBLIC_CURRENCY` → formats with `₦` (NGN default).
- [ ] Test: valid override (`GHS`) → formats with the correct GHS symbol/locale.
- [ ] Test: invalid code → falls back to NGN, does not throw.
- [ ] Test: `formatCurrency(NaN)` → formats `0`, not `"NaN"` or a thrown error.
- [ ] Test: `getCurrencySymbol()` returns just the symbol.
- [ ] `npm run test` passes all cases in this file (auto-discovered by the existing `node` project's `include: ['src/**/*.test.ts']` glob — no config change needed).

**Estimated Complexity**: Medium — the module-reset-per-test pattern is a real but non-obvious Vitest technique.

---

### TEST-002 · Unit tests for `src/lib/dueDate.ts`
**Status**: REVISED (timezone-boundary pair updated to match this TDD revision's exact example) · **Category**: Testing · **Phase**: 1 · **Dependencies**: BE-002

**Description**: The primary correctness target of this pack per the PRD's Success Metrics ("Zero
false negatives in the due-today/overdue derivation logic"). Covers the null case, the three urgency
states, the Lagos/UTC timezone boundary, a malformed-input guard, and the `isActiveOrderStatus` ×
`getDueUrgency` interaction.

**Technical Notes**: **This revision's boundary-crossing pair differs from the prior plan's** — this
TDD supplies its own corrected pair (the prior plan independently derived a different, also-valid
pair before this TDD revision existed; use *this* TDD's pair since it's now the primary source of
truth): `dueDate = new Date("2026-08-17T23:30:00Z")` (Lagos: `2026-08-18T00:30`, already "tomorrow"
locally) vs. `now = new Date("2026-08-18T00:15:00Z")` (Lagos: `2026-08-18T01:15`, also "today"
locally). UTC calendar days differ (Aug 17 vs Aug 18) but Lagos calendar days are the **same** (both
Aug 18) — assert `getDueUrgency(dueDate, now) === "due-today"`, proving the Lagos-pinned
implementation avoids a false "overdue" a naive UTC-only comparison would wrongly produce.

**Definition of Done**:
- [ ] `src/lib/dueDate.test.ts` created.
- [ ] Test: `null`/`undefined` `dueDate` → `"none"`.
- [ ] Test: past `dueDate`, today's `now` → `"overdue"`.
- [ ] Test: same calendar day (different time-of-day) → `"due-today"`.
- [ ] Test: future `dueDate` → `"upcoming"`.
- [ ] Test: the corrected Lagos/UTC boundary pair above (`2026-08-17T23:30:00Z` / `2026-08-18T00:15:00Z`) asserts `"due-today"`, with an inline comment explaining what a naive UTC-only implementation would wrongly compute (`"overdue"`).
- [ ] Test: malformed date string → `"none"`, does not throw.
- [ ] Test: `COMPLETED` order with a long-overdue `dueDate`, combined via `isActiveOrderStatus` at the call-site pattern → resolves to "not flagged."
- [ ] All `now` values passed explicitly; zero reliance on the real system clock.

**Estimated Complexity**: Medium — mostly mechanical, but the boundary-crossing instant pair requires careful UTC/WAT arithmetic (already worked out above; do not re-derive a different pair).

---

### INFRA-002 · Verify `.env.example` already documents `NEXT_PUBLIC_CURRENCY`
**Status**: UNCHANGED · **Category**: Infrastructure & Config · **Phase**: 1 · **Dependencies**: None

**Description**: `.env.example` already exists in the worktree (confirmed by direct read) with the
exact content the TDD proposes, including `NEXT_PUBLIC_CURRENCY="NGN"`. This task remains a
verification, not a creation, so an implementer doesn't overwrite a file that's already correct.

**Technical Notes**: One deliberate exception, confirmed by direct read and restated so it isn't
"fixed" by mistake: line 38's `FROM_EMAIL="Chop with Rosty <onboarding@resend.dev>"` still uses the
old single-t spelling in **this worktree**. Per TDD §4, this has already been corrected on `main`
(commit `e692724`) as a doc-only fix and is deliberately **not** re-touched here — editing it in
this branch risks a spurious conflict against that commit on the next rebase. Do not "fix" this
line as part of any Rostty-spelling task in this pack.

**Definition of Done**:
- [ ] `.env.example` confirmed present at the worktree root with `NEXT_PUBLIC_CURRENCY="NGN"` and an explanatory comment referencing `src/lib/currency.ts`.
- [ ] Confirmed line 38's `FROM_EMAIL` example is left as `"Chop with Rosty <...>"` (single-t), not edited.
- [ ] No other env var in the file altered or removed.

**Estimated Complexity**: Low — verification-only.

---

### INFRA-003 · Correct doc drift in `AGENTS.md` and `CLAUDE.md`
**Status**: NEW · **Category**: Infrastructure & Config · **Phase**: 1 · **Dependencies**: None

**Description**: Two orientation docs read by every coding agent that touches this repo contain
confirmed-stale claims that will actively mislead the next agent: `CLAUDE.md` says "no test suite
exists" when 139 tests across two configs already run today, and `AGENTS.md` names the wrong Base
UI package. Both were independently confirmed against the real `package.json`/`node_modules`.

**Technical Notes**: `CLAUDE.md`'s "No test suite exists" section (confirmed present, claims "no
`test` script... no test framework installed") is flatly wrong — `package.json` has `test`,
`test:watch`, and `test:integration` scripts, and `vitest`/`jsdom`/`@testing-library/*` are all
installed `devDependencies`. `AGENTS.md`'s Tech Stack table says `@base-ui-components/react`; the
actual dependency (confirmed in `package.json`) is `@base-ui/react` `^1.6.0`, imported as
`@base-ui/react/dialog` etc. (confirmed in `src/components/ui/dialog.tsx`). Also worth fixing in the
same pass: `AGENTS.md`'s Repository Layout tree omits `tests/` and the two `vitest.*.config.mts`
files entirely.

**Definition of Done**:
- [ ] `CLAUDE.md`'s "No test suite exists" section rewritten to accurately describe the existing `test`/`test:watch`/`test:integration` scripts and the 139-test baseline (unit + integration split).
- [ ] `AGENTS.md`'s Tech Stack table corrected from `@base-ui-components/react` to `@base-ui/react`.
- [ ] `AGENTS.md`'s Repository Layout tree updated to include `tests/integration/`, `vitest.config.mts`, `vitest.integration.config.mts`.
- [ ] No other content in either file altered.

**Estimated Complexity**: Low — text corrections only, no code change; confirmed via direct read of both files and `package.json`.

---

## Phase 2: Currency, Due-Date & Cancel-Confirm (Orders + Menu)

### FE-002 · Replace `$` with `formatCurrency()` in `OrderClient.tsx` — table cell + dish-picker option
**Status**: REVISED (scope expanded — dish-picker option site added) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-001

**Description**: The orders table's "Total" column (confirmed at line 104, `` `$${info.getValue()}` ``)
and the create-order dialog's dish-picker `<option>` (confirmed at line 231, `` `${dish.name}
($${dish.price})` `` — this second site is new since the last planning pass; it didn't exist before
the Menu & Recipe System shipped dish-based order creation).

**Technical Notes**: Per TDD §2. `formatCurrency(info.getValue())` for the cell; `{dish.name}
({formatCurrency(dish.price)})` for the option text.

**⚠️ Merge-conflict risk**: `OrderClient.tsx` is touched by `FE-003`, `FE-006`, `FE-009`, `FE-020`,
and `FE-029` in this pack. Keep this diff scoped to exactly these two currency sites.

**Definition of Done**:
- [ ] `src/app/admin/orders/OrderClient.tsx` (MODIFY) — `totalPrice` column's `cell` calls `formatCurrency(info.getValue())`.
- [ ] Dish `<option>` text calls `formatCurrency(dish.price)` instead of `` `$${dish.price}` ``.
- [ ] `import { formatCurrency } from "@/lib/currency"` added.
- [ ] No literal `$` remains in either render path.
- [ ] Manual check: orders table and dish picker both render `₦`-formatted amounts in dev.

**Estimated Complexity**: Low — two single-expression changes to an already-imported module.

---

### FE-003 · Replace `$` with `getCurrencySymbol()` in `OrderClient.tsx` form label
**Status**: UNCHANGED · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-001

**Description**: The create-order form's "Total Price ($)" label (confirmed at line 188) hardcodes
the dollar sign in the label text itself, independent of `FE-002`'s cell/option changes.

**Technical Notes**: Per TDD §2. `<Label htmlFor="totalPrice">Total Price ({getCurrencySymbol()})</Label>`.

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-006`/`FE-009`/`FE-020`/`FE-029`.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — form label reads `Total Price ({getCurrencySymbol()})`.
- [ ] `getCurrencySymbol` added to the existing `@/lib/currency` import.
- [ ] Manual check: label renders `Total Price (₦)` in dev.

**Estimated Complexity**: Low — single JSX text change.

---

### FE-004 · Replace `$` with `formatCurrency()` across all five `OrderDetailsClient.tsx` sites
**Status**: REVISED (scope expanded from 1 site to 5) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-001

**Description**: The order detail page has five confirmed currency sites (re-audited against the
current, post-Menu-System codebase — the prior plan only covered the first): the total-price display
(line 145), each `OrderDish` row's unit price (line 213) and line total (line 214), the dish-picker
`<option>` text (line 236), and the "Total Price ($)" edit-form label (line 275).

**Technical Notes**: Per TDD §2, exact JSX for each site: `{formatCurrency(order.totalPrice)}`,
`{formatCurrency(orderDish.unitPrice)}`, `{formatCurrency(orderDish.unitPrice *
orderDish.quantity)}`, `{option.name} ({formatCurrency(option.price)})`, and `Total Price
({getCurrencySymbol()})`.

**⚠️ Merge-conflict risk**: `OrderDetailsClient.tsx` is also touched by `FE-007`, `FE-021`, and
`FE-030` in this pack.

**Definition of Done**:
- [ ] `src/app/admin/orders/[id]/OrderDetailsClient.tsx` (MODIFY) — all five sites listed above converted to `formatCurrency`/`getCurrencySymbol`.
- [ ] `import { formatCurrency, getCurrencySymbol } from "@/lib/currency"` added.
- [ ] No literal `$` remains anywhere in this file.
- [ ] Manual check: order detail page renders `₦`-formatted amounts at every one of the five sites.

**Estimated Complexity**: Low — five single-expression changes, all in the same file, same pattern.

---

### FE-019 · Replace `$` with `formatCurrency()`/`getCurrencySymbol()` in `MenuClient.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-001

**Description**: Three currency sites in the dish catalog — the table's price cell (line 253), the
create-form "Price ($)" label (line 343), and the edit-form "Price ($)" label (line 373). This
screen didn't exist when the pack was first planned (it shipped with the separately-merged Menu &
Recipe System).

**Technical Notes**: Per TDD §2. `formatCurrency(info.getValue())` for the cell (keep the existing
`font-mono-data table-cell-num text-foreground` wrapper — `table-cell-num` is a `FE-017` class, so
this is safe to write now since `FE-017` lands in the same phase before this); `Price
({getCurrencySymbol()})` for both labels.

**⚠️ Merge-conflict risk**: `MenuClient.tsx` is also touched by `FE-022` and `FE-032` in this pack.

**Definition of Done**:
- [ ] `src/app/admin/menu/MenuClient.tsx` (MODIFY) — price cell and both price labels converted.
- [ ] `import { formatCurrency, getCurrencySymbol } from "@/lib/currency"` added.
- [ ] No literal `$` remains anywhere in this file.
- [ ] Manual check: dish table and both create/edit forms render `₦`-formatted amounts.

**Estimated Complexity**: Low — three single-expression changes.

---

### FE-005 · Replace `$` with `formatCurrency()` in `dashboard/page.tsx`
**Status**: UNCHANGED · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-001

**Description**: The customer-facing order-history dashboard (confirmed at line 102, ``
${order.totalPrice.toFixed(2)} ``) is the only currency site a *customer* sees.

**Technical Notes**: Per TDD §2. This is a Server Component — `formatCurrency` runs server-side here.

**Definition of Done**:
- [ ] `src/app/dashboard/page.tsx` (MODIFY) — price span calls `formatCurrency(order.totalPrice)`, dropping the now-redundant manual `.toFixed(2)`.
- [ ] `import { formatCurrency } from "@/lib/currency"` added.
- [ ] Manual check: logged in as a customer, order history shows `₦`-formatted totals.

**Estimated Complexity**: Low — single-line change.

---

### BE-003 · Add `updateOrderDueDate` Server Action
**Status**: REVISED (dependency only — `VERIFY-002` dropped, no longer blocked) · **Category**: Backend · **Phase**: 2 · **Dependencies**: None

**Description**: A new Server Action allowing the admin to set/correct an order's due date after
creation, mirroring the existing inline `updateOrderStatus` pattern in the same file's sibling
`orders/actions.ts`. This item's schema field (`Order.dueDate`) already existed before this pack —
unlike item 7, this action needs **no** schema migration and is not gated by `MIGRATE-001`.

**Technical Notes**: Per TDD §3, matching `updateOrderItems`' exact pattern (`requireAdmin()` →
zod `.parse()` inside `try` → `toErrorResult(...)` on catch → `revalidatePath()` → `okResult(...)`).
New `updateOrderDueDateSchema` in `src/lib/validation.ts`: `z.object({ id: idSchema, dueDate:
z.date().nullish() })`. `toErrorResult` already converts a Prisma `P2025` (order deleted in another
tab) into a clean `NOT_FOUND` result — no extra existence check needed.

**Definition of Done**:
- [ ] `src/lib/validation.ts` (MODIFY) — `updateOrderDueDateSchema` added.
- [ ] `src/app/admin/orders/[id]/actions.ts` (MODIFY) — new exported `updateOrderDueDate(id: string, dueDate: Date | null): Promise<ActionResult<Order>>`, gated with `requireAdmin()` + schema `.parse()`.
- [ ] Calls `revalidatePath('/admin/orders/${id}')` and `revalidatePath('/admin/orders')`.
- [ ] Errors go through `toErrorResult`, matching every sibling action in this file.
- [ ] TypeScript compiles cleanly.

**Estimated Complexity**: Low — a five-line function mirroring an existing pattern in the same file.

---

### FE-006 · Add due-date input to order create form
**Status**: REVISED (dependency only — `VERIFY-002` dropped) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: None

**Description**: **Load-bearing, not optional polish**: `createOrder` in `orders/actions.ts` already
accepts and persists `dueDate?: Date | null` (confirmed by direct read — no backend change needed),
but no screen has ever collected it. Without this task, `FE-008`/`FE-009` would ship reading zero
forever.

**Technical Notes**: Per TDD §3. Add `<Label htmlFor="dueDate">Due Date (Optional)</Label>` +
`<Input id="dueDate" name="dueDate" type="date" />`. In `handleAdd`, parse `""` → `null`, otherwise
`new Date(dueDateStr)` — `new Date("YYYY-MM-DD")` parses as UTC midnight, which is still the same
calendar day in Lagos (UTC+1), so this is intentionally **not** "fixed" to local-time parsing;
document this inline so a future edit doesn't undo it. **No change to `orders/actions.ts`** —
confirmed unnecessary (see Defects Found #2 above); `createOrder`'s existing signature and
`createOrderSchema` already handle `dueDate`.

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-003`/`FE-009`/`FE-020`/`FE-029`.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — due-date `<Input type="date">` added to the create-order form grid.
- [ ] `handleAdd` parses the date field (empty → `null`) and includes `dueDate` in the `createOrder(...)` call's argument object.
- [ ] **No change made to `src/app/admin/orders/actions.ts`** — confirmed unnecessary.
- [ ] Manual check: creating an order with a due date persists it (visible on the order detail page immediately after creation).
- [ ] Manual check: leaving the field blank still succeeds with no validation error.

**Estimated Complexity**: Medium — touches both form markup and `handleAdd`'s parsing logic.

---

### FE-007 · Add inline due-date edit to `OrderDetailsClient.tsx`
**Status**: REVISED (dependency only — `VERIFY-002` dropped; new test-churn note added) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-003

**Description**: Lets the admin set/correct a due date after order creation, mirroring the existing
inline status-`<select>` pattern.

**Technical Notes**: Per TDD §3. `<input type="date" defaultValue={...} onChange={...} />` calling
`updateOrderDueDate` then `router.refresh()`. **Test-churn note (carry forward to test-engineer,
not a task in this list)**: `OrderDetailsClient.test.tsx` currently mocks `./actions` as `vi.mock('./actions', () => ({ updateOrderItems: vi.fn() }))` (confirmed at line 20) — once this file
imports and calls `updateOrderDueDate`, any test exercising this component will fail with
"updateOrderDueDate is not a function" unless the mock factory is updated. `TEST-005` below is that
update.

**⚠️ Merge-conflict risk**: same file as `FE-004`/`FE-021`/`FE-030`.

**Definition of Done**:
- [ ] `OrderDetailsClient.tsx` (MODIFY) — `<input type="date">` added next to the existing status `<select>`, `defaultValue` derived from `order.dueDate`.
- [ ] `onChange` calls `updateOrderDueDate(order.id, parsedDateOrNull)` then `router.refresh()`.
- [ ] `import { updateOrderDueDate } from "./actions"` added.
- [ ] Manual check: editing the due date persists after a hard page reload.
- [ ] Manual check: clearing the date input sets `dueDate` back to `null` (verified via hard reload).

**Estimated Complexity**: Medium — mirrors an existing pattern closely, but the null-clearing path needs explicit verification.

---

### FE-008 · Add "Due Today" / "Overdue" stat cards to admin dashboard
**Status**: REVISED (new dependency on `FE-017` — see Defects Found #4) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-002, FE-017

**Description**: Surfaces the PRD's core success metric on the dashboard. Extends the existing
`stats` array / `.stat-card` pattern.

**Technical Notes**: Per TDD §3. Add a parallel query to the existing `Promise.all`:
`prisma.order.findMany({ where: { status: { in: ACTIVE_ORDER_STATUSES } }, select: { dueDate: true
} })`. Derive counts via `.filter(o => getDueUrgency(o.dueDate) === 'due-today' | 'overdue')`.
Append two entries to `stats`, and **change the grid class from `sm:grid-cols-2 lg:grid-cols-4` to
`sm:grid-cols-2 lg:grid-cols-3`** for a clean 2×3 layout of the now-six-card grid — easy to forget
since it's not part of the stats-array logic itself. This revision's TDD text describes the new
cards as using `.eyebrow`/`.stat-value` (from `FE-017`) — write the two new cards with those classes
directly rather than inline styles, even though the *existing* four cards aren't converted until
`FE-028`.

**Definition of Done**:
- [ ] `src/app/admin/page.tsx` (MODIFY) — new `prisma.order.findMany` query added to the existing `Promise.all` array.
- [ ] `import { ACTIVE_ORDER_STATUSES, getDueUrgency } from '@/lib/dueDate'` added.
- [ ] Two new stat-card entries appended, using `.eyebrow`/`.stat-value` classes (not inline `style={{}}`).
- [ ] Grid class changed to `sm:grid-cols-2 lg:grid-cols-3`.
- [ ] Manual check: counts match manually-verified due-today/overdue orders in local dev (requires `FE-006`/`FE-007` to actually set due dates).

**Estimated Complexity**: Medium — straightforward query/array extension, but the grid-class change and count-correctness both need manual verification.

---

### FE-009 · Add "Due" column + row tint to orders table
**Status**: REVISED (row styling now uses `cn()` + token classes instead of inline `style={{}}` — see Defects Found #4) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: BE-002, FE-001, FE-017

**Description**: Surfaces due-date urgency in the orders table — a colored, text-labeled badge for
qualifying active orders, plus a subtle row tint that reinforces (never replaces) the badge.

**Technical Notes**: Per TDD §3 (this revision's code sample). New `columnHelper.accessor("dueDate",
...)` column, gated by `isActiveOrderStatus(status)` before calling `getDueUrgency`. **Row styling
is now token-based, not inline**: `<tr className={cn("table-row cursor-pointer", urgency ===
'overdue' && 'bg-destructive/8 hover:bg-destructive/12', urgency === 'due-today' && 'bg-primary/6
hover:bg-primary/10', urgency === 'none' && (idx % 2 === 0 ? 'bg-card/40' : ''))}>` — this replaces
the old inline `style={{ background, borderBottom }}` ternary entirely, and is what makes the new
`hover:` variant possible (inline styles cannot express `:hover`). `bg-destructive/8`/`bg-primary/6`
are value-preserving conversions of the same alpha-composited colors the old inline version used.
Badge always pairs an icon (`aria-hidden="true"`) with text ("Overdue"/"Due Today"), never color
alone.

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-003`/`FE-006`/`FE-020`; land after those,
before `FE-029` (the broader restyle pass), to minimize rebase churn.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — new `dueDate` accessor column added after "Status", using `.due-overdue`/`.due-today` classes from `FE-001`.
- [ ] Row `<tr>` uses `cn()` + `.table-row` + conditional token classes (not inline `style={{}}`), with a working `hover:` variant.
- [ ] Manual check: a `COMPLETED` order with a long-past `dueDate` shows **neither** the badge **nor** the row tint.
- [ ] Manual check: badge always shows both an icon glyph and text, never color-only.
- [ ] Manual check: `null` `dueDate` renders `—`, not a blank cell or a JS error.

**Estimated Complexity**: Medium — column + row-styling logic is small individually, but the status-gating interaction and the inline-to-token conversion both need care.

---

### FE-020 · Add cancel-confirmation guard to `OrderClient.tsx` status select
**Status**: NEW (item 6) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: None

**Description**: Selecting "Cancelled" in the orders table's status dropdown currently transitions
immediately with no confirmation — a single misclick permanently cancels a real order (cancellation
is deliberately terminal; no un-cancel exists). This adds a native `confirm()` guard *before* the
existing, unmodified `updateOrderStatus` call.

**Technical Notes**: Per TDD §6 — **hard constraint**: `updateOrderStatus` and its `leavingCancelled`
rejection logic in `orders/actions.ts` are already merged, already tested, and **do not change at
all**. This is a client-side guard only. `if (val === 'CANCELLED') { const confirmed = confirm(
'Cancel order #${shortId}? This cannot be undone — a new order must be created if this was a
mistake.'); if (!confirmed) return }` before the existing `try { await updateOrderStatus(...) }`
block. The `<select>` already renders `disabled={status === 'CANCELLED'}`, so this guard can only
ever fire on the "entering `CANCELLED`" transition — no extra condition needed to exclude the
already-cancelled case. Declining reverts the controlled `<select>` to its bound value automatically
— the same mechanism already used for the `!result.ok` early-return case a few lines below.
`window.confirm()`, not the `toast` system — matches every other destructive-action guard in this
app (`InventoryClient`/`CustomerClient`/`MenuClient` delete flows). **No shared helper/constant** for
the two-line guard — matches this codebase's established per-screen-duplication grain (see `FE-021`,
which duplicates this near-identically).

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-003`/`FE-006`/`FE-009`; independent of their
logic, but same `<select>`'s `onChange` handler — land after `FE-009` to avoid touching the same
lines twice.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — status `<select>`'s `onChange` guards a transition to `'CANCELLED'` with `confirm(...)` before calling `updateOrderStatus`.
- [ ] Declining the confirm returns early without calling `updateOrderStatus`.
- [ ] Confirm message names the order by `shortId` (e.g. "Cancel order #42?").
- [ ] `updateOrderStatus`, its import, and `orders/actions.ts` are **unmodified** — confirmed by re-reading the file after this change.
- [ ] Manual check: selecting "Cancelled" then declining leaves the status visibly unchanged, no flicker.

**Estimated Complexity**: Low — a five-line client-side guard with no server-side change.

---

### FE-021 · Add cancel-confirmation guard to `OrderDetailsClient.tsx` status select
**Status**: NEW (item 6) · **Category**: Frontend · **Phase**: 2 · **Dependencies**: None

**Description**: Identical guard to `FE-020`, applied to the order detail page's status `<select>`,
so cancellation requires confirmation from **both** places it can happen (PRD success metric:
"100% of order-cancellation attempts... require an explicit confirm").

**Technical Notes**: Per TDD §6 — identical guard, same message shape, referencing `order.shortId`
(already in scope) instead of `info.row.original.shortId`. Same hard constraint: `updateOrderStatus`
is unmodified.

**⚠️ Merge-conflict risk**: same file as `FE-004`/`FE-007`/`FE-030`.

**Definition of Done**:
- [ ] `OrderDetailsClient.tsx` (MODIFY) — status `<select>`'s `onChange` guards a transition to `'CANCELLED'` with `confirm(...)` before calling `updateOrderStatus`.
- [ ] Declining the confirm returns early without calling `updateOrderStatus`.
- [ ] Confirm message names the order by `order.shortId`.
- [ ] `updateOrderStatus` import and `orders/actions.ts` are unmodified.
- [ ] Manual check: selecting "Cancelled" then declining leaves the status visibly unchanged.

**Estimated Complexity**: Low — mirrors `FE-020` exactly.

---

### TEST-003 · Re-grep `src/` for missed `$` price-rendering sites
**Status**: REVISED (12 sites, not 4; `MenuClient.tsx` added to the checklist) · **Category**: Testing · **Phase**: 2 · **Dependencies**: FE-002, FE-003, FE-004, FE-005, FE-019

**Description**: Directly verifies the PRD's binary success metric ("Zero occurrences of a literal
`$` currency symbol... across all 12 confirmed sites") rather than trusting the TDD's
pre-implementation audit.

**Technical Notes**: Grep pattern `\$\{|\$\$|"\$"|'\$'` across `src/`, plus a direct look at
`src/lib/notifications/email.ts`/`sms.ts` (neither renders `totalPrice`, confirmed) and
`prisma/seed.ts` (no `$`-prefixed price generation, confirmed).

**Definition of Done**:
- [ ] Ran a `$`-pattern grep across the full `src/` tree (excluding template-literal `${}` interpolation that isn't a currency symbol).
- [ ] Zero hits remain in `OrderClient.tsx`, `OrderDetailsClient.tsx`, `MenuClient.tsx`, `dashboard/page.tsx` beyond what `FE-002`/`FE-003`/`FE-004`/`FE-005`/`FE-019` already fixed.
- [ ] `src/lib/notifications/email.ts` and `sms.ts` explicitly re-checked — confirmed neither renders `totalPrice`.
- [ ] `prisma/seed.ts` checked — confirmed no `$`-prefixed price string generation.
- [ ] Result recorded as satisfying the PRD's currency success metric (all 12 sites, not 4).

**Estimated Complexity**: Low — a verification pass, not new code.

---

### TEST-005 · Update `OrderDetailsClient.test.tsx`'s mock factory for `updateOrderDueDate`
**Status**: NEW · **Category**: Testing · **Phase**: 2 · **Dependencies**: FE-007

**Description**: `OrderDetailsClient.test.tsx` currently mocks `./actions` as `{ updateOrderItems:
vi.fn() }` only (confirmed at line 20). Once `FE-007` lands, any existing test that renders this
component will fail with "updateOrderDueDate is not a function" unless the mock factory is updated
— this is expected, mechanical test churn caused directly by `FE-007`, not a regression to
investigate.

**Technical Notes**: `vi.mock('./actions', () => ({ updateOrderItems: vi.fn(), updateOrderDueDate:
vi.fn() }))`. This is the minimum fix to keep the existing suite passing; it does not add new
assertions for the due-date input itself (per the TDD's Testing Strategy, component-level changes
that don't alter an accessible name/role/label don't get new automated coverage in this pack).

**Definition of Done**:
- [ ] `OrderDetailsClient.test.tsx` (MODIFY) — mock factory includes `updateOrderDueDate: vi.fn()`.
- [ ] `npm run test` — this file's existing suite passes with no "not a function" errors.
- [ ] No new test assertions added in this task (out of scope per Testing Strategy — see `FE-007`).

**Estimated Complexity**: Low — a one-line mock factory addition.

---

### TEST-006 · Update existing test assertions broken by the currency-formatting change
**Status**: NEW · **Category**: Testing · **Phase**: 2 · **Dependencies**: FE-002, FE-003, FE-004, FE-019

**Description**: Nine existing, currently-passing test assertions hard-code the `$` symbol and will
fail once `FE-002`/`FE-003`/`FE-004`/`FE-019` land — this is expected, intentional breakage (the
whole point of the currency work) requiring a lockstep assertion rewrite, not a feature revert.

**Technical Notes**: Confirmed exact sites by direct grep: `OrderClient.test.tsx:117`
(`expect.arrayContaining(['Jollof Rice ($1200)', 'Meat Pie ($350)'])`), `:143`, `:172`
(`getByLabelText('Total Price ($)')`); `OrderDetailsClient.test.tsx:174`
(`getByLabelText('Total Price ($)')`); `MenuClient.test.tsx:95` (`getByText('$1200')`), `:156`,
`:184`, `:198` (`getByLabelText('Price ($)')`), `:209` (`getByText('$1500')`). Update each to the
`₦`-formatted equivalent that `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN'
})` actually produces for that amount — verify the exact string in a real Node REPL rather than
guessing the format (Naira formatting includes a thousands separator and two decimal places, e.g.
`₦1,200.00`).

**Definition of Done**:
- [ ] `OrderClient.test.tsx:117` — `Jollof Rice ($1200)`/`Meat Pie ($350)` updated to their `₦`-formatted equivalents.
- [ ] `OrderClient.test.tsx:143`, `:172` — `getByLabelText('Total Price ($)')` updated to `getByLabelText('Total Price (₦)')`.
- [ ] `OrderDetailsClient.test.tsx:174` — same label update.
- [ ] `MenuClient.test.tsx:95`, `:209` — `$1200`/`$1500` updated to their `₦`-formatted equivalents.
- [ ] `MenuClient.test.tsx:156`, `:184`, `:198` — `getByLabelText('Price ($)')` updated to `getByLabelText('Price (₦)')`.
- [ ] `npm run test` passes all three files with zero currency-related failures.

**Estimated Complexity**: Low — mechanical string updates, but must run against real `formatCurrency` output rather than hand-guessed strings to avoid a second round of flaky fixes.

---

## Phase 3: Gated Migration & Inventory Archive Backend

> **This phase has no dependency on Phase 1 or Phase 2 and should start as early as possible** —
> `MIGRATE-001` requires human approval and cross-pipeline database coordination, which is likely to
> take longer in wall-clock time than the engineering work in this pack. Do not wait for Phase 1 to
> finish before kicking this off.

### MIGRATE-001 · Gated schema migration — add `InventoryItem.isActive` to both databases
**Status**: NEW (replaces dropped `VERIFY-002`) · **Category**: Infrastructure & Config · **Phase**: 3 · **Dependencies**: None

**Description**: Item 7's only schema change (`InventoryItem.isActive Boolean @default(true)`) must
be applied to two separate databases — the shared local dev database (`postgres` on
`127.0.0.1:54322`) and the isolated `rosty_integrity_test` integration-test database — before any
application code references the new field, or all 79 integration tests break (the generated Prisma
Client will select a column the test database doesn't have). This is modeled as a single blocking
gate, per explicit instruction: it must be human-approved, never silently scripted into a normal dev
or test loop.

**Technical Notes**: Per TDD §7.1 and Rollout Plan, exact procedure:
1. Add `isActive Boolean @default(true)` to `InventoryItem` in `prisma/schema.prisma`, then run
   `npx prisma generate` to regenerate the TypeScript client/types.
2. **Human-approved** `npx prisma db push` against the local dev database (default `DATABASE_URL`).
   This database may be shared with other concurrently active worktrees against the same local
   Supabase Docker stack — confirm no other active pipeline depends on `InventoryItem`'s current
   shape before pushing.
3. **Human-approved**, explicitly isolated push against `rosty_integrity_test`:
   ```bash
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test" \
   DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test" \
   npx prisma db push
   ```
   Never accomplish this by temporarily swapping `.env`/`.env.test` — too easy to forget to swap
   back. `vitest.integration.config.mts`'s own header comment and `tests/integration/guard-database-url.ts` both hard-fail any test run pointed anywhere else — this cannot be skipped or
   automated around.
4. **Do NOT run `prisma db seed` against either database as part of this step, or at any other
   point in this pack's implementation.** `prisma/seed.ts` opens with a sequence of `deleteMany()`
   calls — it is a destructive wipe-and-repopulate script. The additive column backfills every
   existing row with `isActive: true` at the Postgres level; there is no data-shape reason to
   reseed, and doing so would destroy existing fixture/dev data, possibly a concurrently-running
   pipeline's data.
5. Only after steps 1–4 are confirmed complete does any of `BE-005`/`BE-006`/`BE-007`/`FE-022`/
   `FE-023`/`FE-031` get written or merged.

**Definition of Done**:
- [ ] `prisma/schema.prisma` (MODIFY) — `isActive Boolean @default(true)` added to `InventoryItem`.
- [ ] `npx prisma generate` run; generated client includes `isActive` on the `InventoryItem` type.
- [ ] **Human approval obtained and recorded** (e.g. in the PR description) before either `db push` below runs.
- [ ] `npx prisma db push` run against the local dev database; output confirms the additive column applied with no data loss.
- [ ] `npx prisma db push` run against `rosty_integrity_test` using the explicit inline `DATABASE_URL`/`DIRECT_URL` override shown above — never via a `.env`/`.env.test` swap.
- [ ] `prisma db seed` confirmed **not** run against either database as part of this task.
- [ ] `npm run test:integration` passes (79/79) after the `rosty_integrity_test` push, proving the schema is in sync.

**Estimated Complexity**: Low engineering effort, **High coordination risk** — the commands themselves are simple and fully specified, but this task cannot proceed without a human explicitly approving two separate database writes, one of which is shared with other concurrent work.

---

### BE-005 · Correct `deleteInventoryItem`, add `toggleInventoryItemActive`, extend `getInventoryItems`
**Status**: NEW (item 7) · **Category**: Backend · **Phase**: 3 · **Dependencies**: MIGRATE-001

**Description**: Fixes a real, confirmed bug (`deleteInventoryItem`'s pre-check only counts
`OrderIngredientLog` rows, never `DishIngredient` rows — confirmed by direct read of the current
`inventory/actions.ts`, lines 65-92) and adds the archive-instead-of-error behavior in the same
change, mirroring `deleteDish`/`toggleDishActive` but extended to fit Inventory's own stricter,
already-established `requireAdmin()` + zod + `ActionResult` contract (not Dish's looser,
pre-hardening shape).

**Technical Notes**: Per TDD §7.2, exact code. `deleteInventoryItem`'s return type changes from
`ActionResult<void>` to `ActionResult<{ archived: boolean }>` — a controlled, single-caller breaking
change; `FE-031` updates the one call site. Both `orderIngredientLog.count` and
`dishIngredient.count` checked via `Promise.all` before deciding archive-vs-hard-delete. New
`toggleInventoryItemActive(id, isActive)` gives an explicit, manual archive/restore action, separate
from the automatic-archive-on-conflict fallback. `getInventoryItems` gains an optional
`{ includeArchived?: boolean }` parameter, defaulting to active-only (`where: { isActive: true }`) —
this is backward compatible: every existing no-argument call site (`menu/page.tsx`,
`orders/page.tsx`, `orders/[id]/page.tsx`) automatically starts receiving only active items with
**zero changes to those three files**, which is correct for all three since they only ever use the
result as picker/reference data.

**Definition of Done**:
- [ ] `src/app/admin/inventory/actions.ts` (MODIFY) — `deleteInventoryItem` checks both `orderIngredientLog.count` and `dishIngredient.count`; archives (`isActive: false`) if either is non-zero, hard-deletes only if both are zero.
- [ ] `deleteInventoryItem`'s return type is `ActionResult<{ archived: boolean }>`.
- [ ] New `toggleInventoryItemActive(id: string, isActive: boolean): Promise<ActionResult<InventoryItem>>` exported, `requireAdmin()`-gated, `idSchema`-validated.
- [ ] `getInventoryItems` accepts an optional `{ includeArchived?: boolean }`, defaulting to `where: { isActive: true }`.
- [ ] All three existing no-argument call sites (`menu/page.tsx`, `orders/page.tsx`, `orders/[id]/page.tsx`) confirmed to need **zero** changes — re-read after this task to verify.
- [ ] TypeScript compiles cleanly.

**Estimated Complexity**: Medium — the two-table FK check and the archive-vs-delete branching are the correctness-critical core of this feature, and the return-type change has one downstream caller to track.

---

### BE-006 · Update `inventory/page.tsx` for `includeArchived` + active-only header count
**Status**: NEW (item 7) · **Category**: Backend · **Phase**: 3 · **Dependencies**: BE-005

**Description**: The one call site that must explicitly opt into seeing archived items (so
`FE-031`'s "Show Archived" toggle has data to reveal), plus a header-count fix so "N items tracked"
means actively tracked, not "N including retired ones."

**Technical Notes**: Per TDD §7.3. `const items = await getInventoryItems({ includeArchived: true
})`; `const activeCount = items.filter(i => i.isActive).length`; header text uses `activeCount`, not
`items.length`.

**Definition of Done**:
- [ ] `src/app/admin/inventory/page.tsx` (MODIFY) — `getInventoryItems({ includeArchived: true })` call.
- [ ] Header count computed from `activeCount`, not the full (archived-inclusive) array length.
- [ ] Manual check: after archiving one item via `FE-031`'s UI, the header count decreases by one while the full list (with "Show Archived" on) still shows it.

**Estimated Complexity**: Low — a two-line change.

---

### BE-007 · Add `isActive` filter to `admin/page.tsx`'s low-stock query
**Status**: NEW (item 7) · **Category**: Backend · **Phase**: 3 · **Dependencies**: MIGRATE-001

**Description**: `admin/page.tsx`'s low-stock computation is a **direct** Prisma call (confirmed at
line 26: `prisma.inventoryItem.findMany({ select: { currentStock: true, minimumThreshold: true }
})`), not routed through `getInventoryItems()` — `BE-005`'s default-filter fix does **not** reach
this call site, so it needs its own explicit fix. Without this, an archived ingredient (likely
sitting at `currentStock: 0`, since the business stopped stocking it) would nag the dashboard's "Low
Stock Alerts" count forever, directly violating the PRD's success metric.

**Technical Notes**: Per TDD §7.4. `prisma.inventoryItem.findMany({ where: { isActive: true },
select: { currentStock: true, minimumThreshold: true } })`. **Sequencing note, not a logical
dependency**: land this after `FE-028` (the dashboard's design-overhaul restyle) to avoid a diff
collision in the same file — `FE-028` doesn't depend on this schema field, so it's free to land
first if `MIGRATE-001` hasn't cleared yet by the time Phase 5 starts.

**Definition of Done**:
- [ ] `src/app/admin/page.tsx` (MODIFY) — low-stock `prisma.inventoryItem.findMany` call gains `where: { isActive: true }`.
- [ ] Manual check: archiving an at-or-below-threshold item via `FE-031`'s UI removes it from the "Low Stock Alerts" count immediately (after a page refresh).

**Estimated Complexity**: Low — a one-line filter addition.

---

### FE-022 · `MenuClient.tsx` `RecipeBuilder` — archived-ingredient reinjection
**Status**: NEW (item 7) · **Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-005

**Description**: `BE-005`'s default active-only filter on `getInventoryItems()` silently breaks the
already-selected-row case in the recipe builder: if a dish's existing recipe references an item
that's since been archived, its `<select>` would show an unmatched value and its unit label would
go blank, since the (now-filtered) `inventory` prop no longer contains that row. This applies the
same pattern `OrderDetailsClient.tsx`'s existing `optionsForRow` helper already solves for archived
dishes, to ingredients.

**Technical Notes**: Per TDD §7.4. **Implementation detail the TDD leaves implicit (see Defects
Found #3)**: `RecipeBuilder` currently takes `{ rows, setRows, inventory, onAddRow }` with no `dish`
prop — add one (`dish: DishWithIngredients | null`, `null` for the create-dish form where there's no
existing recipe to fall back to) so `optionsForRow` can read `dish.ingredients` for the reinjection
fallback:
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
The edit-dish call site passes `editingDish`; the create-dish call site passes `null` (a brand-new
recipe can never reference an already-archived item, since the picker never offered it).

**⚠️ Merge-conflict risk**: same file as `FE-019`/`FE-032`.

**Definition of Done**:
- [ ] `MenuClient.tsx` (MODIFY) — `RecipeBuilder` gains a `dish: DishWithIngredients | null` prop.
- [ ] `optionsForRow(row, inventory, dish)` implemented and used in place of the current bare `inventory.map(...)` for the ingredient `<select>`'s options.
- [ ] Edit-dish call site passes `editingDish`; create-dish call site passes `null`.
- [ ] Manual check: a dish whose recipe references a since-archived ingredient still shows that ingredient's real name (suffixed "(archived)") and correct unit label when the dish is opened for editing.
- [ ] Manual check: the "Add Ingredient" picker for a *new* recipe row never offers an archived item.

**Estimated Complexity**: Medium — requires threading a new prop through an existing component and getting the fallback-lookup logic right; the pattern is proven elsewhere but not copy-paste-identical.

---

### FE-023 · `OrderDetailsClient.tsx` extra-ingredients editor — archived-ingredient reinjection
**Status**: NEW (item 7) · **Category**: Frontend · **Phase**: 3 · **Dependencies**: BE-005

**Description**: Same class of bug as `FE-022`, applied to the order detail page's "Extra
Ingredients" editor (confirmed at line 343: `{inventory.map(inv => ...)}` with no existing fallback
for an off-list `id`).

**Technical Notes**: Per TDD §7.4. Same `optionsForRow`-equivalent pattern, sourced from
`order.ingredientLogs[].inventoryItem` (already included in this page's own Prisma query) instead of
`dish.ingredients`. Note this file's dish-picker already has its own, unrelated `optionsForRow`
(confirmed at line 65, for archived *dishes*) — name the new ingredient-focused helper distinctly
(e.g. `ingredientOptionsForRow`) to avoid shadowing or confusing the two.

**⚠️ Merge-conflict risk**: same file as `FE-004`/`FE-007`/`FE-021`/`FE-030`.

**Definition of Done**:
- [ ] `OrderDetailsClient.tsx` (MODIFY) — a new `ingredientOptionsForRow`-style helper reinjects an archived ingredient into the extra-ingredients `<select>`'s options when an existing row already references it.
- [ ] Manual check: an order whose ingredient log references a since-archived item still shows that item's real name (suffixed "(archived)") and remains editable when the order is opened for editing.
- [ ] Manual check: the "Add Ingredient" picker for a *new* extra-ingredient row never offers an archived item.
- [ ] The existing dish-focused `optionsForRow` (line 65) is untouched and not renamed.

**Estimated Complexity**: Medium — same pattern as `FE-022`, applied to a second, independent call site.

---

### TEST-007 · Rewrite `fk-guarded-deletes.integration.test.ts` for the archive-instead-of-error behavior
**Status**: NEW (item 7) · **Category**: Testing · **Phase**: 3 · **Dependencies**: BE-005

**Description**: `fk-guarded-deletes.integration.test.ts:57-69` currently asserts
`deleteInventoryItem` on a referenced item resolves `{ ok: false, code: 'FK_CONSTRAINT' }` and that
the row still exists. Once referenced items archive instead of erroring, the first assertion
inverts entirely — this is expected, intentional breakage from `BE-005`, not a regression. Also adds
new coverage for the specific bug `BE-005` fixes: an item referenced only via `DishIngredient`
(never actually ordered), which the *old* pre-check let through undetected.

**Technical Notes**: Per TDD Testing Strategy (b). New expected assertion:
`expect(result).toMatchObject({ ok: true, data: { archived: true } })`; the "row still exists"
assertion happens to still pass, but now because it was archived, not because the delete was
rejected — update the test's own description/comment to say so, not just the assertion. **New test
case** (the corrected-bug case): create an item referenced only by a `DishIngredient` row (never an
`OrderIngredientLog`), call `deleteInventoryItem`, assert it archives rather than throwing a raw
`P2003`.

**Definition of Done**:
- [ ] `tests/integration/fk-guarded-deletes.integration.test.ts` (MODIFY) — the `deleteInventoryItem` referenced-item test updated to assert `{ ok: true, data: { archived: true } }`, with the item's `isActive` re-queried and asserted `false`.
- [ ] New test case added: an item referenced **only** by a `DishIngredient` (no `OrderIngredientLog` reference) archives correctly on delete, rather than hitting a raw `P2003`.
- [ ] `npm run test:integration` passes (requires `MIGRATE-001` complete against `rosty_integrity_test`).

**Estimated Complexity**: Medium — an inverted assertion plus a genuinely new test case covering the exact bug this pack fixes.

---

### TEST-008 · Review `inventory-actions.integration.test.ts` for the `getInventoryItems()` default-filter change + add `toggleInventoryItemActive` coverage
**Status**: NEW (item 7) · **Category**: Testing · **Phase**: 3 · **Dependencies**: BE-005

**Description**: `inventory-actions.integration.test.ts` imports and exercises `deleteInventoryItem`
and `getInventoryItems` — confirmed by direct read, its existing `deleteInventoryItem` test (line
113-118) only covers the zero-references case, which is unaffected by `BE-005`'s behavior change and
will keep passing as-is. This task is the explicit review the TDD calls for, plus net-new coverage
for `toggleInventoryItemActive`, which currently has zero test coverage anywhere.

**Technical Notes**: Per TDD Testing Strategy (c). Confirm the existing three-case auth-matrix
pattern (unauthenticated / CUSTOMER / ADMIN) is extended to `toggleInventoryItemActive`, matching
the same pattern already used for `createInventoryItem`/`updateInventoryItem`/`deleteInventoryItem`
in this file.

**Definition of Done**:
- [ ] `tests/integration/inventory-actions.integration.test.ts` (MODIFY) — existing `deleteInventoryItem`/`getInventoryItems` tests reviewed; confirmed no assertion needs to change (zero-reference case is unaffected by `BE-005`).
- [ ] New `describe('toggleInventoryItemActive')` block added with the same three-case auth-matrix pattern (rejects unauthenticated, rejects CUSTOMER, succeeds for ADMIN).
- [ ] New test: `toggleInventoryItemActive` on an already-archived item back to `isActive: true` succeeds unconditionally (no reference check on restore).
- [ ] `npm run test:integration` passes.

**Estimated Complexity**: Low — mostly a review pass, plus one new `describe` block following an already-established pattern.

---

## Phase 4: Admin Shell & Mobile Nav

### FE-024 · Restyle and extend `Sidebar.tsx`
**Status**: NEW (consolidates dropped `FE-012`/`FE-014`) · **Category**: Frontend · **Phase**: 4 · **Dependencies**: FE-017, FE-018

**Description**: One consolidated diff covering everything `Sidebar.tsx` needs across three items:
token-based restyle (12 confirmed inline `oklch(...)` sites), the `onNavigate` prop the mobile
drawer needs, an `aria-label` on the nav, the real logo swap, and the "ROSTY"→"ROSTTY" text fix.
Deliberately consolidated (not split across three tasks) per the TDD's own Rollout Plan
recommendation, since three separate tasks would otherwise generate competing diffs against the
same ~100-line file.

**Technical Notes**: Per TDD §5.2 + §1 + §4. Token replacements: `bg-sidebar`,
`text-sidebar-foreground`, `border-sidebar-border`; active nav item → `bg-sidebar-accent
text-sidebar-primary border-l-2 border-sidebar-primary`; inactive → `text-muted-foreground
hover:text-sidebar-foreground hover:bg-sidebar-accent/50` (the `hover:` variant is new — impossible
with the prior inline-style implementation). Nav group labels use `.eyebrow`. `onNavigate` prop:
`export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {})`, each `<Link>`'s
`onClick={() => onNavigate?.()}` — backward compatible, the existing desktop `<Sidebar />` call site
in `AdminLayout.tsx` needs zero changes since `onNavigate` defaults to `undefined`. `<nav
aria-label="Admin navigation">`. Logo: first `next/image` usage in this codebase (confirmed via
grep — the one other hit, in `src/proxy.ts`, is an unrelated routing-matcher comment) — `fill` + a
sized `relative` parent + `object-contain` (the JPEG is a `public/` asset, not a static import, so
Next can't infer intrinsic size): `<div className="relative flex h-8 w-8 items-center justify-center
rounded overflow-hidden bg-white p-1"><Image src="/rosty-logo.jpeg" alt="Chop with Rostty" fill
className="object-contain" /></div>` — the white "logo chip" background is because the source JPEG
has an opaque white background baked in, unrelated to the spelling fix. Line 50's `ROSTY` → `ROSTTY`.

**Definition of Done**:
- [ ] `src/components/layout/Sidebar.tsx` (MODIFY) — all 12 confirmed inline `oklch(...)` sites replaced with token classes; no new raw color value introduced.
- [ ] `Flame` icon and its amber box wrapper removed, replaced with the `next/image` white-chip logo treatment; footprint unchanged (`h-8 w-8`), no layout shift.
- [ ] Line 50 reads `ROSTTY`, not `ROSTY`.
- [ ] `onNavigate?: () => void` prop added; each `<Link>`'s `onClick` invokes it; the existing `<Sidebar />` call site in `AdminLayout.tsx` requires **zero** changes (re-verified after this edit).
- [ ] `<nav aria-label="Admin navigation">` added.
- [ ] Manual check: no stray white square edge bleeding into the dark sidebar background; active/inactive nav states show a working `hover:` state.

**Estimated Complexity**: Medium — five distinct concerns in one file; the `next/image` `fill`+`relative` pattern and the token-mapping are the real risk, not the mechanical parts.

---

### FE-025 · Create `MobileNavTrigger.tsx` drawer component
**Status**: REVISED (VERIFY-001's now-unnecessary fallback branch removed) · **Category**: Frontend · **Phase**: 4 · **Dependencies**: FE-017, FE-018, FE-024

**Description**: The new client component owning the mobile nav drawer's open/closed state, rendering
the hamburger trigger and a `Dialog`-based drawer containing the same `Sidebar` content as desktop.

**Technical Notes**: Per TDD §1. Build on `dialog.tsx` (Base UI `Dialog.Root`, `modal: true` by
default gives focus trap, scroll lock, Escape-to-close, and focus-return for free) — confirmed no
`sheet.tsx` exists. **Simplified from the prior plan**: `DialogClose` is confirmed working (per the
orchestrator's spike), so this uses the **default `DialogContent` close button with no
`showCloseButton={false}` workaround and no explicit fallback `onClick` close button** — do not
build the fallback branch the prior version of this task hedged on. `DialogContent` positioned as a
left-edge drawer: `top-0 left-0 h-full w-[280px] max-w-[85vw] rounded-none gap-0 p-0
data-open:slide-in-from-left data-closed:slide-out-to-left` (`tw-animate-css`, already a dependency,
supports these). New `.mobile-nav-drawer` utility class (add to `globals.css` as part of this task,
not `FE-017`/`FE-018` — it's specific to this component): `overscroll-behavior: contain;
padding-top/bottom/left: env(safe-area-inset-*)`. Hamburger: `aria-label="Open navigation menu"`,
`aria-expanded={open}`, `aria-controls="mobile-admin-nav"`. `DialogTitle className="sr-only"` for an
accessible name. `<Sidebar onNavigate={() => setOpen(false)} />` inside `DialogContent`. `w-[280px]
max-w-[85vw]` is ~280px (~75% of screen) at 375px viewport, leaving a tappable dismiss-by-overlay
area.

**Definition of Done**:
- [ ] `src/components/layout/MobileNavTrigger.tsx` created as a `"use client"` component.
- [ ] `md:hidden` wrapper; hamburger `Button` with `variant="ghost" size="icon-sm"` and the three `aria-*` attributes above.
- [ ] `DialogContent` positions the drawer at the left edge with slide animation, `w-[280px] max-w-[85vw]`, using the **default** close button (no fallback branch built).
- [ ] `.mobile-nav-drawer` utility class added to `globals.css` with `overscroll-behavior: contain` and safe-area insets.
- [ ] `<Sidebar onNavigate={() => setOpen(false)} />` rendered inside `DialogContent`.
- [ ] `DialogTitle className="sr-only"` present.
- [ ] Manual check at 375px viewport: hamburger visible, opens drawer in one tap, tapping a nav link both navigates and closes the drawer, the built-in X button closes it.

**Estimated Complexity**: Medium — new component with several interacting concerns (animation, a11y), but simpler than previously planned since the close-button fallback is no longer needed.

---

### FE-026 · Restyle and extend `Header.tsx`
**Status**: NEW (consolidates dropped `FE-013`/`FE-016`) · **Category**: Frontend · **Phase**: 4 · **Dependencies**: FE-017, FE-018, FE-025

**Description**: One consolidated diff: token-based restyle (9 confirmed inline `oklch(...)` sites),
mounting `<MobileNavTrigger />`, a small logo mark (the header is the *only* persistently-visible
brand chrome on mobile once the sidebar is hidden below `md`), and swapping the raw sign-out
`<button>` for `<Button variant="ghost" size="sm">`.

**Technical Notes**: Per TDD §5.2. `Header.tsx` stays an `async` Server Component — no `"use
client"` added; a Server Component can render a Client Component child (`MobileNavTrigger`) without
itself crossing the boundary. Consolidate the header's near-imperceptibly-different background
(`oklch(0.09...)` vs. `--card`'s `oklch(0.11...)`) onto `bg-card`/`border-border` directly — flagged
as an Open Question below in case a reviewer considers the 2-lightness-point difference intentional.
Logo mark: same white-chip `next/image` pattern as `FE-024`, smaller (`h-6 w-6`).
`<MobileNavTrigger />` added to the existing left-side JSX, before the "Admin Portal" label. Sign-out
`<button>` (currently raw-styled) becomes `<Button variant="ghost" size="sm">` — picks up a real
focus ring and hover state for free.

**⚠️ Merge-conflict risk**: depends on `FE-025` (`MobileNavTrigger.tsx` must exist first).
`AdminLayout.tsx` is **deliberately not modified** by this task — confirm it stays untouched.

**Definition of Done**:
- [ ] `src/components/layout/Header.tsx` (MODIFY) — all 9 confirmed inline `oklch(...)` sites replaced with token classes (header background consolidated onto `bg-card`/`border-border`).
- [ ] `<MobileNavTrigger />` imported and rendered in the left-side flex container, before "Admin Portal."
- [ ] Small `h-6 w-6` white-chip logo mark added, same `next/image` pattern as `FE-024`.
- [ ] Sign-out `<button>` replaced with `<Button variant="ghost" size="sm">`, form action unchanged.
- [ ] `Header.tsx` remains `async` with no `"use client"` directive added.
- [ ] `AdminLayout.tsx` confirmed **unmodified** (re-read after this task).
- [ ] Manual check at ≥768px: hamburger not visible (`md:hidden` confirmed); pixel-identical desktop layout to before this pack. Manual check at <768px: hamburger and logo mark both visible.

**Estimated Complexity**: Medium — four concerns in one small file; the Server/Client boundary discipline (no accidental `"use client"`) is the main risk.

---

### FE-027 · Add `id="main-content"` to `AdminLayout.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 4 · **Dependencies**: FE-018

**Description**: The skip link added in `FE-010` needs a target. This is `AdminLayout.tsx`'s only
change in this entire pack — its grid/breakpoint structure is untouched.

**Technical Notes**: Per TDD §0.7/§5.2. `id="main-content"` added to the existing `<main>` element
only.

**Definition of Done**:
- [ ] `src/components/layout/AdminLayout.tsx` (MODIFY) — `id="main-content"` added to the `<main>` element.
- [ ] No other change to this file — grid classes, `<Sidebar />`/`<Header />` composition all unchanged.
- [ ] Manual check: activating the skip link (from `FE-010`) via keyboard moves focus to this `<main>`.

**Estimated Complexity**: Low — a one-attribute change.

---

### FE-010 · Add icons/manifest metadata + `viewport` export + skip link to `layout.tsx`
**Status**: REVISED (skip link + Rostty text fix added) · **Category**: Frontend · **Phase**: 4 · **Dependencies**: FE-018

**Description**: Wires the browser tab favicon, PWA manifest link, and theme color into the root
layout — plus (new in this revision) the accessibility skip link and the "Rosty"→"Rostty" text fix
in `title`/`description`.

**Technical Notes**: Per TDD §4 and the framework constraint confirmed by reading
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` directly:
**`themeColor`/`colorScheme` must be a separate `export const viewport: Viewport`, NOT nested inside
`metadata`** — deprecated as of Next.js 14, silently no-ops in this version rather than warning.
`metadata.manifest = "/site.webmanifest"`; `metadata.icons` lists the four already-committed
`public/` assets (confirmed present). `themeColor: "#0d0b0a"` approximates `--background`; verify
against DevTools computed style before shipping. `title`/`description` updated to "Chop with
Rostty." New (§0.7): skip link as the first child of `<body>`, `href="#main-content"`,
`sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded
focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground`.

**Definition of Done**:
- [ ] `src/app/layout.tsx` (MODIFY) — `Viewport` type imported; `export const viewport: Viewport = { themeColor: "#0d0b0a", colorScheme: "dark" }` added as a **sibling** export to `metadata`, not nested inside it.
- [ ] `metadata.manifest` set to `"/site.webmanifest"`; `metadata.icons` populated with the four icon entries.
- [ ] `metadata.title`/`metadata.description` updated to "Chop with Rostty" (double-t).
- [ ] Skip-link `<a href="#main-content">Skip to content</a>` added as the first child of `<body>`, using the `sr-only focus:not-sr-only` treatment above.
- [ ] `npm run build` produces no deprecation warning about `themeColor`/`colorScheme` inside `metadata`.
- [ ] Manual check: Tab from page load lands on the skip link first, visibly revealing it; activating it (once `FE-027` lands) moves focus to `#main-content`.

**Estimated Complexity**: Low — mostly declarative object literals plus one new JSX element; the deprecated-placement trap is explicitly called out.

---

### FE-011 · Fix `public/site.webmanifest` content
**Status**: REVISED (spelling corrected to "Rostty") · **Category**: Frontend · **Phase**: 4 · **Dependencies**: None

**Description**: The manifest currently has empty `name`/`short_name`, no `start_url`, and a white
`theme_color`/`background_color` on a permanently-dark app.

**Technical Notes**: Per TDD §4, replace the full file content: `name: "Chop with Rostty"` (this
revision corrects the double-t from the prior plan's "Chop with Rosty"), `short_name: "Rostty"`,
`description: "Kitchen order & inventory command center for Chop with Rostty"`, `start_url: "/"`
(the existing auth-redirect hub in `page.tsx` already routes correctly by role),
`display: "standalone"`, `background_color`/`theme_color` both `"#0d0b0a"`.

**Definition of Done**:
- [ ] `public/site.webmanifest` (MODIFY) — full content replaced; `name` is `"Chop with Rostty"`, `short_name` is `"Rostty"` (double-t, both corrected from the prior plan).
- [ ] `start_url` is `"/"`, `scope` is `"/"`, `display` is `"standalone"`.
- [ ] `background_color` and `theme_color` both `"#0d0b0a"`.
- [ ] Chrome DevTools → Application → Manifest panel shows no errors/warnings.

**Estimated Complexity**: Low — a full-file JSON replacement, fully specified in the TDD.

---

## Phase 5: Per-Screen Design Overhaul

### FE-028 · Restyle `admin/page.tsx` dashboard
**Status**: NEW · **Category**: Frontend · **Phase**: 5 · **Dependencies**: FE-008, FE-017, BE-004

**Description**: Token-based restyle of the dashboard's page header, "LIVE DATA" pill, all six stat
cards (the original four plus `FE-008`'s two new ones), the order-pipeline cards, and the
recent-orders table — plus adopting the shared `ORDER_STATUS_CONFIG` in place of the local
`statusConfig` object, and an icon+message empty state for "No orders yet."

**Technical Notes**: Per TDD §5.3. `.page-title`/`.meta-text` for the header; `.eyebrow`/`.stat-value`
for stat cards (the two `FE-008` added already use these — this task converts the original four to
match); icon chip backgrounds become `bg-primary/10`/`text-primary` (alert: `bg-destructive/12`/
`text-destructive`) instead of inline conditional `style` objects. Recent-orders table's status
badges import from `BE-004`'s `orderStatus.ts` instead of the local `statusConfig`. Date header
switches from hardcoded `'en-US'` to `BUSINESS_LOCALE` (imported from `src/lib/currency.ts`) for
consistency — a one-word locale-string change, no new formatting mechanism. Empty state per TDD
§5.9: icon + message, replacing the bare "No orders yet." gray-text row.

**⚠️ Merge-conflict risk**: `BE-007` (low-stock `isActive` filter) also touches this file — land
this restyle first if `MIGRATE-001` hasn't cleared yet; `BE-007`'s one-line filter rides on top
afterward with minimal collision risk.

**Definition of Done**:
- [ ] `src/app/admin/page.tsx` (MODIFY) — all inline `oklch(...)` sites (confirmed 31) replaced with token classes.
- [ ] All six stat cards use `.eyebrow`/`.stat-value`; icon chips use token-based alert/non-alert backgrounds.
- [ ] Recent-orders table imports `ORDER_STATUS_CONFIG` from `@/lib/orderStatus`; local `statusConfig` object deleted.
- [ ] Date header uses `BUSINESS_LOCALE` from `@/lib/currency`, not a hardcoded `'en-US'`.
- [ ] Empty state upgraded to icon + message + hint, per `FE-017`'s established pattern.
- [ ] `grep -n "oklch(" src/app/admin/page.tsx` returns zero hits.

**Estimated Complexity**: Medium — largest single-file token conversion in this phase (31 sites), but entirely mechanical value-preserving substitutions.

---

### FE-029 · Restyle `OrderClient.tsx` table chrome + fix `DialogTrigger` + empty state
**Status**: NEW · **Category**: Frontend · **Phase**: 5 · **Dependencies**: FE-002, FE-003, FE-006, FE-009, FE-020, FE-017

**Description**: Token-based restyle of the table header row and zebra striping (`.table-head-cell`,
`.table-row`), the status and dish `<select>`s adopting `.select-field`, the confirmed-broken
"Create Order" `DialogTrigger` fixed to the direct-`onClick` pattern already used correctly
elsewhere, and an icon+message empty state.

**Technical Notes**: Per TDD §5.4. `DialogTrigger` fix (confirmed present at line 169-171):
```tsx
// Before: <DialogTrigger render={<Button />}>Create Order</DialogTrigger>
<Button onClick={() => setIsOpen(true)}>Create Order</Button>
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>{/* DialogTrigger import removed */}</DialogContent>
</Dialog>
```
This is a strict reliability improvement (AGENTS.md documents this exact composition as broken in a
real browser), not a new code path. **Must be spot-checked against `OrderClient.test.tsx` during
implementation** — that file's docstring is specifically about this composition pattern (confirmed
at line 7); RTL locates the button by role/accessible name either way, so the test's *outcome*
shouldn't change, but its docstring's claim about `DialogTrigger` becomes stale once fixed and
should be updated as a one-line comment change, not a test-logic change.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — table header/zebra striping converted to `.table-head-cell`/`.table-row`; all inline `oklch(...)` table-chrome sites removed.
- [ ] Status `<select>` and dish-picker `<select>` both adopt `.select-field`.
- [ ] `DialogTrigger` "Create Order" pattern replaced with direct `onClick`; `DialogTrigger` import removed.
- [ ] Empty state ("No orders found.") upgraded to icon + message.
- [ ] `OrderClient.test.tsx` still passes; its docstring about the `DialogTrigger` pattern updated to reflect the fix.
- [ ] Manual check: "Create Order" button reliably opens the dialog in a real browser (not just jsdom).

**Estimated Complexity**: Medium — the token conversion is mechanical, but the `DialogTrigger` fix is a genuine behavior change riding along and needs the test spot-check called out above.

---

### FE-030 · Restyle `OrderDetailsClient.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 5 · **Dependencies**: FE-004, FE-007, FE-021, FE-017

**Description**: Token-based restyle, including replacing the confirmed stray `bg-slate-100
dark:bg-slate-800` status-select classes and `text-slate-500` labels — the only place in the app
using raw Tailwind gray-scale instead of either oklch literals or theme tokens, a third,
unrelated color system found during the audit.

**Technical Notes**: Per TDD §5.4. Status `<select>` and both dish/ingredient `<select>`s adopt
`.select-field`; `text-slate-500` labels become `text-muted-foreground`.

**Definition of Done**:
- [ ] `OrderDetailsClient.tsx` (MODIFY) — `bg-slate-100 dark:bg-slate-800` status-select classes replaced with `.select-field`.
- [ ] `text-slate-500` labels replaced with `text-muted-foreground` throughout.
- [ ] Dish-picker and extra-ingredients `<select>`s both adopt `.select-field`.
- [ ] `grep -n "slate-" src/app/admin/orders/\[id\]/OrderDetailsClient.tsx` returns zero hits.
- [ ] Manual check: status select and both pickers render with visible, legible backgrounds and text.

**Estimated Complexity**: Low — mechanical class replacement in an already-small, already-touched file.

---

### FE-031 · Restyle `InventoryClient.tsx` + archive/restore UI
**Status**: NEW (combines design-overhaul restyle §5.5 with item 7's archive UI §7.3, per the TDD's own file-list grouping) · **Category**: Frontend · **Phase**: 5 · **Dependencies**: BE-005, BE-006, FE-017

**Description**: Two concerns landing together because the TDD itself groups them (both touch this
file in the same pass): token-based restyle (category badges, `StockBadge`'s fill color, the broken
"Add Item" `DialogTrigger`) **and** the new `showArchived` toggle, per-row Archive/Restore action,
and corrected delete-result handling required by `BE-005`'s changed return type.

**Technical Notes**: Per TDD §5.5 + §7.3. `StockBadge`'s progress-bar fill switches from an inline
conditional-`oklch` object to a static class map (`stock-critical`/`stock-warning`/`stock-ok` →
`bg-destructive`/`bg-primary`/`bg-chart-3`). `categoryColors` string-concatenation map replaced with
the static `categoryBadgeClass` Tailwind-class map (reuses `--chart-1`..`--chart-5` tokens, same
color *intent* as today). `DialogTrigger` fix, same pattern as `FE-029`. Archive UI:
```tsx
const [showArchived, setShowArchived] = useState(false)
const visibleData = data.filter(i => showArchived || i.isActive)
```
`handleDelete` updated for the new `ActionResult<{ archived: boolean }>` shape — branches on
`result.data.archived` to either optimistically flip `isActive: false` (with an `alert()` explaining
why) or remove the row entirely, matching `MenuClient`'s equivalent handler shape.
`handleToggleActive` calls the new `toggleInventoryItemActive`. **Deliberate divergence from
`MenuClient`**: archived items are **hidden by default** here (reveal toggle), not shown inline
dimmed — this is Decision 3's specific instruction for this screen, not an inconsistency to "fix."
**Deliberate non-adoption of `toast`**: uses `alert()`, matching this file's own existing
convention, not `MenuClient`'s `toast` — consistent with the still-deferred `alert()`/`confirm()`→
`toast` migration question (see Open Questions).

**Definition of Done**:
- [ ] `InventoryClient.tsx` (MODIFY) — all confirmed inline `oklch(...)` sites (21) replaced with token classes; `categoryColors` map replaced with static `categoryBadgeClass`.
- [ ] `StockBadge`'s fill color uses the static `stock-critical`/`stock-warning`/`stock-ok` → token-class map.
- [ ] `DialogTrigger` "Add Item" pattern replaced with direct `onClick`.
- [ ] `showArchived` toggle added (`useState`-only, client-side filter over `data`); "Show Archived (N)" / "Hide Archived" button.
- [ ] `handleDelete` updated for `ActionResult<{ archived: boolean }>` — archives optimistically with an explanatory `alert()`, or removes the row, based on `result.data.archived`.
- [ ] `handleToggleActive` added, calling `toggleInventoryItemActive`.
- [ ] Manual check: deleting an item referenced by a recipe or order archives it with the explanatory message; "Show Archived" reveals it with the correct count; "Restore" returns it to the default view.

**Estimated Complexity**: High — the most concern-dense task in this pack (restyle + new state + a changed action's call-site handling + a divergent-from-precedent UX decision), all in one file.

---

### FE-032 · Restyle `MenuClient.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 5 · **Dependencies**: FE-019, FE-022, FE-001, FE-017

**Description**: Token-based restyle of table chrome, dish-status badges, and the recipe builder's
ingredient `<select>`.

**Technical Notes**: Per TDD §5.6. Price column gets `.table-cell-num` (currency already applied by
`FE-019`). `statusColors` string-concatenation map (ACTIVE/ARCHIVED) replaced by `FE-001`'s new
`.dish-active`/`.dish-archived` classes. `RecipeBuilder`'s ingredient `<select>` adopts
`.select-field`. This file already uses the correct direct-`onClick` "Add Dish" trigger (confirmed
at line 324-325, with its own inline comment referencing `AGENTS.md`) — **no `DialogTrigger` fix
needed here**, unlike `FE-029`/`FE-031`/`FE-033`.

**Definition of Done**:
- [ ] `MenuClient.tsx` (MODIFY) — all confirmed inline `oklch(...)` sites (17) replaced with token classes.
- [ ] `statusColors` map deleted, replaced by `.dish-active`/`.dish-archived` classes on the STATUS column.
- [ ] `RecipeBuilder`'s ingredient `<select>` adopts `.select-field`.
- [ ] Confirmed no `DialogTrigger`-pattern change needed in this file (already correct).
- [ ] Manual check: ACTIVE/ARCHIVED badges render with the new token-based classes, visually distinct.

**Estimated Complexity**: Medium — straightforward token conversion; the only nuance is confirming (not assuming) this file's dialog trigger is already correct.

---

### FE-033 · Restyle `CustomerClient.tsx` + fix `DialogTrigger`
**Status**: NEW · **Category**: Frontend · **Phase**: 5 · **Dependencies**: FE-017

**Description**: Token-based restyle of table chrome (no currency/due-date surface on this screen)
plus the confirmed-broken "Add Customer" `DialogTrigger` fix.

**Technical Notes**: Per TDD §5.7. Same `DialogTrigger` fix pattern as `FE-029`/`FE-031` (confirmed
present at line 164-166).

**Definition of Done**:
- [ ] `CustomerClient.tsx` (MODIFY) — all confirmed inline `oklch(...)` sites (14) replaced with token classes.
- [ ] `DialogTrigger` "Add Customer" pattern replaced with direct `onClick`.
- [ ] Manual check: "Add Customer" button reliably opens the dialog in a real browser.

**Estimated Complexity**: Low — table chrome only, no currency/due-date/archive logic in this file.

---

## Phase 6: Customer-Facing Pages & Loading/Empty States

### FE-034 · Restyle `dashboard/page.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 6 · **Dependencies**: FE-005, BE-004, FE-017

**Description**: Deletes the local `statusColors`/`statusEmojis` light-pastel maps (confirmed at
lines 5-21, `bg-yellow-100 text-yellow-800` etc. — the only place in the app still using light-mode
pastels, visually clashing with the otherwise-universal dark theme) and replaces them with `BE-004`'s
shared `ORDER_STATUS_CONFIG`, so the customer's own order-status badge becomes the *same*
dark-theme-correct badge the admin sees. Also upgrades the empty state.

**Technical Notes**: Per TDD §5.8. `<span className={ORDER_STATUS_CONFIG[order.status].className}>`
replaces the current `statusColors`/`statusEmojis` lookup. Empty state (currently a bare "No orders
yet." message, confirmed at lines 70-76) gets the same icon+message treatment as `FE-028`.

**Definition of Done**:
- [ ] `src/app/dashboard/page.tsx` (MODIFY) — `statusColors`/`statusEmojis` local maps deleted.
- [ ] Status badge imports and uses `ORDER_STATUS_CONFIG` from `@/lib/orderStatus`.
- [ ] Empty state upgraded to icon + message + hint.
- [ ] Manual check: a customer's order-status badge visually matches the admin's badge for the same status (same color, same icon).

**Estimated Complexity**: Low — a lookup-table swap plus one empty-state upgrade.

---

### FE-035 · Restyle `dashboard/layout.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 6 · **Dependencies**: FE-018

**Description**: The smallest diff of any file in this phase — this file is already mostly
token-based (`bg-muted/40`, `text-muted-foreground`, confirmed). Adds the skip-link target and swaps
the sign-out button, plus one Rostty text fix.

**Technical Notes**: Per TDD §5.8. `id="main-content"` on this layout's `<main>` (its own, separate
skip-link target from `AdminLayout.tsx`'s — this is the customer-portal shell, a distinct app
shell). Sign-out `<button>` becomes `<Button variant="ghost" size="sm">`, same reasoning as
`FE-026`. Line 18: `🍽️ Chop with Rosty` → `🍽️ Chop with Rostty`.

**Definition of Done**:
- [ ] `src/app/dashboard/layout.tsx` (MODIFY) — `id="main-content"` added to its `<main>` element.
- [ ] Sign-out `<button>` replaced with `<Button variant="ghost" size="sm">`.
- [ ] Line 18 reads `Chop with Rostty`, not `Chop with Rosty`.
- [ ] Manual check: skip link (once wired) moves focus into this shell's main content on the `/dashboard` route.

**Estimated Complexity**: Low — smallest file touched in this phase.

---

### FE-036 · Restyle `login/page.tsx` + create `LoginSubmitButton.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 6 · **Dependencies**: FE-017, FE-018

**Description**: Token-based restyle (21 confirmed inline `oklch(...)` sites) plus a
behavior-neutral, UI-only upgrade: the raw `<input>`/`<button>` become the app's existing `Input`
component and a new pending-state submit button, and the status/error message region gets
`aria-live="polite"`. One Rostty text fix.

**Technical Notes**: Per TDD §5.8. New `src/components/layout/LoginSubmitButton.tsx` — first use of
`useFormStatus` in this codebase, which must be called from a component that's a **child** of the
`<form>`, hence a new separate Client Component rather than an inline change in the (Server
Component) `login/page.tsx`:
```tsx
"use client"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
export function LoginSubmitButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending} className="w-full">{pending ? "Sending…" : "Send Magic Link"}</Button>
}
```
`login/page.tsx` itself **stays a Server Component** — only the button crosses the client boundary;
`formAction={login}`, the server action, and the redirect-on-success behavior are all unchanged. The
message region (`resolvedSearchParams?.message`) gets `role="status" aria-live="polite"`. The
existing `you@example.com` placeholder is left as-is (the "placeholders end with `…`" guideline
governs in-progress/loading text, not example values). Line 42: `Chop with Rosty` → `Chop with
Rostty`.

**Definition of Done**:
- [ ] `src/components/layout/LoginSubmitButton.tsx` created — `"use client"`, uses `useFormStatus`, shows "Sending…" while pending.
- [ ] `src/app/login/page.tsx` (MODIFY) — all 21 confirmed inline `oklch(...)` sites replaced with token classes; raw `<input>`/`<button>` replaced with `Input`/`LoginSubmitButton`; stays a Server Component (no `"use client"` added to the page itself).
- [ ] Status/error message region gets `role="status" aria-live="polite"`.
- [ ] Line 42 reads `Chop with Rostty`.
- [ ] Manual check: submitting the login form shows "Sending…" and a disabled button for the round trip; a screen reader announces the resulting status message.

**Estimated Complexity**: Medium — the `useFormStatus` boundary discipline (page stays Server, only the button is Client) is the one real risk in an otherwise mechanical restyle.

---

### FE-037 · Restyle `page.tsx` landing page
**Status**: NEW · **Category**: Frontend · **Phase**: 6 · **Dependencies**: FE-017, FE-018

**Description**: Token-based restyle (23 confirmed inline `oklch(...)` sites) with **no content or
logic change** — same redirect-hub behavior, same copy, same links. Two Rostty text fixes plus one
a11y cleanup for purely decorative elements.

**Technical Notes**: Per TDD §5.8. Hero wordmark and stat row use `.page-title`/`.eyebrow`. Purely
decorative divider lines (`h-px w-10`) and bullet dots (`h-2 w-2 rounded-full`) get
`aria-hidden="true"` — they currently expose empty, meaningless nodes to the accessibility tree.
Line 98: `ROSTY` → `ROSTTY`. Line 214: `© 2025 CHOP WITH ROSTY` → `© 2025 CHOP WITH ROSTTY`.

**Definition of Done**:
- [ ] `src/app/page.tsx` (MODIFY) — all 23 confirmed inline `oklch(...)` sites replaced with token classes.
- [ ] Line 98 reads `ROSTTY`; line 214 reads `© 2025 CHOP WITH ROSTTY — ALL RIGHTS RESERVED`.
- [ ] Decorative divider lines and bullet dots gain `aria-hidden="true"`.
- [ ] No copy, link, or redirect-hub logic changed — confirmed by diffing behavior, not just appearance.
- [ ] Manual check: page still correctly redirects to `/admin` or `/dashboard` per role, byte-identical logic to before this task.

**Estimated Complexity**: Medium — largest single-file token count (23) in this pack outside `admin/page.tsx`, but zero logic risk since it's explicitly restyle-only.

---

### FE-038 · Correct "Rosty" → "Rostty" in `src/lib/notifications/email.ts`
**Status**: NEW · **Category**: Backend · **Phase**: 6 · **Dependencies**: None

**Description**: Two confirmed occurrences of the old spelling in the transactional-email template
— the `FROM_EMAIL` default and the email `<h1>` — independent of every other file in this pack, so
it's its own small, isolated task.

**Technical Notes**: Per TDD §4. Line 11: `const FROM_EMAIL = process.env.FROM_EMAIL || 'Chop with
Rosty <onboarding@resend.dev>'` → `'Chop with Rostty <onboarding@resend.dev>'`. Line 49: `<h1
...>🍽️ Chop with Rosty</h1>` → `🍽️ Chop with Rostty`. Note this is **distinct** from
`INFRA-002`'s explicit instruction to leave `.env.example`'s `FROM_EMAIL` example untouched — that's
a template comment already fixed on `main`; this is the actual runtime default and email template,
which is genuinely still wrong in this file and must be fixed here.

**Definition of Done**:
- [ ] `src/lib/notifications/email.ts` (MODIFY) — `FROM_EMAIL` default and the email `<h1>` both corrected to "Rostty."
- [ ] No other content in this file changed.
- [ ] Manual check: trigger a status-change email locally (or inspect the `console.log` fallback without `RESEND_API_KEY` set) and confirm the corrected spelling appears.

**Estimated Complexity**: Low — two string literal corrections.

---

### FE-039 · Create `src/components/ui/skeleton.tsx`
**Status**: NEW · **Category**: Frontend · **Phase**: 6 · **Dependencies**: None

**Description**: A new shared loading-state primitive, matching the existing shadcn-style primitive
convention already in `src/components/ui/`. Purely additive — no existing component changed.

**Technical Notes**: Per TDD §5.10:
```tsx
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)} {...props} />
}
export { Skeleton }
```
`motion-safe:` (not a bare `animate-pulse`) is deliberate belt-and-suspenders with `FE-018`'s global
`prefers-reduced-motion` override — the global rule alone already neutralizes the animation
duration, but scoping the class at the call site communicates intent too. Renders no dynamic data
(no dates, no counts) — server-renderable with byte-identical output on the client, so it introduces
no hydration-mismatch risk.

**Definition of Done**:
- [ ] `src/components/ui/skeleton.tsx` created, exporting `Skeleton`.
- [ ] Uses `motion-safe:animate-pulse`, not a bare `animate-pulse`.
- [ ] TypeScript compiles cleanly; follows the same file/export shape as existing `src/components/ui/*` primitives.

**Estimated Complexity**: Low — a five-line component, fully specified in the TDD.

---

### FE-040 · Add `loading.tsx` files for admin routes + dashboard
**Status**: NEW · **Category**: Frontend · **Phase**: 6 · **Dependencies**: FE-039

**Description**: Next.js's `loading.tsx` file convention automatically wraps a route segment in a
`<Suspense>` boundary — purely additive (new static files), requires no change to any existing
`page.tsx`, cannot break existing data-fetching behavior. Replaces the current blank-flash-during-
navigation behavior with a layout-matching skeleton.

**Technical Notes**: Per TDD §5.10. Six new files: `src/app/admin/loading.tsx`,
`.../orders/loading.tsx`, `.../inventory/loading.tsx`, `.../menu/loading.tsx`,
`.../customers/loading.tsx`, `src/app/dashboard/loading.tsx`. Each composes `<Skeleton>` rectangles
roughly matching that route's real layout (a row of `.stat-card`-shaped skeletons for `/admin`, a
table-shaped skeleton for `/admin/orders`, etc.) — intentionally simple, **not** pixel-accurate
content-aware skeletons (see Open Questions — this bar is confirmed acceptable per the TDD's own
framing, not re-litigated here).

**Definition of Done**:
- [ ] Six `loading.tsx` files created at the paths listed above, each composed of `<Skeleton>` elements roughly matching that route's layout shape.
- [ ] No existing `page.tsx` in any of these six routes modified.
- [ ] Manual check (Chrome DevTools "Slow 3G" throttling): navigating to each of the six routes shows a skeleton, not a blank flash, before real content streams in.

**Estimated Complexity**: Low — six small, structurally similar, fully independent files.

---

## Phase 7: Testing & Polish

### TEST-004 · Manual QA checklist verification pass
**Status**: REVISED (checklist significantly expanded — now 5 sub-checklists covering all 7 items, not 2) · **Category**: Testing · **Phase**: 7 · **Dependencies**: All tasks in Phases 1-6

**Description**: This pack deliberately defers automated component/interaction tests for visual/
interaction-heavy changes (justified in the TDD's Testing Strategy) in favor of a structured manual
checklist, traceable to the specific PRD success metric or web-interface-guideline rule each item
satisfies. This is that checklist, run once as the pack's final acceptance gate before merge.

**Technical Notes**: Per TDD Testing Strategy's manual QA checklist, verbatim, now covering all
seven items (the prior plan's checklist only covered items 1-4).

**Definition of Done** — all boxes checked, failures filed as follow-up issues before merge:

*Mobile nav (item 1):*
- [ ] At 375px viewport: hamburger visible, tappable, opens drawer within one tap; covers ≤85% of viewport width.
- [ ] Tapping a nav link both navigates **and** closes the drawer; tapping the overlay closes it; `Escape` closes it; the built-in X button closes it.
- [ ] Tab from page load reaches the hamburger; opening moves focus inside the drawer; closing returns focus to the hamburger.
- [ ] Body does not scroll behind the open drawer; the drawer's own overflow does not rubber-band into the page behind it.
- [ ] Above `md` (≥768px): behavior is pixel-identical to before this pack.
- [ ] Rapid double-tap of the hamburger, and tapping a nav link mid-slide-in-animation, do not crash or produce a console warning.

*Currency, due-date, brand (items 2-4):*
- [ ] Every price on every one of the 12 confirmed sites shows `₦`, not `$` (cross-checked against `TEST-003`).
- [ ] Numeric columns render with fixed-width digits — no jitter as values change.
- [ ] Favicon renders correctly in a browser tab; "Add to Home Screen" produces the correct name ("Rostty"), icon, and no white flash before the dark theme paints.
- [ ] Logo renders cleanly (no stray white edge) in the sidebar and mobile header.
- [ ] Due-today/overdue stat cards and the orders table's "Due" column/row-tint agree with each other and with manual expectation for at least one order in each urgency state.
- [ ] Zero occurrences of "Rosty"/"ROSTY" remain in application source text (case-insensitive grep across `src/`, excluding the deliberately-untouched `.env.example:38`).

*Design system / accessibility (item 5):*
- [ ] `grep -rn "oklch(" src/` (excluding `globals.css` itself) returns zero hits across `src/components/layout/`, `src/app/admin/**`, `src/app/dashboard/page.tsx`, `src/app/login/page.tsx`, `src/app/page.tsx`.
- [ ] Every icon-only button (hamburger, dialog close buttons) has a non-empty `aria-label`.
- [ ] Every interactive element shows a visible focus ring on keyboard `Tab` — spot-check nav links, status selects, buttons, the skip link.
- [ ] Skip link is the first focusable element on page load and jumps to `#main-content` on both the admin and customer-portal shells.
- [ ] Every native `<select>` renders with a visible, non-transparent background and legible text — spot-check on Windows/Chrome or Windows/Edge if available.
- [ ] `prefers-reduced-motion: reduce` collapses the drawer animation and skeleton pulse to near-instant.
- [ ] Empty tables render the icon+message empty state, not a blank/broken layout.
- [ ] Each of the six `loading.tsx` routes shows a skeleton (not a blank flash) on a throttled connection.
- [ ] Login page: submit button shows "Sending…" and is disabled for the round trip; the status/error message is announced (verify via a screen reader or the accessibility tree inspector).
- [ ] Customer dashboard's order-status badges visually match the admin's status badges.

*Order cancellation (item 6):*
- [ ] Selecting "Cancelled" in the orders table's status select prompts a native confirm naming the order; declining leaves the status visibly unchanged.
- [ ] Selecting "Cancelled" in the order detail page's status select prompts the same confirm; confirming transitions the order and restores stock exactly as it already does today.
- [ ] Once `CANCELLED`, the select is disabled in both places; confirm the new guard hasn't accidentally made a *non*-cancel status change also prompt a confirm.

*Inventory archive/retire (item 7):*
- [ ] Deleting an item with zero references still hard-deletes it (no change from today).
- [ ] Deleting an item referenced only by a `DishIngredient` (never actually ordered) archives it with a specific message, not a generic/raw error — the corrected-bug case.
- [ ] Deleting an item referenced by a past order's `OrderIngredientLog` archives it, same as today's already-checked case.
- [ ] Archived items are hidden from the inventory list by default; "Show Archived" reveals them with the correct count.
- [ ] An archived item does not appear as a selectable option in Menu's recipe builder or the order detail page's "Extra Ingredients" editor for a *new* row — but an existing row that already references it still renders correctly and remains editable.
- [ ] An archived item does not contribute to the dashboard's "Low Stock Alerts" count, even at or below its threshold.
- [ ] "Restore" on an archived item returns it to every picker and the default list view immediately.
- [ ] The inventory page's header count reflects only active items, not the total including archived ones.

**Estimated Complexity**: High — not code, but ~35 checks spanning seven items, requiring a real or emulated mobile device/browser and disciplined, methodical execution.

---

## Proactively Suggested Tasks

Not explicitly specified in the PRD/TDD but recommended based on this pack's domain (PWA
installability, mobile accessibility, currency/i18n, soft-delete/archive patterns). None are
blocking.

### PROACTIVE-001 · Add `appleWebApp` metadata for iOS "Add to Home Screen" polish
**Status**: UNCHANGED · **Category**: Frontend · **Phase**: 4 (extends FE-010) · **Dependencies**: FE-010

**Why suggested**: The PRD's Success Metrics require the installability checklist verified "on at
least one real Android and one real iOS device," but `FE-010`'s `layout.tsx` code only sets
`manifest`/`icons` — iOS Safari instead reads dedicated `<meta name="apple-mobile-web-app-*">` tags
for status bar styling and the home-screen title. Next.js exposes this via the `appleWebApp` field
in `Metadata` (confirmed in `node_modules/next/dist/docs/.../generate-metadata.md`) — a same-file,
low-effort addition to `FE-010`, not a new integration.

**Definition of Done**:
- [ ] `metadata.appleWebApp = { title: "Rostty", statusBarStyle: "black-translucent" }` (or equivalent) added to `layout.tsx`'s existing `metadata` export.
- [ ] Manual check on iOS Safari (or an equivalent simulator): "Add to Home Screen" shows "Rostty" as the app title and a dark status bar.

**Estimated Complexity**: Low — one additional metadata field, same file already being edited in `FE-010`.

---

### PROACTIVE-002 · Reconsider hamburger touch-target size vs. accessibility guidelines
**Status**: UNCHANGED · **Category**: Frontend · **Phase**: 4 (extends FE-025) · **Dependencies**: FE-025

**Why suggested**: `MobileNavTrigger.tsx`'s hamburger uses `size="icon-sm"`, which resolves to a
28px (`size-7`) tap target (confirmed via `src/components/ui/button.tsx`). WCAG 2.5.5 (AAA) and
most mobile platform guidelines recommend a ~44px minimum, and the PRD explicitly frames the primary
persona as using this UI "one-handed... mid-shift" — a small tap target directly undercuts that
stated goal. This is a judgment call for the implementer/reviewer, not a silent override of the
TDD's exact code.

**Definition of Done**:
- [ ] Decision recorded (in the PR description) on whether to keep `icon-sm` (28px, matches TDD literally) or bump to `icon-lg` (36px) or add extra padding to approximate 44px.
- [ ] If changed, `MobileNavTrigger.tsx`'s `Button` `size` prop updated accordingly with no layout regression against the drawer's own `w-[280px]` dismiss-tap-area math.

**Estimated Complexity**: Low — a single prop value decision, flagged for reviewer judgment.

---

### PROACTIVE-003 · Verify `prefers-reduced-motion` coverage is actually complete
**Status**: REVISED (narrowed to a verification — the global rule is now built by `FE-018`, not proposed here) · **Category**: Testing · **Phase**: 1 (extends FE-018) · **Dependencies**: FE-018, FE-025, FE-039

**Why suggested**: `FE-018` already adds one global `prefers-reduced-motion: reduce` override
covering every `animation`/`transition` in the app — a stronger fix than the prior plan's
per-component `motion-reduce:` variant proposal. This task is now a verification that the global
rule actually reaches the two animation-heaviest additions in this pack (the drawer's slide
transition from `FE-025`, the skeleton pulse from `FE-039`), since both are added by *later* tasks
than `FE-018` and could in principle use a `!important`-overriding inline style that defeats the
global rule.

**Definition of Done**:
- [ ] With OS-level or DevTools "reduce motion" enabled: the drawer (`FE-025`) still opens/closes correctly, functionally, without the slide transition.
- [ ] With reduce-motion enabled: skeleton (`FE-039`) placeholders render as static, non-pulsing rectangles.
- [ ] Confirmed neither `FE-025` nor `FE-039` introduces an inline style or `!important` rule that would defeat `FE-018`'s global override.

**Estimated Complexity**: Low — a verification pass across two already-built components, not new code.

---

### PROACTIVE-004 · Consider a lightweight audit trail for inventory archive/restore actions
**Status**: NEW · **Category**: Backend · **Phase**: 3 (extends BE-005) · **Dependencies**: BE-005

**Why suggested**: Every other stock-affecting action in this app writes a permanent record —
`OrderIngredientLog` for consumption, and the TDD explicitly treats "who changed what, when" as
valuable enough to preserve even through a hard-delete-avoidance redesign (item 7's whole premise).
`toggleInventoryItemActive`/the corrected `deleteInventoryItem`, by contrast, record *that* an item
is archived but not *when* or *by whom* — for a single-admin tool this is low business value today,
but "when did we stop carrying rice" is exactly the kind of question a business owner asks months
later, and there's currently no record beyond `updatedAt` (which any other edit also bumps, so it
can't distinguish an archive from, say., a stock-count correction).

**Definition of Done**:
- [ ] Decision recorded (in the PR description) on whether this is worth a follow-up (e.g. a lightweight `archivedAt`/`archivedReason` field) or explicitly deferred as out of scope for a single-admin tool.
- [ ] If deferred, no code change required — this task closes as a documented decision, not an implementation.

**Estimated Complexity**: Low — a scoping decision, not necessarily new code.

---

### PROACTIVE-005 · Manually verify the fully-archived-recipe edge case in the ingredient picker
**Status**: NEW · **Category**: Testing · **Phase**: 5 (extends FE-022) · **Dependencies**: FE-022, FE-031

**Why suggested**: `FE-022`'s `optionsForRow` reinjection handles a *single* archived row correctly,
but the TDD doesn't explicitly walk through the case where **every** ingredient in a dish's existing
recipe has since been archived — the "Add Ingredient" button's picker would then offer an empty (or
near-empty) list of *new* items to add, while the existing rows still correctly show their
archived-and-reinjected names. Not a bug per the TDD's own scope (archived items are deliberately
excluded from "pick a new item" everywhere), but worth confirming the UI doesn't render confusingly
(e.g. a blank-looking dropdown with no explanatory text) in this specific, plausible-over-time
scenario.

**Definition of Done**:
- [ ] Manually construct a dish whose entire recipe references items, then archive all of them via `FE-031`'s UI.
- [ ] Open that dish for editing in `MenuClient.tsx`; confirm each existing recipe row still shows its correct (archived) name/unit, and the "Add Ingredient" picker's empty-of-new-options state is not visually confusing (e.g. shows a placeholder like "No active ingredients available," not a silently empty dropdown).
- [ ] If the empty state is confusing, file a small follow-up — not blocking for this pack's merge.

**Estimated Complexity**: Low — a manual verification pass, not new code, unless the follow-up above is triggered.

---

## Environment Variables Required

| Variable | Description | Required | Example Value |
|---|---|---|---|
| `NEXT_PUBLIC_CURRENCY` | 3-letter ISO 4217 currency code read by `src/lib/currency.ts`. `NEXT_PUBLIC_`-prefixed since it's read from both Server and Client Components. Defaults to `NGN` if unset or invalid (`console.warn` on invalid values). **Changing this requires a rebuild/restart** — Next.js statically inlines `NEXT_PUBLIC_*` vars at build time. | Optional (defaults to NGN) | `NGN` |

Item 7 (inventory archive) introduces **no new environment variable** — it is a schema-only change
gated by `MIGRATE-001`, not a runtime config toggle (per the TDD's Rollout Plan: "No feature flags").
All other environment variables used by this pack (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`ADMIN_EMAIL`, etc.) are pre-existing and unaffected — already documented in `.env.example`
(verified present and complete by `INFRA-002`).

---

## Open Questions

All items below are **non-blocking** with a documented default already chosen, consistent with this
plan's instruction to be decisive rather than defer — except where explicitly marked otherwise.

1. **`MIGRATE-001` requires real human/scheduling coordination, not just an engineering
   decision.** It touches a database (`postgres` on `127.0.0.1:54322`) that may be shared with other
   concurrently active worktrees/pipelines. **This is the one genuinely blocking item in this
   plan** — Phase 3's inventory-archive code cannot start until a human explicitly approves both
   database pushes. Recommend scheduling this today, independent of everything else, since it has no
   code prerequisites.

2. **TDD's own master "Files touched" table still mislabels `src/app/admin/orders/actions.ts`** as
   needing a `MODIFY` for the due-date item, when the file itself (and the TDD's own body text)
   confirms no change is needed — this is the same defect the previous planning round already found
   and correctly avoided; it persists, unfixed, in this TDD revision. **Decision applied**: no task
   in this list touches `orders/actions.ts` for item 3.

3. **`RecipeBuilder`'s `dish` prop (for `FE-022`'s archived-ingredient reinjection) is an inferred
   implementation detail, not literal TDD text** — the TDD's §7.4 code sample assumes a `dish`
   parameter exists without showing where it comes from, and the component doesn't currently accept
   one. **Decision applied**: `FE-022` makes this explicit (new `dish: DishWithIngredients | null`
   prop, `null` at the create-dish call site). Flagging so a reviewer can confirm this inferred shape
   before implementation, not discover it mid-task.

4. **Header/card background token consolidation** (`FE-026`): the TDD proposes collapsing the
   header's near-imperceptibly-different background onto `--card` rather than keeping a separate
   token. If a reviewer can see the current 2-lightness-point difference and considers it
   intentional, raise this before implementation, not after.

5. **Cancel-confirm message wording** (`FE-020`/`FE-021`): the TDD proposes near-identical text in
   both files ("Cancel order #N? This cannot be undone — a new order must be created if this was a
   mistake."). This is the first time this app has ever surfaced "this cannot be undone" language to
   the admin — confirm the business owner is comfortable with the tone before merge, not just the
   mechanism.

6. **Seeded archived `InventoryItem` for manual QA**: the TDD deliberately does not propose modifying
   `prisma/seed.ts` for a pre-archived fixture — the reveal-toggle/archive/restore flow can be fully
   manually verified by archiving any existing seeded item directly through `FE-031`'s new UI during
   QA. Recommend **not** adding a seed-data change (seed changes carry their own re-run/coordination
   considerations per `MIGRATE-001`'s "do not reseed" constraint) unless a reviewer specifically
   wants a repeatable demo fixture.

7. **Skeleton fidelity** (`FE-040`): simple, roughly-layout-matching skeletons, not pixel-accurate
   content-aware ones. Confirmed acceptable per the TDD's own framing; flagging once more here since
   it affects how much time `FE-040` should budget per route.

8. **Carried forward, now resolved / no longer open**: the "Rostty vs. Rosty" spelling question is
   closed (Rostty, double-t, confirmed correct); the `DialogClose` click-dispatch risk is resolved
   (works, no fallback needed); the two broken `DialogTrigger` "Create" buttons riding along with the
   visual pass is confirmed acceptable (folded into `FE-029`/`FE-031`/`FE-033` rather than a separate
   follow-up PR). None of these require further engineering decisions.

9. **Carried forward from the PRD, still genuinely open (product/content, not engineering)**: the
   `alert()`/`confirm()` → `toast` migration (deliberately deferred; item 6's cancel-confirm and item
   7's archive/restore both deliberately use `alert()`/`confirm()` to stay consistent with today's
   pattern, not to pre-empt that future migration) and the mobile-table-to-card-layout follow-up
   (deliberately out of scope for this pack). Neither blocks this plan; both are flagged so they
   aren't mistaken for oversights when this pack ships without them.

10. **`window.confirm` stubbing requirement — critical handoff note for the next phase, not a task in
    this list.** `jsdom` does not implement `window.confirm`; called unstubbed it returns `undefined`
    (falsy), not a throw. Any *future* test exercising `FE-020`/`FE-021`'s cancel-confirm path must
    stub it first (`vi.spyOn(window, 'confirm').mockReturnValue(true)`), or it will silently take the
    "declined" branch and never call `updateOrderStatus` — appearing to pass while testing nothing.
    This pack deliberately does not add new automated coverage for the cancel-confirm path itself
    (per the TDD's Testing Strategy scope), but whoever eventually does must know this going in.
