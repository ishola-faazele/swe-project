# Chop with Rosty — Product Roadmap & Tracking

Living tracking doc for the product evaluation done on 2026-08-17. Source analysis:
`/home/ishola/.claude/plans/no-i-want-you-robust-moore.md` (full audit trail, kept for reference;
this file is the short, update-as-you-go version).

## Status overview

| Phase | What | Branch / worktree | Status |
|---|---|---|---|
| Phase 0 | Order & Inventory Integrity + Auth Hardening | `fix/order-inventory-integrity-hardening` → `../swe-project-integrity-hardening` | ✅ Merged into `main` (`e6f2854`) |
| Phase 1 | Quick-Win Polish Pack + enterprise UI overhaul, two rounds (see below) | `feature/polish-pack` → `../swe-project-polish-pack` | ✅ Merged into `main` — round 1 `d280d7a`, round 2 `28b98a3` |
| Phase 2 | Menu & Recipe System | `feature/menu-recipe-system` → `../swe-project-menu-recipe-system` | ✅ Merged into `main` (`e6f2854`) |
| Phase 3 | Real Customer Notifications (WhatsApp Business Cloud API + Arkesel SMS) | `feature/whatsapp-arkesel-notifications` → `../swe-project-notifications` | 🔄 Implemented, tested, hardened (252 unit / 90 integration tests). **Not yet merged** — held pending webhook verification and template approval. |
| Phase 4 | High Impact, Low Effort (Daily Revenue Snapshot, Quick Shopping List, Top Revenue Dishes, Analytics, Cost Per Plate, Order Calendar) | `feature/phase-456` | ✅ Completed |
| Phase 5 | High Impact, Medium Effort (WhatsApp Notifications, Stock Count Mode, Smart Low-Stock Alerts, Customer Repeat Orders) | `feature/phase-456` | ✅ Completed |
| Phase 6 | Medium Impact, Higher Effort (Offline First, WhatsApp Order Intake, Kitchen Staff Role) | `feature/phase-456` | ✅ Offline First Completed. Others skipped/deferred. |

**Naming note:** the roadmap's original "Phase 3" was the "compounding-features" bucket, now
split into **Phase 4, 5, and 6**. Real WhatsApp/SMS notifications took the Phase 3 slot instead because the
user set up the Meta Business Platform + Arkesel accounts needed for it, making it the natural
next dispatch — see `/home/ishola/.claude/plans/no-i-want-you-robust-moore.md`'s Phase 3 section
for the full plan. If a future session sees "Phase 3" mentioned anywhere outside this file,
verify against this table before trusting it — this is the second phase-numbering correction
here (the first being Phase 1 item 7 informally, and incorrectly, called "Phase 3" mid-project).

**Phase 1, round 2 (merged 2026-08-19, `28b98a3`):** a second coding agent (not this session)
built a further round of Phase 1 work directly on the already-merged `feature/polish-pack`
worktree — customer active/inactive archive toggle (`User.isActive`, unifying `deleteCustomer`
with the existing `Dish`/`InventoryItem` archive-instead-of-erroring pattern), `Order.notes`,
`Dish.servingSize`, a collapsible sidebar, sticky header/sidebar, full Lucide icon replacement,
order sorting/filtering/pagination, and a "Tropical Sunrise" light theme replacing the dark
"enterprise command-center" look. Before merging, this session found and fixed real problems in
that work: the schema migration had never been pushed to the isolated integration-test database
(all 88 integration tests failed until it was); a `prisma.user.create()` call site was missing
the newly-required `name` field (build-breaking); a component imported a type from the wrong
package (`Table` from `@tanstack/react-query` instead of `@tanstack/react-table`); several
`meta as any` casts were replaced with a proper `ColumnMeta` module augmentation
(`src/types/tanstack-table.d.ts`); two legitimate React patterns (next-themes' mounted-guard,
syncing `localStorage` into state) were tripping the React Compiler's `set-state-in-effect` rule
and got justified suppressions instead of being rewritten; and one integration test asserted the
OLD `deleteCustomer` contract (hard-fail on referenced deletes) — confirmed with the user that
the new archive behavior is intentional, updated the test rather than reverting the code.

