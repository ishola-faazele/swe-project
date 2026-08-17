# Engineering Task List: Quick-Win Polish Pack (Phase 1)
**Generated**: 2026-08-17
**Source PRD**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/docs/prd-polish-pack.md`
**Source TDD**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/docs/tdd-polish-pack.md`
**Worktree**: `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack` (branch `feature/polish-pack`, from `main` @ `15f9b08`)
**Total Tasks**: 30 (27 core + 3 proactively suggested) across 4 phases

---

## Summary

This pack ships four independent, additive polish items on top of the existing "Chop with Rosty"
admin portal: a mobile navigation drawer (built by reusing the existing Base UI `dialog.tsx`
primitive rather than a new `sheet.tsx`), Naira currency formatting via a single
`src/lib/currency.ts` module, due-date/overdue alerting via a timezone-pinned pure
`src/lib/dueDate.ts` module (plus the previously-missing UI to actually *set* a due date, without
which the alerting widget would read zero forever), and brand/PWA asset wiring (`layout.tsx`
metadata + a separate Next.js 16 `viewport` export, a fixed `site.webmanifest`, and the real
Rosty logo replacing the placeholder Lucide `Flame` icon). None of the four items require a
database schema change — `Order.dueDate` already exists in `prisma/schema.prisma` and was already
silently accepted (but never populated) by `createOrder`.