**Phase 0 and Phase 2 are both on `main` as of commit `e6f2854`.** They were developed in
parallel on independent worktrees and had to be reconciled by hand — both branches modified the
same order-management files (`orders/actions.ts`, `OrderClient.tsx`, `orders/[id]/actions.ts`,
`OrderDetailsClient.tsx`), so `git merge` produced real conflicts rather than an automatic
combination. The merge combined Phase 2's dish-based order creation with Phase 0's
authorization/validation wrapper at every call site, added `requireAdmin()` to `menu/actions.ts`
(which had no authorization at all — it existed only on the Phase 2 branch and never went through
Phase 0's hardening), reconciled two independently-bootstrapped Vitest configs, and relocated
tests that hit a real database out of the unit-test tree. Verified after merging: 139 tests
passing (60 unit/component + 79 integration), lint clean, production build succeeds on all 11
routes.

**Phase 1's scope grew to 7 items** across two rounds of expansion: the original 4
(mobile nav, currency, due-date, brand/PWA) plus a full enterprise UI/design-token overhaul
(user request), plus two items added after the user answered open questions from Phase 0/2's
specs — an order-cancellation confirm dialog, and inventory archive/retire (mirroring the
`Dish.isActive` pattern, with its own schema change and gated `prisma db push`, approved and
completed). **A naming collision worth flagging:** these 7 items were internally numbered 1–7
during Phase 1's own planning, and status updates in this project started calling item 7
"Phase 3" for short — that is NOT the roadmap's actual Phase 3 (compounding features, below),
which has not been started at all. Item-numbers within Phase 1 and roadmap Phase numbers are two
different schemes; don't conflate them.

**Phase 1 current state (as of the last verification run):** all 7 items implemented and
committed on `feature/polish-pack`, 98 unit + 88 integration tests passing (up from the
post-Phase-0/2-merge baseline of 60 + 79), typecheck clean, lint clean, production build
succeeds. Three real bugs were found and fixed during implementation, beyond what any spec
anticipated (see decisions log). **Not yet merged into `main`** — the dedicated `test-engineer`
agent pass across all 7 items has not run yet; that's the one remaining step before this is
merge-ready.

**Next step:** dispatch `test-engineer` for Phase 1's final verification pass, confirm the full
suite/lint/build one more time, then merge `feature/polish-pack` into `main` (same by-hand
conflict-resolution process as Phase 0/2, likely, since both branches touch overlapping files).
Phase 3 (compounding features) has not been started — nothing to report there yet.

---

## 1. Verdict on the project idea

The transactional skeleton (orders, inventory, audit trail) is right-sized for the original
brief and not over-engineered — but it isn't yet trustworthy or usable the way the owner will
actually work, which undermines the one thing she explicitly asked for: **accurate inventory
truth**.

## 2. Where the scope is right (not over- or under-built)

- **No customer self-checkout was built — correct.** The brief describes phone/WhatsApp intake
  with the admin entering orders, not a customer-facing ordering flow. Easy to over-build here;
  the team didn't.
- **No payments, no multi-tenancy — correctly out of scope.** Never asked for.
- **Inventory deduction + `OrderIngredientLog` audit trail is the right instinct** — the one
  piece of "smart" plumbing that maps directly to her stated pain ("track my inventory").

## 3. Where it over-builds

- **Ingredient-level deduction exists without a menu/recipe system to feed it.** Every order
  requires manually re-picking every ingredient and manually typing a price, from scratch, from
  memory — real engineering effort spent on the back half of a workflow (auditable deduction)
  whose front half (ingredient selection) is still 100% manual. For a repeat dish like jollof,
  this is *slower* than a paper notebook. → Phase 2 fixes this.
- **The "enterprise command-center" visual language** (monospace data font, `ONLINE` status pill,
  dark theme) reads like ops-team tooling, not something meant to be glanced at one-handed,
  mid-shift, on a phone. Not disqualifying, but a tone mismatch worth naming.

## 4. Where it under-builds (the real gaps)

- **No menu/recipe system — the single biggest gap.** Nothing links "2 plates of jollof" to a
  predefined ingredient list or price.
- **`dueDate` is tracked but never surfaced as an alert.** For a caterer, "what's due
  today/tomorrow" is operationally critical — missing a delivery is reputational damage in a
  word-of-mouth business. → Phase 1.
- **Currency is hardcoded to `$`** in every price render — visibly embarrassing in front of a
  West African customer. → Phase 1.
- **Admin is effectively unusable on mobile** — sidebar nav just vanishes below the `md`
  breakpoint with no replacement, and she's phone-first. → Phase 1.
- **Notifications are effectively silent for her actual customer base.** Email no-ops without a
  paid Resend key; SMS is a hardcoded stub; login is email-OTP only, no phone/WhatsApp path —
  contradicts the "phone/WhatsApp" framing of the brief. → partially addressed by Phase 1
  (visibility), fully by the not-yet-built WhatsApp-sharing item (roadmap #3 below).
- **Cancelling or deleting an order doesn't restore deducted stock** — a correctness bug in the
  core value proposition (accurate inventory), not a peripheral issue. → Phase 0.
- **Zero authorization** — any authenticated user (or an unauthenticated request that knows a
  Server Action's endpoint) can view or mutate other customers' orders/inventory/customer data.
  → Phase 0.

---

## 5. USP / polish roadmap

| # | Feature | Why it matters to *her* specifically | Effort | Status |
|---|---|---|---|---|
| 1 | Menu & Recipe system (`Dish` + `DishIngredient` models; hybrid structured line-items + freeform notes) | Cuts order entry from "remember every ingredient, retype a price" to two taps; makes the existing deduction/audit machinery finally pay for itself | Large | ✅ Merged into `main` (Phase 2) |
| 2 | Mobile-responsive admin nav (drawer/hamburger below `md`) | She'll use this one-handed, on her phone, mid-shift — currently impossible | Small | ✅ Done on `feature/polish-pack`, pending merge |
| 3 | WhatsApp-native order sharing (`/o/[token]` read-only page + `wa.me` share button) | Solves "nobody actually gets notified" for free, on the channel she already uses; must use a non-guessable token, not the raw sequential `shortId`, or customers could enumerate each other's orders | Small–Medium | ⬜ Not started |
| 4 | Due-date/overdue alerting (dashboard widget + row highlighting) | Zero schema change — `dueDate` already exists. Prevents the most reputation-damaging failure mode (missed delivery) | Small | ✅ Done on `feature/polish-pack`, pending merge |
| 5 | Currency localization (`Intl.NumberFormat` + env-configured currency) | Trust signal — showing dollars to a West African customer looks unfinished | Small | ✅ Done on `feature/polish-pack`, pending merge (NGN/₦) |
| 6 | "Repeat this order" button | Catering customers reorder "the usual" often; compounds with #1 | Small (after #1) | ⬜ Not started |
| 7 | Stock-aware "what can I fulfill right now" | Prevents her from promising a dish she can't make; depends on #1 | Medium | ⬜ Not started |
| 8 | Weekly snapshot (revenue vs. last week, top dish, restock forecast) | Three honest numbers, not a BI dashboard | Medium | ⬜ Not started |
| 9 | Search/filter/date-range on admin tables | Cheap, not urgent until order volume grows | Small–Medium | ⬜ Not started |
| 10 | Real SMS provider (e.g. Africa's Talking) | Costs money per message; only worth it if WhatsApp-link (#3) proves insufficient | Medium | ⬜ Not started |
| 11 | Wire up the already-present brand assets + PWA "Add to Home Screen" | Assets already exist in `public/`; a home-screen icon matters a lot to a non-technical daily user | Small | ✅ Done on `feature/polish-pack`, pending merge |
| 12 | Enterprise-grade UI/design-token overhaul (added mid-stream, user request) | Original visual language read as "AI-ish"/ops-tooling, not something built for one-handed daily phone use; establishes a real token system in `globals.css` instead of hardcoded inline colors | Large | ✅ Done on `feature/polish-pack`, pending merge |
| 13 | Order-cancellation confirm dialog (added — answer to open question 1) | Prevents the misclick scenario un-cancel support would have existed to fix, without reopening the stock-integrity complexity Phase 0 closed | Small | ✅ Done on `feature/polish-pack`, pending merge |
| 14 | Inventory archive/retire (added — answer to open question 2) | Mirrors the proven `Dish.isActive` pattern; lets the owner retire an ingredient she no longer stocks without losing historical order/recipe records | Small–Medium | ✅ Done on `feature/polish-pack`, pending merge (own schema change, `isActive` — approved and pushed to dev + isolated test DBs) |

Also bundled into **Phase 0** (integrity/security, not a "USP" but a prerequisite): Server Action
authorization on every admin action, restored role gate in `admin/layout.tsx`, stock restoration
on order cancel/delete, race-safe stock decrement, basic input validation/error handling.

## 6. Recommended sequencing

1. **Phase 0 — Foundation hardening (non-negotiable, do before anything else is trusted):**
   authz in every Server Action, restore role gate, restore stock on cancel/delete, race-safe
   decrement, input validation on the riskiest actions. Everything else inherits wrong data or
   an open access hole until this lands.
2. **Phase 1 — Quick wins (small effort, high daily-use impact):** mobile nav, currency
   localization, due-date/overdue surfacing, brand asset + PWA wiring.
3. **Phase 2 — Core value driver (the actual USP, ideally built on Phase 0's stable foundation):**
   Menu/Recipe system, paired eventually with WhatsApp-native order sharing.
4. **Phase 4 — High Impact, Low Effort:** Daily Revenue Snapshot, Quick Reorder Shopping List, "Which Dish Brings the Most Revenue?" Report, Curated Analytics Dashboard, Cost Per Plate Calculator, and Order Calendar View.
5. **Phase 5 — High Impact, Medium Effort:** Stock Count Mode + Variance Tracker, Smart Low-Stock Alerts with Context, and Customer Repeat Orders. Also involves tying in the Phase 3 WhatsApp notifications.
6. **Phase 6 — Medium Impact, Higher Effort:** WhatsApp Order Intake, Kitchen Staff Role, and Offline First architecture.

## 7. Decisions log

- **2026-08-19** — Evaluated 20 potential USPs against the reality of a small West African catering business. Kept/modified 6, deferred 8, skipped 5, and proposed 8 new practical USPs (e.g., Daily Revenue Snapshot, Customizable Shopping List, Order Calendar View). Reorganized the remaining roadmap into Phases 4, 5, and 6 based on Impact vs Effort.
- **2026-08-19** — Implemented and completed Phases 4, 5, and 6 on a single unified branch. Features included Daily Revenue Snapshot, Order Calendar, low-stock contextual alerts, repeat orders, WhatsApp "Share Receipt" via `wa.me`, and a fully resilient "Offline First" architecture. 
- **2026-08-19** — Resolved a Next.js 16 build/dev incompatibility with the newly added Service Worker library (`@serwist/next`). Serwist relies on Webpack, while Next.js 16 defaults to Turbopack. To fix `next dev` crashing, Serwist was configured to disable itself fully in `development` mode (`disable: process.env.NODE_ENV === "development"`). The production build script was updated to explicitly use Webpack (`next build --webpack`), enabling the service worker to generate correctly without Turbopack interference.
- **2026-08-17** — User chose to build Phase 2 (Menu & Recipe System) before Phase 0, against
  the PM recommendation, as an explicit accepted tradeoff (not an oversight).
- **2026-08-17** — User then chose to run Phase 0 and Phase 1 in parallel with the already
  in-flight Phase 2, each on its own sibling worktree branched from `main`.
- **2026-08-17** — Worktree base for Phase 2 required committing pre-existing uncommitted WIP
  (dark theme/branding/docs, unrelated to any feature) to `main` first — done as commit
  `15f9b08`. Phase 0 and Phase 1 branch from that same clean commit.
- **2026-08-17** — Test framework: none existed in the repo. User chose to bootstrap a full
  Vitest suite (unit/integration/component layers) rather than scope down to core-logic-only
  tests. All three parallel branches are expected to add Vitest config independently; reconcile
  duplicate config on merge.
- **2026-08-17** — Both Phase 2 and Phase 0 pipelines were interrupted multiple times by Claude
  API session-limit errors (and once by an explicit user stop). Each time, work already on disk
  (commits, written-but-uncommitted files) survived and was resumed rather than redone — no work
  was lost across any of the interruptions. Final verification: Phase 2 = 7 test files / 66 tests
  passing; Phase 0 = 14 test files / 73 tests passing (19 unit + 54 integration against an
  isolated `rosty_integrity_test` database, kept separate from Phase 2's shared dev database to
  avoid schema/data collisions between the two concurrently-developed branches).
- **2026-08-17** — Local Supabase Docker stack was trimmed to only the 4 services this app's code
  actually depends on (`db`, `auth`, `kong`, `inbucket`) after it was found consuming ~2.15GB of
  RAM. Disabled (unused by any code path, verified by grep): `analytics` (675MB, pure stack
  telemetry), `studio` + `pg-meta` (415MB combined, dev convenience — use `npx prisma studio`
  instead), `realtime` (269MB, no `.channel()`/realtime usage anywhere), `storage` (230MB, no
  file storage anywhere), `edge_runtime` (23MB, no `supabase/functions/` dir exists). Stopped the
  running containers immediately (no disruption to the two live pipelines, which only need
  db/auth/kong) and disabled them in `supabase/config.toml` so they stay off on the next
  `supabase start`. New baseline: ~320MB, an 85% reduction.
- **2026-08-17** — User asked to merge Phase 0 and Phase 2 into `main` so both could be tested
  manually together. Merged Phase 0 first (clean, no conflicts — it never touched
  `prisma/schema.prisma`), then Phase 2 (real conflicts on every order-management file both
  branches had modified). Resolved by hand: combined Phase 2's dish-based order logic with Phase
  0's `requireAdmin()`/`ActionResult`/validation wrapper at each call site; discovered and fixed
  a gap the merge would otherwise have silently reintroduced — `src/app/admin/menu/actions.ts`
  (Dish CRUD) existed only on the Phase 2 branch and had zero authorization, since Phase 0 never
  knew that file existed to harden it. Also reconciled two independently-bootstrapped Vitest
  configs and relocated 3 test files that hit a real database out of the unit-test tree (Phase
  0's unit config deliberately poisons `DATABASE_URL` to guarantee unit tests never touch a
  database — those 3 files were integration tests mislabeled as unit tests). Final state on
  `main` (`e6f2854`): 139 tests passing, lint clean, production build succeeds on all 11 routes.
- **2026-08-17** — Phase 1's worktree was rebased onto the newly-merged `main` (clean, docs-only
  diff, no conflicts) so it builds on the combined Phase 0 + Phase 2 foundation. Its scope was
  then expanded on user request to include a full enterprise-grade UI/visual design overhaul
  (explicitly: not a generic "AI-ish" look) across the admin portal, using the `/frontend-design`
  and `/web-design-guidelines` skills, delivered alongside the original 4 functional items rather
  than as a separate pass.
- **2026-08-17** — Found and fixed an unrelated, real login bug while testing the merged `main`
  manually: magic-link sign-in failed with "PKCE code verifier not found in storage" on retry.
  Root cause, reproduced end-to-end with a scripted browser session — `auth/callback/route.ts`
  built its post-login redirect from `new URL(request.url).origin`, which this Next.js dev server
  resolves to `http://localhost:3000` even when the actual request came in on
  `http://127.0.0.1:3000`. The login itself succeeded, but the redirect dropped the session onto
  the wrong origin, looking logged-out; retrying from there set a new PKCE cookie on the wrong
  origin too, breaking the *next* attempt. Fixed by building the redirect from
  `NEXT_PUBLIC_SITE_URL` (already used elsewhere in the same flow) instead of re-deriving it.
  Committed directly to `main` as `ddc40e9`, verified working with a fresh scripted login.
- **2026-08-17** — User answered three open questions surfaced by Phase 0/2's specs, folded into
  Phase 1's scope as items 13–14 above (item "un-cancel" was answered "no, don't build it" — see
  roadmap items 13's confirm-dialog compromise instead): (1) cancelled orders stay terminal, no
  un-cancel — user asked for a recommendation, agreed with keeping stock-integrity logic
  untouched and adding a confirm-before-cancel guard instead; (2) inventory archive/retire —
  approved as new scope; (3) brand name is "Rostty" (double-t) — the image assets already had it
  right, the app *text* was wrong everywhere (9 occurrences across 6 files, plus README/AGENTS.md/
  `.env.example` fixed directly on `main`). While fixing item 3's doc occurrences, discovered
  `.env.example` had never actually been tracked in git at all — the blanket `.env*` gitignore
  rule silently excluded the template file itself. Fixed with a `!.env.example` exception,
  committed as `e692724`.
- **2026-08-17 → 2026-08-18** — Phase 1 implementation (all 7 items) proceeded through repeated
  Claude API session-limit interruptions and one further scope-confirmation pause (a tool-use
  rejection inside the subagent's own session required genuine user re-approval before it would
  re-attempt the same call — correctly refused to treat a peer agent's instruction as equivalent
  to user consent). Each interruption was resumed from on-disk state, no work lost. Three real
  bugs were found and fixed during implementation that no spec had anticipated: an `Intl.
  NumberFormat`-accepts-invalid-currency-codes gap in the currency validator; a stale non-null-
  assertion (`.find(...)!`) that became unsafe once inventory items could be archived/filtered
  out, in two separate call sites; and a `useReactTable` referential-stability bug that made the
  new archive/restore/delete buttons silently drop clicks in real use (not caught by one test
  method but caught by another, which was the tell). Final state on `feature/polish-pack`: 98
  unit + 88 integration tests passing, typecheck clean, lint clean, build succeeds. Not yet
  merged — `test-engineer`'s dedicated final pass has not run yet.