The repo has zero test infrastructure today, so the first phase bootstraps a minimal Vitest setup
and builds the two pure, dependency-free logic modules (`currency.ts`, `dueDate.ts`) — everything
downstream (table cells, dashboard widgets, form inputs) is a thin rendering layer on top of these
two modules and must not be started before they exist. Two early spike/verification tasks gate
design decisions the TDD explicitly could not confirm without a running browser or database:
whether Base UI's `DialogClose` button actually dispatches clicks (gates the drawer's close-button
implementation), and whether `npx prisma db push` truly reports zero diff (gates the entire
due-date item's "no schema change" claim). Phasing then proceeds: pure logic → currency/due-date
call-site wiring → brand/PWA + mobile nav UI → a final manual QA pass, since this pack deliberately
defers automated component/interaction tests (justified in the TDD's Testing Strategy) in favor of
a structured manual checklist for the two visual/interaction-heavy items.

Three corrections to the TDD were identified while cross-checking it against the real codebase
(see **Open Questions** for full detail, decisions already made so this list is not blocked):
(1) the TDD's Rollout Plan claims `globals.css` is the *only* file shared between the four items,
but its own per-item file lists show `Sidebar.tsx` and `Header.tsx` are each touched by **both**
the mobile-nav item and the brand/PWA item — this plan sequences those edits rather than treating
them as parallel-safe; (2) the TDD's Section 3 file list claims `src/app/admin/orders/actions.ts`
needs a `MODIFY`, but a direct read confirms `createOrder` already accepts and persists `dueDate`
— no task was created for that file; (3) the TDD claims `.env.example` "does not currently exist,"
but it is already present in the worktree with the exact proposed content, including
`NEXT_PUBLIC_CURRENCY="NGN"` — the corresponding task is a verification, not a file creation.

---

## Dependency Graph

```
Phase 1 (Foundation & Verification)
  INFRA-001 (Vitest) ──┬─→ TEST-001 (currency tests)
  BE-001 (currency.ts) ─┘
  BE-002 (dueDate.ts) ──┬─→ TEST-002 (dueDate tests)
  INFRA-001 ────────────┘
  VERIFY-001 (DialogClose check)   [gates FE-015 in Phase 3]
  VERIFY-002 (prisma db push)      [gates BE-003, FE-006..FE-009 in Phase 2]
  INFRA-002 (.env.example verify)  [independent]
  FE-001 (globals.css badges)      [gates FE-009 in Phase 2]

Phase 2 (Core Logic)                         depends on Phase 1
  BE-001 ─→ FE-002, FE-003, FE-004, FE-005 ─→ TEST-003 (re-grep)
  VERIFY-002 ─→ BE-003 ─→ FE-007
  VERIFY-002 ─→ FE-006
  BE-002, VERIFY-002 ─→ FE-008
  BE-002, FE-001, VERIFY-002 ─→ FE-009

Phase 3 (Integration & UI)                   depends on Phase 1 (+ Phase 2 for none)
  FE-010 (layout.tsx) ─→ FE-011 (manifest)          [independent sub-chain]
  FE-012 (Sidebar logo) ─→ FE-014 (Sidebar onNavigate) ─→ FE-015 (MobileNavTrigger, + VERIFY-001)
  FE-013 (Header logo) ─→ FE-016 (wire trigger into Header, + FE-015)

Phase 4 (Testing & Polish)                   depends on all of Phase 2 + Phase 3
  TEST-004 (manual QA checklist)
```

| Phase | Theme | Task count | Hard gate |
|---|---|---|---|
| 1 — Foundation & Verification | Vitest bootstrap, pure logic modules, early spikes | 9 | Nothing in Phase 2/3 may start before its Phase 1 dependency lands |
| 2 — Core Logic | Currency call-sites, due-date backend + form wiring | 10 | Gated by `VERIFY-002` (schema claim) for all due-date sub-tasks |
| 3 — Integration & UI | Brand/PWA assets, mobile nav drawer | 7 | Gated by `VERIFY-001` for the drawer's close-button approach |
| 4 — Testing & Polish | Manual QA checklist | 1 | Final task; depends on everything above |

---

## Phase 1: Foundation & Verification

### INFRA-001 · Bootstrap minimal Vitest test runner
**Category**: Infrastructure & Config
**Phase**: 1
**Dependencies**: None

**Description**: This repo has no test framework, no `test` script, and no test-related
devDependencies today (confirmed via `package.json` read and `AGENTS.md`/`CLAUDE.md`, which both
explicitly state "no test suite exists"). This task creates the minimal Vitest configuration the
rest of this pack's unit tests (`TEST-001`, `TEST-002`) require to run at all.

**Technical Notes**: Per TDD "Testing Strategy": add `vitest.config.ts` at the repo root with
`resolve.alias['@']` → `./src` (matching the existing `tsconfig.json` path alias) and
`test.environment: 'node'` — explicitly **not** `jsdom`, since every test in this pack targets
pure functions, not DOM/component behavior (see TDD's reasoned trade-off in Testing Strategy for
why component tests are deferred). Add `vitest` as a devDependency and a `"test": "vitest run"`
script to `package.json`. The TDD notes a parallel pipeline may independently bootstrap Vitest too
and that a duplicate config at merge time is "expected and acceptable" — do not block on that.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/vitest.config.ts` created (CREATE) with the alias + node-environment config above.
- [ ] `vitest` added to `package.json` `devDependencies`; `npm install` run so it's present in `node_modules`.
- [ ] `"test": "vitest run"` added to `package.json` `scripts`.
- [ ] `npm run test` executes without a config error (zero test files is an acceptable pre-`TEST-001` state).
- [ ] `npm run lint` still passes with the new config file present.

**Estimated Complexity**: Low — a ~10-line config file and two `package.json` edits, fully specified in the TDD.

---

### VERIFY-001 · Confirm Base UI `DialogClose` actually dispatches click events
**Category**: Testing (manual spike)
**Phase**: 1
**Dependencies**: None

**Description**: `AGENTS.md` documents `<DialogTrigger render={<Button />}>` as broken in this
repo (click events silently swallowed) but does not mention `DialogClose`, which uses the same
`render`-prop composition pattern internally inside `DialogContent`'s `showCloseButton` branch
(`src/components/ui/dialog.tsx` lines ~62–77, confirmed by direct read). The TDD could not verify
this without a running browser and flags it as a first-hour implementation task that gates the
mobile drawer's close-button design (`FE-015`).

**Technical Notes**: Per TDD Open Questions: open any existing dialog that uses the default
`DialogContent` (e.g., the "Create Order" dialog in `OrderClient.tsx`, which already exists and
renders via `showCloseButton = true` by default) in a running dev server and click its X button.

**Definition of Done**:
- [ ] Dev server running (`npm run dev`, accessed via `http://127.0.0.1:3000` per `AGENTS.md`).
- [ ] Opened an existing dialog (e.g., "Create Order") and clicked its built-in X close button.
- [ ] Outcome recorded in the PR description or a code comment in `FE-015`: "DialogClose works" or "DialogClose broken like DialogTrigger."
- [ ] If broken: `FE-015`'s `DialogContent` implementation plan updated to `showCloseButton={false}` + an explicit `<Button onClick={() => setOpen(false)}>`, per the TDD's pre-designed fallback.
- [ ] If working: `FE-015` proceeds with `DialogContent`'s default close button, no extra code.

**Estimated Complexity**: Low — a five-minute manual check, but blocking for `FE-015`'s exact shape.

---

### VERIFY-002 · Confirm `npx prisma db push` reports zero schema diff
**Category**: Infrastructure & Config
**Phase**: 1
**Dependencies**: None

**Description**: The entire due-date/overdue item is designed as "pure derived logic... NO schema
change," since `Order.dueDate` already exists in `prisma/schema.prisma`. This is a claim worth
verifying, not just asserting (per the TDD's own Rollout Plan) — this task runs the actual command
and captures its output before any due-date UI work begins.

**Technical Notes**: Per TDD Rollout Plan: "`npx prisma db push` is a no-op for this pack (zero
schema changes) — confirm this explicitly during implementation by running it and confirming no
diff." Requires local Supabase Postgres running (`npm run supabase:start` per `AGENTS.md`'s Local
Dev Quick Start) against the worktree's own `DATABASE_URL`.

**Definition of Done**:
- [ ] Local Supabase Postgres running and reachable at the `DATABASE_URL` in the worktree's `.env`.
- [ ] `npx prisma db push` executed against `prisma/schema.prisma` in this worktree.
- [ ] Command output confirms "already in sync" / zero pending changes — not an interactive migration prompt.
- [ ] Output captured (e.g., pasted into the PR description) as evidence for the "zero schema change" claim.
- [ ] Result gates `BE-003`, `FE-006`, `FE-007`, `FE-008`, `FE-009` — do not start those until this passes.

**Estimated Complexity**: Low — one command, but blocking for the entire due-date item.

---

### INFRA-002 · Verify `.env.example` already documents `NEXT_PUBLIC_CURRENCY`
**Category**: Infrastructure & Config
**Phase**: 1
**Dependencies**: None

**Description**: The TDD states `.env.example` "does not currently exist in this worktree" and
proposes creating it fresh. A direct file read shows this is **stale** — `.env.example` already
exists in the worktree (visible as an untracked file in `git status`) with the exact content the
TDD proposes, including `NEXT_PUBLIC_CURRENCY="NGN"` and an accurate inline comment referencing
`src/lib/currency.ts`. This task is therefore a verification, not a creation, to avoid an
implementer overwriting a file that's already correct.

**Technical Notes**: Diff the TDD's proposed `.env.example` content (TDD Section 2, "Files
touched") against the file already at
`/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/.env.example`. If they match (they do, as
of this planning pass), no edit is needed. If `BE-001`'s implementation diverges from the TDD's
exact variable name (`NEXT_PUBLIC_CURRENCY`), update this file to match.

**Definition of Done**:
- [ ] `.env.example` confirmed present at the worktree root (MODIFY only if a mismatch is found; otherwise no-op).
- [ ] `NEXT_PUBLIC_CURRENCY="NGN"` line present with an explanatory comment.
- [ ] No other env var in the file altered or removed.
- [ ] Confirmed this file is `.gitignore`-safe to commit (it's a template with no real secrets — already true).

**Estimated Complexity**: Low — verification-only; the file is already correct as discovered.

---

### BE-001 · Create `src/lib/currency.ts`
**Category**: Backend (shared/isomorphic logic)
**Phase**: 1
**Dependencies**: None

**Description**: A single module resolving the app's currency from `NEXT_PUBLIC_CURRENCY` (default
`NGN`/`en-NG`) and exposing `formatCurrency`, `getCurrencySymbol`, and `getCurrencyCode`. This is
the one place currency formatting logic lives, so all four render sites (`FE-002`–`FE-005`) stay
consistent by construction rather than by convention.

**Technical Notes**: Implement exactly per TDD Section 2's code block — `CURRENCY_LOCALES` lookup
table (NGN→en-NG, GHS→en-GH, USD→en-US, GBP→en-GB, EUR→en-IE), `resolveCurrencyCode()` validates
via constructing a throwaway `Intl.NumberFormat` and catching `RangeError`, formatter constructed
**once at module load** (not per-call). Must be `NEXT_PUBLIC_`-prefixed because it's read from both
Server Components (`admin/page.tsx`, `dashboard/page.tsx`) and Client Components
(`OrderClient.tsx`, `OrderDetailsClient.tsx`) — un-prefixed vars are invisible to client bundles.
Changing this var requires a rebuild/restart (Next.js inlines `NEXT_PUBLIC_*` at build time) — this
is an operational note worth a code comment, not just documentation.

**Definition of Done**:
- [ ] File created at `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/currency.ts` (CREATE) exporting `formatCurrency`, `getCurrencySymbol`, `getCurrencyCode`.
- [ ] Unset `NEXT_PUBLIC_CURRENCY` → defaults to NGN with no warning logged.
- [ ] Invalid code (e.g., `"NGM"`) → falls back to NGN **and** logs a `console.warn` naming the bad value.
- [ ] `formatCurrency(NaN)` / `formatCurrency(Infinity)` formats `0` rather than throwing or rendering `"NaN"`.
- [ ] `getCurrencySymbol()` returns the bare symbol (e.g., `"₦"`), not a full formatted amount.
- [ ] TypeScript compiles with no errors.

**Estimated Complexity**: Medium — the validation/fallback branching and module-load-time singleton pattern have real edge cases, though the TDD provides near-complete code.

---

### BE-002 · Create `src/lib/dueDate.ts`
**Category**: Backend (shared/isomorphic logic)
**Phase**: 1
**Dependencies**: None

**Description**: A pure, timezone-pinned module exporting `getDueUrgency`, `ACTIVE_ORDER_STATUSES`,
and `isActiveOrderStatus`. This is the single source of truth for "what counts as active" and "is
this order due today/overdue," consumed by both the dashboard widget (`FE-008`) and the orders
table (`FE-009`) so the two can never drift out of sync with each other.

**Technical Notes**: Implement exactly per TDD Section 3's code block. Core design: "today" is
computed via `Intl.DateTimeFormat` pinned to `timeZone: "Africa/Lagos"` (UTC+1, no DST), **not**
the ambient server/host timezone — this matters because a serverless host commonly runs in UTC,
and naive local-timezone comparison would misclassify orders right at the WAT day boundary (TDD's
worked example: `dueDate = 2026-08-17T23:30:00Z` is already `2026-08-18` in Lagos). Comparison is
**date-granular** (`'YYYY-MM-DD'` string compare via `en-CA` locale formatting), not
timestamp-granular, since the UI never collects a time-of-day. `now` must be an injectable second
parameter (default `new Date()`) so tests never need to mock the system clock.

**Definition of Done**:
- [ ] File created at `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/dueDate.ts` (CREATE) exporting `getDueUrgency`, `ACTIVE_ORDER_STATUSES`, `isActiveOrderStatus`, and the `DueUrgency` type.
- [ ] `getDueUrgency` uses `Intl.DateTimeFormat` with an explicit `timeZone: "Africa/Lagos"`, not `Date.prototype.getDate()`/ambient-TZ methods.
- [ ] `null`/`undefined`/malformed `dueDate` string returns `"none"` without throwing (`Number.isNaN(due.getTime())` guard).
- [ ] `ACTIVE_ORDER_STATUSES` is `["PENDING", "PREPPING", "COOKING", "READY"]`, matching the six-value `OrderStatus` enum in `prisma/schema.prisma` minus `COMPLETED`/`CANCELLED`.
- [ ] `now` is a real second parameter with a default, not a hardcoded internal `new Date()` call.
- [ ] TypeScript compiles cleanly; `OrderStatus` imported from `@prisma/client`.

**Estimated Complexity**: Medium — the timezone-pinning logic is the highest-risk correctness surface in this whole pack; low line count but easy to get subtly wrong.

---

### TEST-001 · Unit tests for `src/lib/currency.ts`
**Category**: Testing
**Phase**: 1
**Dependencies**: BE-001, INFRA-001

**Description**: Covers the fallback/validation branches that are easy to silently break —
particularly the "invalid code falls back without throwing" and "NaN input doesn't render `NaN`"
cases, which are exactly the kind of defensive logic that erodes without a test forcing it to stay
correct.

**Technical Notes**: Per TDD Testing Strategy #2, **must** use `vi.resetModules()` + dynamic
`import()` per test case that needs a different `NEXT_PUBLIC_CURRENCY` value — a single static
top-level import cannot exercise the fallback branches, because `resolveCurrencyCode()` runs once
at module load. Document this pattern in a comment in the test file itself so a future edit
doesn't "simplify" it into a broken shared-import version.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/currency.test.ts` created (CREATE).
- [ ] Test: unset `NEXT_PUBLIC_CURRENCY` → formats with `₦` (NGN default).
- [ ] Test: valid override (`GHS`) → formats with the correct GHS symbol/locale.
- [ ] Test: invalid code → falls back to NGN, does not throw.
- [ ] Test: `formatCurrency(NaN)` → formats `0`, not `"NaN"` or a thrown error.
- [ ] Test: `getCurrencySymbol()` returns just the symbol.
- [ ] `npm run test` passes all cases in this file.

**Estimated Complexity**: Medium — the module-reset-per-test pattern is a real but non-obvious Vitest technique; everything else is straightforward assertions.

---

### TEST-002 · Unit tests for `src/lib/dueDate.ts`
**Category**: Testing
**Phase**: 1
**Dependencies**: BE-002, INFRA-001

**Description**: The primary correctness target of this whole pack per the PRD's Success Metrics
("Zero false negatives in the due-today/overdue derivation logic... a correctness bar"). Covers
the null case, the three urgency states, the Lagos/UTC timezone boundary (the design's central
risk), a malformed-input guard, and the `isActiveOrderStatus` × `getDueUrgency` interaction so a
completed order's stale due date never renders as overdue.

**Technical Notes**: Per TDD Testing Strategy #1 and Edge Cases & Failure Modes. **Correction to
the TDD**: the timezone-boundary test case description in the TDD (around "Timezone boundary
regression case") is internally self-contradictory — it proposes `dueDate =
"2026-08-17T23:30:00Z"` / `now = "2026-08-18T00:15:00Z"` and then admits mid-sentence these are
"actually different UTC days already in this example," which defeats the point of the test (it
needs to prove the Lagos-pinned result differs from a *naive UTC* result). Construct the pair
correctly instead: pick a `dueDate` and `now` that fall on the **same UTC calendar day** but
**different Lagos calendar days** — e.g. `dueDate = new Date("2026-08-17T22:00:00Z")` (which is
`2026-08-17T23:00` in Lagos, still Aug 17 there) versus `now = new Date("2026-08-17T23:30:00Z")`
(which is `2026-08-18T00:30` in Lagos — already Aug 18 there, while still Aug 17 in UTC). Assert
the Lagos-pinned result (`"overdue"`, since the due date's Lagos-day is before today's Lagos-day),
which a naive UTC-only comparison would get wrong (both instants are Aug 17 in UTC).

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/lib/dueDate.test.ts` created (CREATE).
- [ ] Test: `null`/`undefined` `dueDate` → `"none"`.
- [ ] Test: past `dueDate`, today's `now` → `"overdue"`.
- [ ] Test: same calendar day (different time-of-day) → `"due-today"`.
- [ ] Test: future `dueDate` → `"upcoming"`.
- [ ] Test: the corrected Lagos/UTC boundary-crossing pair (see Technical Notes) asserts the Lagos-pinned result, not the naive-UTC result.
- [ ] Test: malformed date string → `"none"`, does not throw.
- [ ] Test: `COMPLETED` order with a long-overdue `dueDate`, combined via `isActiveOrderStatus` at the call-site pattern → resolves to "not flagged."
- [ ] All `now` values passed explicitly; zero reliance on the real system clock.
- [ ] `npm run test` passes all cases in this file.

**Estimated Complexity**: Medium — mostly mechanical, but constructing the corrected boundary-crossing instant pair requires careful UTC/WAT arithmetic (see the TDD correction above).

---

### FE-001 · Add due-date badge utility classes to `globals.css`
**Category**: Frontend
**Phase**: 1
**Dependencies**: None

**Description**: Adds `.due-overdue` and `.due-today` utility classes, matching the existing
`.status-*`/`.stock-*` Tailwind `@apply` idiom already in the file. Must land before `FE-009`
(orders table Due column), which references these class names.

**Technical Notes**: Per TDD Section 3. Insert inside the existing `@layer utilities` block, right
after the `.stock-*` classes, using the exact same `inline-flex items-center gap-1 rounded px-2
py-0.5 text-xs font-medium` shape as `.stock-critical`/`.stock-warning`. This is purely additive —
per the TDD's Rollout Plan, `globals.css` is the one file every item in this pack may touch without
conflict, since existing classes are never renamed or removed.

**Definition of Done**:
- [ ] `.due-overdue` (`bg-red-950/60 text-red-400 border-red-800/50`) and `.due-today` (`bg-amber-950/60 text-amber-400 border-amber-800/50`) added to `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/globals.css` (MODIFY, additive only).
- [ ] No existing class in the file renamed, removed, or restyled.
- [ ] `npm run dev` / `npm run build` compiles the stylesheet with no Tailwind errors.

**Estimated Complexity**: Low — two small `@apply` blocks copy-pasted from an established pattern already in the file.

---

## Phase 2: Core Logic — Currency & Due-Date Wiring

### FE-002 · Replace `$` with `formatCurrency()` in `OrderClient.tsx` table cell
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-001

**Description**: The orders table's "Total" column currently renders `` `$${info.getValue()}` ``
(confirmed at line 79) with no thousands separators or decimal normalization. This is the
highest-visibility of the four currency sites — every row in the primary admin orders view.

**Technical Notes**: Per TDD Section 2 call sites. Import `formatCurrency` from `@/lib/currency`;
replace the cell renderer with `formatCurrency(info.getValue())`.

**⚠️ Merge-conflict risk**: `OrderClient.tsx` is a high-traffic shared file — also touched by
`FE-003`, `FE-006`, `FE-009` in this pack, and very likely by the parallel Phase 0
(integrity-hardening) and Phase 2 (menu/recipe) pipelines (validation/error-handling around
`handleAdd`, and ingredient-selection redesign, respectively). Keep this diff minimal and scoped
to the single cell renderer.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/OrderClient.tsx` (MODIFY) — the `totalPrice` column's `cell` function calls `formatCurrency(info.getValue())`.
- [ ] `import { formatCurrency } from "@/lib/currency"` added.
- [ ] No literal `$` remains in this cell's render path.
- [ ] Manual check: orders table renders `₦`-formatted totals in dev.

**Estimated Complexity**: Low — single-line change to an already-imported module.

---

### FE-003 · Replace `$` with `getCurrencySymbol()` in `OrderClient.tsx` form label
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-001

**Description**: The create-order form's "Total Price ($)" label (confirmed at line 148)
hardcodes the dollar sign inside the label text itself, independent of the table-cell change in
`FE-002`.

**Technical Notes**: Per TDD Section 2. `<Label htmlFor="totalPrice">Total Price
({getCurrencySymbol()})</Label>`.

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-006`/`FE-009` — see `FE-002`'s note.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — form label reads `Total Price ({getCurrencySymbol()})`.
- [ ] `getCurrencySymbol` added to the existing `@/lib/currency` import (or imported fresh if `FE-002` hasn't landed yet in the same PR).
- [ ] Manual check: label renders `Total Price (₦)` in dev.

**Estimated Complexity**: Low — single JSX text change.

---

### FE-004 · Replace `$` with `formatCurrency()` in `OrderDetailsClient.tsx`
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-001

**Description**: The order detail page's "Total Price" field (confirmed at line 72, `` ${order.totalPrice} ``) is the third of four render sites — the admin's per-order deep-dive view.

**Technical Notes**: Per TDD Section 2. `<p><span className="font-medium text-slate-500">Total
Price:</span> {formatCurrency(order.totalPrice)}</p>`.

**⚠️ Merge-conflict risk**: `OrderDetailsClient.tsx` is also touched by `FE-007` in this pack, and
likely by the Phase 0 hardening pipeline (error handling around `handleSaveIngredients`).

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/[id]/OrderDetailsClient.tsx` (MODIFY) — Total Price line calls `formatCurrency(order.totalPrice)`.
- [ ] `import { formatCurrency } from "@/lib/currency"` added.
- [ ] Manual check: order detail page renders `₦`-formatted total in dev.

**Estimated Complexity**: Low — single-line change.

---

### FE-005 · Replace `$` with `formatCurrency()` in `dashboard/page.tsx`
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-001

**Description**: The customer-facing order-history dashboard (confirmed at line 102, ``
${order.totalPrice.toFixed(2)} ``) is the only currency site a *customer* (not just the admin)
sees — the PRD explicitly calls this out as reputationally important ("reads as unfinished/foreign
on customer-facing screens").

**Technical Notes**: Per TDD Section 2. This is a Server Component (`async function
CustomerDashboardPage`), so `formatCurrency` runs server-side here — confirming the module's
"byte-identical output on server and client" design property actually matters for this exact call
site (mixed with the client-side calls in `OrderClient.tsx`/`OrderDetailsClient.tsx`).

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/dashboard/page.tsx` (MODIFY) — price span calls `formatCurrency(order.totalPrice)`, dropping the manual `.toFixed(2)` (the `Intl.NumberFormat` formatter already handles decimal precision).
- [ ] `import { formatCurrency } from "@/lib/currency"` added.
- [ ] Manual check: logged in as a customer, order history shows `₦`-formatted totals.

**Estimated Complexity**: Low — single-line change plus removing the now-redundant `.toFixed(2)`.

---

### TEST-003 · Re-grep `src/` for missed `$` price-rendering sites
**Category**: Testing
**Phase**: 2
**Dependencies**: FE-002, FE-003, FE-004, FE-005

**Description**: Directly verifies the PRD's binary success metric ("Zero occurrences of a literal
`$` currency symbol in any price-rendering JSX across `src/`") rather than trusting the TDD's
pre-implementation audit. Explicitly re-checks the notification templates, which render order data
but were confirmed (not assumed) to never render `totalPrice`.

**Technical Notes**: Per TDD Section 2's own audit method: grep pattern `\$\{|\$\$|"\$"|'\$'` across
`src/`, plus a direct look at `src/lib/notifications/email.ts` and `src/lib/notifications/sms.ts`.

**Definition of Done**:
- [ ] Ran a `$`-pattern grep across the full `src/` tree (excluding template-literal `${}` interpolation syntax that isn't a currency symbol).
- [ ] Zero hits remain in `OrderClient.tsx`, `OrderDetailsClient.tsx`, `dashboard/page.tsx` beyond what `FE-002`–`FE-005` already fixed.
- [ ] `src/lib/notifications/email.ts` and `src/lib/notifications/sms.ts` explicitly checked — confirmed neither renders `totalPrice` (both only render description/status/due-date text) — documented in the PR description, not just assumed from the TDD.
- [ ] `prisma/seed.ts` checked — confirmed no `$`-prefixed price string generation.
- [ ] Result recorded as satisfying the PRD's currency success metric.

**Estimated Complexity**: Low — a verification pass, not new code; the audit was already done once by the TDD author and is being independently re-confirmed.

---

### BE-003 · Add `updateOrderDueDate` Server Action
**Category**: Backend
**Phase**: 2
**Dependencies**: VERIFY-002

**Description**: A new Server Action allowing the admin to set/correct an order's due date after
creation, mirroring the existing inline `updateOrderStatus` pattern. Without this, due dates could
only ever be set once at order-creation time (`FE-006`), with no way to correct a typo or add a
date to an order created before this pack shipped.

**Technical Notes**: Per TDD Section 3. `prisma.order.update({ where: { id }, data: { dueDate }
})`, then `revalidatePath` for both `/admin/orders/${id}` and `/admin/orders` — matching
`updateOrderIngredients`'s existing revalidation pattern in the same file exactly. Per TDD Security
Considerations: **no auth/role check is added**, intentionally matching the existing (pre-existing,
explicitly out-of-scope) lack of authorization on every other action in `src/app/admin/orders/**`
— this is a known, tracked gap (Phase 0 hardening), not a regression introduced here.

**⚠️ Merge-conflict risk**: `src/app/admin/orders/[id]/actions.ts` is very likely also touched by
the parallel Phase 0 (integrity-hardening) pipeline, which is expected to add
validation/authorization to `updateOrderIngredients` in this same file.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/orders/[id]/actions.ts` (MODIFY) — new exported `updateOrderDueDate(id: string, dueDate: Date | null)`.
- [ ] Updates `Order.dueDate` via `prisma.order.update`.
- [ ] Calls `revalidatePath('/admin/orders/${id}')` and `revalidatePath('/admin/orders')`.
- [ ] No new auth check added (matches existing file convention — verified by comparing against `updateOrderIngredients` in the same file).
- [ ] TypeScript compiles cleanly.

**Estimated Complexity**: Low — a five-line function mirroring an existing pattern in the same file.

---

### FE-006 · Add due-date input to order create form
**Category**: Frontend
**Phase**: 2
**Dependencies**: VERIFY-002

**Description**: **Load-bearing, not optional polish**: `createOrder` in
`src/app/admin/orders/actions.ts` already accepts `dueDate?: Date | null` and already persists it
(confirmed by direct read — no backend change needed, see Open Questions), but no screen has ever
collected it — the create-order form has zero due-date input today. Without this task, the
dashboard widget (`FE-008`) and table column (`FE-009`) would ship permanently reading zero, since
every order (existing and newly created) would have `dueDate = null` forever.

**Technical Notes**: Per TDD Section 3 and PRD "A note on scope." Add `<Label htmlFor="dueDate">Due
Date (Optional)</Label>` + `<Input id="dueDate" name="dueDate" type="date" />` to the existing form
grid, next to Total Price. In `handleAdd`, read `formData.get("dueDate")`, parse `""` → `null`,
otherwise `new Date(dueDateStr)` — per TDD, `new Date("YYYY-MM-DD")` parses as UTC midnight, which
is still the *same* calendar day in Lagos (UTC+1) so no local-time parsing correction is needed;
this is intentional and should not be "fixed" to local-time parsing (see TDD's inline-comment
warning). Pass `dueDate` through to the existing `createOrder(...)` call.

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-003`/`FE-009` — see `FE-002`'s note. This is
the largest of the `OrderClient.tsx` edits in this pack (touches both the form JSX and `handleAdd`).

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — due-date `<Input type="date">` added to the create-order form grid.
- [ ] `handleAdd` parses the date field (empty → `null`) and includes `dueDate` in the `createOrder(...)` call's argument object.
- [ ] **No change made to `src/app/admin/orders/actions.ts`** — confirmed unnecessary (see Open Questions); `createOrder`'s existing signature and `prisma.order.create` call already handle `dueDate`.
- [ ] Manual check: creating an order with a due date selected persists it (visible on the order detail page immediately after creation).
- [ ] Manual check: creating an order with the field left blank still succeeds with no validation error (field is optional).

**Estimated Complexity**: Medium — touches both form markup and `handleAdd`'s parsing logic; the "why no actions.ts change" reasoning needs to be understood, not just copy-pasted.

---

### FE-007 · Add inline due-date edit to `OrderDetailsClient.tsx`
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-003

**Description**: Lets the admin set or correct a due date after order creation, mirroring the
existing inline status-`<select>` pattern (immediate save on change, no separate "edit mode"). This
is the second half of the "make `dueDate` actually settable" scope addition documented in the PRD.

**Technical Notes**: Per TDD Section 3. `<input type="date" defaultValue={order.dueDate ?
order.dueDate.toISOString().slice(0, 10) : ''} onChange={...} />`, calling `updateOrderDueDate`
then `router.refresh()` — the exact same shape as the existing status `<select>`'s `onChange` a few
lines above it in the same file. Relies on `Order.dueDate` (a Prisma `DateTime`) arriving as a real
`Date` instance across the Server→Client Component boundary — confirmed safe in this Next.js
version (Next's compiled RSC runtime has explicit `instanceof Date` handling in its Flight
serialization), consistent with how `order.createdAt` is already handled elsewhere in Server
Components.

**⚠️ Merge-conflict risk**: same file as `FE-004` — see that task's note.

**Definition of Done**:
- [ ] `OrderDetailsClient.tsx` (MODIFY) — `<input type="date">` added next to the existing status `<select>`, with `defaultValue` derived from `order.dueDate`.
- [ ] `onChange` calls `updateOrderDueDate(order.id, parsedDateOrNull)` then `router.refresh()`.
- [ ] `import { updateOrderDueDate } from "./actions"` added.
- [ ] Manual check: editing the due date on an existing order persists after `router.refresh()` and survives a hard page reload.
- [ ] Manual check: clearing the date input sets `dueDate` back to `null` (verified via a hard reload, not just the optimistic UI state).

**Estimated Complexity**: Medium — mirrors an existing pattern closely, but the null-clearing path needs explicit verification.

---

### FE-008 · Add "Due Today" / "Overdue" stat cards to admin dashboard
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-002, VERIFY-002

**Description**: Surfaces the PRD's core success metric directly on the dashboard: "how many active
orders are due today or already overdue." Extends the existing `stats` array / `.stat-card` pattern
in `admin/page.tsx` rather than inventing new visual language.

**Technical Notes**: Per TDD Section 3. Add one more parallel query to the existing `Promise.all`:
`prisma.order.findMany({ where: { status: { in: ACTIVE_ORDER_STATUSES } }, select: { dueDate: true
} })`. Derive `dueTodayCount`/`overdueCount` via `.filter(o => getDueUrgency(o.dueDate) ===
'due-today' | 'overdue')`. Append two entries to the existing `stats` array with the same shape as
the four existing ones. **Change the grid class from `sm:grid-cols-2 lg:grid-cols-4` to
`sm:grid-cols-2 lg:grid-cols-3`** so the now-six-card grid lays out as a clean 2×3 rather than an
uneven 4+2 wrap — this grid-class change is easy to forget since it's not part of the stats-array
logic itself.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/admin/page.tsx` (MODIFY) — new `prisma.order.findMany` query added to the existing `Promise.all` array.
- [ ] `import { ACTIVE_ORDER_STATUSES, getDueUrgency } from '@/lib/dueDate'` added.
- [ ] Two new stat-card entries ("Due Today", "Overdue") appended to the `stats` array with `label`/`value`/`icon`/`sub`/`alert` matching the existing four entries' shape.
- [ ] Grid class changed to `sm:grid-cols-2 lg:grid-cols-3` (2×3 layout for 6 cards).
- [ ] Manual check: counts match manually-verified due-today/overdue orders in local dev after `FE-006`/`FE-007` are in place to actually set due dates.

**Estimated Complexity**: Medium — straightforward query/array extension, but the grid-class change and count-correctness both need manual verification against real data.

---

### FE-009 · Add "Due" column + row tint to orders table
**Category**: Frontend
**Phase**: 2
**Dependencies**: BE-002, FE-001, VERIFY-002

**Description**: Surfaces due-date urgency directly in the orders table — a new "Due" column with a
colored, text-labeled badge for qualifying active orders, plus a subtle row background tint that
reinforces (never replaces) the badge, per the PRD's explicit accessibility requirement that color
alone must never carry the meaning.

**Technical Notes**: Per TDD Section 3. New `columnHelper.accessor("dueDate", ...)` column
positioned after "Status" — cell renders `—` for null, the `.due-overdue`/`.due-today` badge
classes (from `FE-001`) for qualifying orders, plain formatted date otherwise, always gated by
`isActiveOrderStatus(status)` before calling `getDueUrgency` (so a `COMPLETED` order's stale due
date never flags). Row tint extends the existing `idx % 2` inline-style ternary already on each
`<tr>`. Badge text always pairs an icon glyph (`⚠`/`●`) with words ("Overdue"/"Due Today") — never
color-only, per PRD accessibility requirement.

**⚠️ Merge-conflict risk**: same file as `FE-002`/`FE-003`/`FE-006` — see `FE-002`'s note. This is
the last of four edits to `OrderClient.tsx` in this pack; land it last within the file to minimize
rebase churn against the earlier three.

**Definition of Done**:
- [ ] `OrderClient.tsx` (MODIFY) — new `dueDate` accessor column added after "Status", using `.due-overdue`/`.due-today` classes from `FE-001`.
- [ ] Row `<tr>` `style.background` ternary extended with overdue/due-today tints, falling back to the existing alternating-row background otherwise.
- [ ] Manual check: a `COMPLETED` order with a long-past `dueDate` shows **neither** the badge **nor** the row tint (status-gating verified visually).
- [ ] Manual check: badge always shows both an icon glyph and text, never color-only.
- [ ] Manual check: `null` `dueDate` renders `—`, not a blank cell or a JS error.

**Estimated Complexity**: Medium — column + row-styling logic is small individually, but the status-gating interaction is the one place this task could silently regress `dueDate.ts`'s own test coverage if implemented differently from the tested call pattern.

---

## Phase 3: Integration & UI — Brand/PWA & Mobile Nav

> Land order within this phase follows the TDD's Rollout Plan: brand/PWA assets first, mobile nav
> last, since `Sidebar.tsx` and `Header.tsx` are each touched by both sub-features (see Open
> Questions) — sequencing avoids overlapping diff hunks in the same two files.

### FE-010 · Add icons/manifest metadata + separate `viewport` export to `layout.tsx`
**Category**: Frontend
**Phase**: 3
**Dependencies**: None

**Description**: Wires the browser tab favicon, PWA manifest link, and theme color into the root
layout. This is the file where the Next.js 16 `themeColor`/`colorScheme`-in-`metadata` deprecation
trap most directly applies.

**Technical Notes**: Per TDD Section 4 and the framework constraint verified by reading
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` directly:
**`themeColor` and `colorScheme` must be a separate `export const viewport: Viewport = {...}`, NOT
nested inside the `metadata` object** — this is deprecated as of Next.js 14 and this repo is on
Next.js 16. Import `Viewport` alongside `Metadata` from `"next"`. `metadata.manifest =
"/site.webmanifest"`; `metadata.icons` lists `favicon.ico` (`sizes: "any"`), `favicon-16x16.png`,
`favicon-32x32.png`, and `apple` → `apple-touch-icon.png` — all already committed in `public/`
(confirmed present via `git status`). `themeColor: "#0d0b0a"` approximates
`--background: oklch(0.08 0.004 65)`; verify against DevTools computed style before shipping.
`colorScheme: "dark"` matches the app's unconditionally-forced `dark` class on `<html>`.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/app/layout.tsx` (MODIFY) — `Viewport` type imported; `export const viewport: Viewport = { themeColor: "#0d0b0a", colorScheme: "dark" }` added as a **sibling** export to `metadata`, not nested inside it.
- [ ] `metadata.manifest` set to `"/site.webmanifest"`.
- [ ] `metadata.icons` populated with the four icon entries listed above.
- [ ] `npm run build` produces no deprecation warning about `themeColor`/`colorScheme` inside `metadata`.
- [ ] Manual check: browser tab shows the real favicon (not Next.js's default) after a hard refresh in dev.

**Estimated Complexity**: Low — mostly declarative object literals; the only real risk is the deprecated-placement trap, which is explicitly called out.

---

### FE-011 · Fix `public/site.webmanifest` content
**Category**: Frontend
**Phase**: 3
**Dependencies**: None

**Description**: The manifest currently has empty `name`/`short_name`, no `start_url`, and a white
`theme_color`/`background_color` despite the app being permanently dark-themed — none of which pass
Chrome/Android's installability checklist, and the white background would flash before the dark UI
paints on launch.

**Technical Notes**: Per TDD Section 4, replace the full file content with the TDD's exact JSON:
`name: "Chop with Rosty"`, `short_name: "Rosty"`, `start_url: "/"` (deliberately not `/admin` — the
existing auth-redirect hub at `src/app/page.tsx` already decides admin-vs-customer destination
correctly), `display: "standalone"`, `background_color`/`theme_color` both `"#0d0b0a"`.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/public/site.webmanifest` (MODIFY) — full content replaced per TDD's exact JSON.
- [ ] `start_url` is `"/"`, `scope` is `"/"`, `display` is `"standalone"`.
- [ ] `background_color` and `theme_color` both `"#0d0b0a"` (no white flash on launch).
- [ ] Chrome DevTools → Application → Manifest panel shows no errors/warnings for the updated file.

**Estimated Complexity**: Low — a full-file JSON replacement, fully specified in the TDD.

---

### FE-012 · Replace Sidebar `Flame` icon with `rosty-logo.jpeg` white-chip
**Category**: Frontend
**Phase**: 3
**Dependencies**: None

**Description**: Replaces the generic amber-box Lucide `Flame` brand mark in the desktop sidebar
with the real "Chop with Rosty" logo, wrapped in a white "logo chip" since the source JPEG has an
opaque white background baked into every pixel (no alpha channel) that would otherwise read as a
rendering glitch against the app's dark chrome.

**Technical Notes**: Per TDD Section 4 — this is the **first use of `next/image` anywhere in this
codebase** (confirmed via grep; the one hit in `src/proxy.ts` is an unrelated routing-matcher
comment). Since `rosty-logo.jpeg` is a `public/`-referenced asset (not a statically-imported
module — `public/` isn't under the `@/*` alias), Next cannot infer intrinsic width/height, so use
`fill` + a sized `relative` parent + `object-contain`, not a hardcoded `width`/`height` guess:
`<div className="relative flex h-8 w-8 items-center justify-center rounded overflow-hidden bg-white p-1"><Image src="/rosty-logo.jpeg" alt="Chop with Rosty" fill className="object-contain" /></div>`.
Same `h-8 w-8` footprint as the removed `Flame` icon box — no layout shift. `next.config.ts` needs
no `images` config change (confirmed — this is a local `public/` asset, not remote).

**⚠️ Merge-conflict risk**: `Sidebar.tsx` is also touched by `FE-014` in this pack (mobile-nav's
`onNavigate` prop) — land this task first, per the phase-level sequencing note above.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/Sidebar.tsx` (MODIFY) — `Flame` icon and amber box wrapper removed, replaced with the white-chip `next/image` treatment above.
- [ ] `next/image`'s `Image` component imported.
- [ ] Wrapping `div` is `relative` (required for `fill`).
- [ ] Manual check: no stray white square edge bleeding into the dark sidebar background.
- [ ] Manual check: brand mark footprint unchanged (`h-8 w-8`), no layout shift vs. the previous `Flame` icon.

**Estimated Complexity**: Medium — first `next/image` usage in the codebase; the `fill`+`relative` pattern is easy to get subtly wrong (the TDD's own draft snippet initially omitted `relative` before self-correcting).

---

### FE-013 · Add logo mark to `Header.tsx` mobile header
**Category**: Frontend
**Phase**: 3
**Dependencies**: None

**Description**: `Header.tsx` currently has no brand-icon at all — only the text "Admin Portal."
Since the desktop sidebar (and its logo) is `hidden` below `md`, the mobile header is the *only*
persistently-visible chrome on a phone, so it needs its own small brand mark for mobile users to
see with the drawer closed.

**Technical Notes**: Per TDD Section 4 — this is a small, explicitly-justified extension beyond the
literal "generic Lucide icon" premise in the original task brief (which doesn't match
`Header.tsx`'s actual current content — its only Lucide icons, `LogOut`/`Circle`, are functional,
not brand marks). Same white-chip `Image fill` + `object-contain` pattern as `FE-012`, smaller
(`h-6 w-6`), positioned near where the hamburger trigger will land (`FE-016`).

**⚠️ Merge-conflict risk**: `Header.tsx` is also touched by `FE-016` in this pack (wiring in
`MobileNavTrigger`) — land this task first, per the phase-level sequencing note above.

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/Header.tsx` (MODIFY) — `h-6 w-6` white-chip logo mark added, same pattern as `FE-012`.
- [ ] Wrapping `div` is `relative`.
- [ ] Manual check at <768px: logo mark visible in the mobile header even with the drawer closed.
- [ ] Manual check: no layout shift or overlap with the existing "Admin Portal" label / user pill on wider viewports.

**Estimated Complexity**: Low — reuses the pattern established in `FE-012`.

---

### FE-014 · Add `onNavigate` prop + `aria-label` to `Sidebar.tsx`
**Category**: Frontend
**Phase**: 3
**Dependencies**: FE-012 (same-file sequencing)

**Description**: Enables the mobile drawer to close itself the instant a nav link is tapped,
without introducing this codebase's first `useEffect` (the established Client Component convention
here is `useState`-only). A backward-compatible optional callback prop achieves this with zero
behavior change for the existing desktop `<Sidebar />` call site.

**Technical Notes**: Per TDD Section 1 and "Alternatives Considered" (which explicitly rejects a
`usePathname()` + `useEffect` close-on-route-change approach for this exact consistency reason).
`export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {})`; each `<Link>`'s
`onClick={() => onNavigate?.()}`. Also add `aria-label="Admin navigation"` to the `<nav>` element —
the accessibility audit found zero `aria-*` attributes anywhere in admin/dashboard/layout code, and
this pack should not add a second UI surface with the same gap.

**Definition of Done**:
- [ ] `Sidebar.tsx` (MODIFY) — signature changed to accept optional `onNavigate`; each `<Link>`'s `onClick` invokes it.
- [ ] `<nav>` element gains `aria-label="Admin navigation"`.
- [ ] `AdminLayout.tsx`'s existing `<Sidebar />` call site requires **zero** changes (re-verified after this edit — `onNavigate` is `undefined`, `onClick` is a no-op there).
- [ ] TypeScript compiles cleanly with the new optional prop.

**Estimated Complexity**: Low — a two-line prop addition plus one `aria-label`, explicitly designed to be backward-compatible.

---

### FE-015 · Create `MobileNavTrigger.tsx` drawer component
**Category**: Frontend
**Phase**: 3
**Dependencies**: VERIFY-001, FE-014

**Description**: The new client component that owns the mobile nav drawer's open/closed state and
renders the hamburger trigger button plus a `Dialog`-based drawer containing the same `Sidebar`
content as desktop. This is the centerpiece of the mobile-nav item and the most interaction-heavy
new code in this pack.

**Technical Notes**: Per TDD Section 1 — build on the existing `dialog.tsx` (Base UI `Dialog.Root`,
`modal: true` by default) rather than a new `sheet.tsx` primitive, since `Dialog.Root` already
provides focus trap, body-scroll lock, Escape-to-close, and focus management on open/close for
free. `DialogContent`'s `className` overrides position it as a left-edge drawer (`top-0 left-0
h-full w-[280px] max-w-[85vw]`) with `data-open:slide-in-from-left
data-closed:slide-out-to-left` animation (from `tw-animate-css`, already a dependency, confirmed to
support these utility classes) and `zoom-in-100`/`zoom-out-100` as a deliberate no-op to cancel out
the base `DialogContent`'s zoom animation via `tailwind-merge` deduping. `w-[280px] max-w-[85vw]`
means ~280px at 375px viewport width (~75% of screen), deliberately leaving a tappable
dismiss-by-overlay-tap area on the right. Close-button implementation follows whatever `VERIFY-001`
determined (default `DialogContent` behavior if `DialogClose` works; `showCloseButton={false}` +
explicit `onClick` if not). Hamburger button: `aria-label="Open navigation menu"`,
`aria-expanded={open}`, `aria-controls="mobile-admin-nav"`. `DialogTitle` present with `className="sr-only"` for an accessible name (Base UI wires `aria-labelledby` automatically).

**Definition of Done**:
- [ ] `/home/ishola/jar/compENG/sem-8/swe-project-polish-pack/src/components/layout/MobileNavTrigger.tsx` created (CREATE) as a `"use client"` component.
- [ ] `md:hidden` wrapper `div`; hamburger `Button` with `variant="ghost" size="icon-sm"` and the three `aria-*` attributes above.
- [ ] `DialogContent` positions the drawer at the left edge with slide animation, `w-[280px] max-w-[85vw]`.
- [ ] Close-button approach matches `VERIFY-001`'s finding.
- [ ] `<Sidebar onNavigate={() => setOpen(false)} />` rendered inside `DialogContent`.
- [ ] `DialogTitle className="sr-only"` present.
- [ ] Manual check at 375px viewport: hamburger visible, opens drawer in one tap, tapping a nav link both navigates and closes the drawer.

**Estimated Complexity**: Medium — new component with several interacting concerns (animation, a11y, close-button fallback), but the TDD provides near-complete code.

---

### FE-016 · Wire `MobileNavTrigger` into `Header.tsx`
**Category**: Frontend
**Phase**: 3
**Dependencies**: FE-015, FE-013 (same-file sequencing)

**Description**: Mounts the new drawer trigger in the admin header, without converting `Header.tsx`
(currently an `async` Server Component) into a Client Component — a Server Component can render a
Client Component as a normal child without itself needing `"use client"`.

**Technical Notes**: Per TDD Section 1 — `<MobileNavTrigger />` added to `Header.tsx`'s existing
left-side JSX, before the "Admin Portal" label/logo. `AdminLayout.tsx` is **deliberately not
modified** — its existing `<div className="hidden md:block"><Sidebar /></div>` and the new
`MobileNavTrigger`-rendered drawer `Sidebar` are two independent renderings of the same component,
never both mounted-and-visible simultaneously (desktop hidden via CSS `hidden md:block`; mobile
only exists inside a closed-by-default dialog portal).

**Definition of Done**:
- [ ] `Header.tsx` (MODIFY) — `<MobileNavTrigger />` imported and rendered in the left-side flex container, before the existing "Admin Portal" label.
- [ ] `Header.tsx` remains `async` with no `"use client"` directive added.
- [ ] `AdminLayout.tsx` confirmed **unmodified** (re-read after this task to verify).
- [ ] Manual check at ≥768px: hamburger not rendered/visible (`md:hidden` confirmed working); behavior pixel-identical to before this pack.
- [ ] Manual check at <768px: hamburger visible and tappable.

**Estimated Complexity**: Low — a single new child element in an existing Server Component; no boundary-crossing complexity since `Header.tsx` itself doesn't change rendering mode.

---

## Phase 4: Testing & Polish

### TEST-004 · Manual QA checklist verification pass
**Category**: Testing
**Phase**: 4
**Dependencies**: All Phase 2 and Phase 3 tasks

**Description**: The TDD explicitly defers automated component/interaction tests for the mobile
drawer and brand assets (justified trade-off — these are visual/interaction judgments a DOM
assertion wouldn't meaningfully validate) in favor of a structured manual checklist. This task is
that checklist, run once as this pack's final acceptance gate.

**Technical Notes**: Per TDD Testing Strategy's manual QA checklist, verbatim. Also explicitly
includes the interaction edge case the TDD's Edge Cases section flags as *not* covered by the
checklist by default: rapid double-tap of the hamburger, or tapping a nav link mid-slide-in
animation.

**Definition of Done** — all boxes checked and any failures filed as follow-up issues before this
pack is considered ready to merge:
- [ ] At 375px viewport width: hamburger visible, tappable, opens drawer within one tap.
- [ ] Drawer covers ≤ 85% of viewport width, leaving a visibly tappable dismiss area.
- [ ] Tapping a nav link inside the drawer both navigates **and** closes the drawer (single tap).
- [ ] Tapping the dark overlay closes the drawer; pressing `Escape` closes the drawer.
- [ ] Tab key from page load reaches the hamburger button; opening the drawer moves focus inside it; closing returns focus to the hamburger button.
- [ ] The drawer's built-in close (X) button dispatches a click and closes the drawer (per `VERIFY-001`'s finding, whichever implementation path was taken).
- [ ] Body does not scroll behind the open drawer (scroll-lock).
- [ ] Rapid double-tap of the hamburger, or tapping a nav link mid-slide-in-animation, does not crash or produce a stuck-open/stuck-closed state.
- [ ] Above `md` (≥768px): behavior is pixel-identical to before this pack (no hamburger, sidebar always visible).
- [ ] Favicon renders correctly in a browser tab (not the default Next.js icon).
- [ ] "Add to Home Screen" (Android Chrome and, if available, iOS Safari) produces the correct name ("Rosty"), correct icon, and opens directly into the app with no white flash before the dark theme paints.
- [ ] Logo renders cleanly (no stray white edge bleeding into dark chrome) in both the sidebar and the mobile header.
- [ ] Every price on every one of the four currency call sites shows `₦`, not `$` (cross-checked against `TEST-003`'s grep result).

**Estimated Complexity**: Medium — not code, but requires access to a real or emulated mobile device/browser and disciplined, methodical execution across ~13 checks.

---

## Proactively Suggested Tasks

These are not explicitly specified in the PRD/TDD but are recommended based on this pack's domain
(PWA installability, mobile accessibility, currency/i18n). None are blocking — each is a small,
additive extension of an existing task.

### PROACTIVE-001 · Add `appleWebApp` metadata for iOS "Add to Home Screen" polish
**Category**: Frontend
**Phase**: 3 (extends FE-010)
**Dependencies**: FE-010

**Why suggested**: The PRD's Success Metrics explicitly require the installability checklist to be
verified "on at least one real Android and one real iOS device or emulator," but the TDD's
`layout.tsx` code sample only sets `manifest` + `icons` — the Web App Manifest spec is
inconsistently honored by iOS Safari, which instead reads dedicated `<meta
name="apple-mobile-web-app-*">` tags for status bar styling and the home-screen title. Next.js
exposes this natively via the `appleWebApp` field in the `Metadata` object (confirmed present in
`node_modules/next/dist/docs/.../generate-metadata.md`), so this is a same-file, low-effort
addition to `FE-010`, not a new integration.

**Definition of Done**:
- [ ] `metadata.appleWebApp = { title: "Rosty", statusBarStyle: "black-translucent" }` (or equivalent) added to `layout.tsx`'s existing `metadata` export.
- [ ] Manual check on iOS Safari (or an equivalent simulator): "Add to Home Screen" shows "Rosty" as the app title and a dark status bar.

**Estimated Complexity**: Low — one additional metadata field, same file already being edited in `FE-010`.

---

### PROACTIVE-002 · Reconsider hamburger touch-target size vs. accessibility guidelines
**Category**: Frontend
**Phase**: 3 (extends FE-015)
**Dependencies**: FE-015

**Why suggested**: The TDD's `MobileNavTrigger.tsx` code sample uses `size="icon-sm"` on the
hamburger `Button`, which resolves to a 28px (`size-7`) tap target (confirmed via
`src/components/ui/button.tsx`). WCAG 2.5.5 (AAA) and most mobile platform guidelines recommend a
~44px minimum touch target, and the PRD explicitly frames the primary persona as using this UI
"one-handed... mid-shift" — a small tap target directly undercuts that stated goal. This is a
judgment call for the implementer/reviewer, not a silent override of the TDD's exact code.

**Definition of Done**:
- [ ] Decision recorded (in the PR description) on whether to keep `icon-sm` (28px, matches TDD literally) or bump to `icon-lg` (36px, `size-9`) or add extra padding to approximate 44px.
- [ ] If changed, `MobileNavTrigger.tsx`'s `Button` `size` prop updated accordingly with no layout regression against the `w-[280px]` drawer's own dismiss-tap-area math (TDD Section 1's 375px-viewport-correctness note).

**Estimated Complexity**: Low — a single prop value decision, flagged for reviewer judgment rather than pre-decided.

---

### PROACTIVE-003 · Respect `prefers-reduced-motion` for the drawer's slide animation
**Category**: Frontend
**Phase**: 3 (extends FE-015)
**Dependencies**: FE-015

**Why suggested**: The PRD explicitly names accessibility as "a hard requirement" for the mobile
drawer (focus trap, Escape-to-close, screen-reader announcement), and the drawer introduces this
codebase's first slide-in/slide-out CSS animation. A user with `prefers-reduced-motion: reduce` set
should not be forced through the slide animation on every open/close.

**Definition of Done**:
- [ ] Verified whether `tw-animate-css` (already imported globally in `globals.css`) already gates its animations behind `prefers-reduced-motion` by default; if not, add a `motion-reduce:` variant or a plain CSS media query disabling the slide transition for `#mobile-admin-nav`.
- [ ] Manual check: with OS-level "reduce motion" enabled, the drawer still opens/closes correctly (functionally), just without the slide transition.

**Estimated Complexity**: Low — likely a one-line CSS addition or a confirmation that the existing dependency already handles it.

---

## Environment Variables Required

| Variable | Description | Required | Example Value |
|---|---|---|---|
| `NEXT_PUBLIC_CURRENCY` | 3-letter ISO 4217 currency code read by `src/lib/currency.ts`. Must be `NEXT_PUBLIC_`-prefixed since it's read from both Server and Client Components. Defaults to `NGN` if unset or invalid (with a `console.warn` on invalid values). **Changing this requires a rebuild/restart** — Next.js statically inlines `NEXT_PUBLIC_*` vars at build time, it is not read live at request time. | Optional (defaults to NGN) | `NGN` |

All other environment variables used by this pack (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`ADMIN_EMAIL`, etc.) are pre-existing and unaffected — already documented in `.env.example`
(verified present and complete by `INFRA-002`).

---

## Open Questions

All items below are **non-blocking** with a documented default already chosen, per this plan's
instruction to be decisive rather than defer.

1. **TDD Rollout Plan inconsistency — shared files beyond `globals.css`.** The TDD's Rollout Plan
   states "the only shared file is `globals.css`," but its own per-item "Files touched" lists show
   `Sidebar.tsx` and `Header.tsx` are **each** modified by both the mobile-nav item (Section 1) and
   the brand/PWA item (Section 4). **Decision applied in this plan**: sequence the two items' edits
   to those two files (`FE-012`/`FE-013` before `FE-014`/`FE-016`) rather than treating all four
   items as freely parallelizable, and call out the file-level dependency explicitly on the
   affected tasks. This does not change scope or design, only edit ordering.

2. **TDD Section 3 over-claims a change to `src/app/admin/orders/actions.ts`.** The TDD's Section 3
   "Files touched" list includes `MODIFY src/app/admin/orders/actions.ts`, but a direct read of
   that file (and the TDD's own body text, which explicitly says "No change needed to `createOrder`'s
   signature in `actions.ts`") confirms `createOrder` already accepts and persists `dueDate?: Date |
   null` — this is dead-until-now code, not code needing a change. **Decision applied**: no task
   was created against this file for the due-date item; `FE-006` explicitly calls out in its
   Definition of Done that no `actions.ts` change is expected, so an implementer doesn't
   "helpfully" add an unnecessary diff there.

3. **`.env.example` already exists, contradicting the TDD's claim.** The TDD frames this file as
   net-new; it is already present in the worktree (untracked in git) with the exact proposed
   content. **Decision applied**: `INFRA-002` is a verification task, not a creation task.

4. **Base UI `DialogClose` click-dispatch behavior is unverified.** Non-blocking per the TDD — a
   first-hour spike (`VERIFY-001`) with a pre-designed fallback (`showCloseButton={false}` +
   explicit `onClick`) if it turns out broken like the known `DialogTrigger` issue.

5. **"Rostty" (double-t) vs. "Rosty" spelling in the logo/favicon image assets.** A business/content
   decision, not an engineering one — confirmed present in both `rosty-logo.jpeg` and
   `android-chrome-512x512.png`. **Decision applied (per PRD)**: ship the assets as-provided;
   `FE-012`/`FE-013`/`FE-011` do not attempt to regenerate or edit the image content. Flag for the
   business owner's sign-off before this reaches real customers, outside this pack's scope.

6. **Hamburger touch-target size (`icon-sm` = 28px) vs. common ~44px accessibility guidance.**
   Not a TDD defect — the TDD's code is exactly as specified — but worth a reviewer's explicit
   judgment call given the PRD's "one-handed... mid-shift" persona framing. See `PROACTIVE-002`.
   **Decision applied**: ship the TDD's literal `icon-sm` value by default; `PROACTIVE-002` makes
   the trade-off visible for a reviewer to override if desired, rather than silently deciding either way.
