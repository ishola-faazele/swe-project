# Chop with Rosty — Product Roadmap & Tracking

Living tracking doc for the product evaluation done on 2026-08-17. Source analysis:
`/home/ishola/.claude/plans/no-i-want-you-robust-moore.md` (full audit trail, kept for reference;
this file is the short, update-as-you-go version).

## Status overview

| Phase | What | Branch / worktree | Status |
|---|---|---|---|
| Phase 0 | Order & Inventory Integrity + Auth Hardening | `fix/order-inventory-integrity-hardening` → `../swe-project-integrity-hardening` | ✅ Merged into `main` (`e6f2854`) |
| Phase 1 | Quick-Win Polish Pack + enterprise UI overhaul (mobile nav, currency, due-date alerts, brand assets, full visual design pass via `/frontend-design` + `/web-design-guidelines`) | `feature/polish-pack` → `../swe-project-polish-pack` | 🔄 In progress — rebased onto merged `main`, scope expanded 2026-08-17 |
| Phase 2 | Menu & Recipe System | `feature/menu-recipe-system` → `../swe-project-menu-recipe-system` | ✅ Merged into `main` (`e6f2854`) |
| Phase 3 | Compounding features (repeat-order, stock-aware fulfillment, weekly snapshot, table search, real SMS) | — | ⬜ Not started |

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
routes. Phase 1 was then rebased onto this merged `main` so it builds on the same combined
foundation, and its scope was expanded on user request to include a full enterprise-grade UI
overhaul (not just the original 4 functional items) using the `/frontend-design` and
`/web-design-guidelines` skills.

**Next step:** review both branches, decide merge order (Phase 0 first is recommended — see
above), and either merge directly or open PRs. Phase 1 remains paused; resume it explicitly when
ready, following the same crash-resume pattern documented in the decisions log below.

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
| 2 | Mobile-responsive admin nav (drawer/hamburger below `md`) | She'll use this one-handed, on her phone, mid-shift — currently impossible | Small | 🔄 In progress (Phase 1) |
| 3 | WhatsApp-native order sharing (`/o/[token]` read-only page + `wa.me` share button) | Solves "nobody actually gets notified" for free, on the channel she already uses; must use a non-guessable token, not the raw sequential `shortId`, or customers could enumerate each other's orders | Small–Medium | ⬜ Not started |
| 4 | Due-date/overdue alerting (dashboard widget + row highlighting) | Zero schema change — `dueDate` already exists. Prevents the most reputation-damaging failure mode (missed delivery) | Small | 🔄 In progress (Phase 1) |
| 5 | Currency localization (`Intl.NumberFormat` + env-configured currency) | Trust signal — showing dollars to a West African customer looks unfinished | Small | 🔄 In progress (Phase 1) |
| 6 | "Repeat this order" button | Catering customers reorder "the usual" often; compounds with #1 | Small (after #1) | ⬜ Not started |
| 7 | Stock-aware "what can I fulfill right now" | Prevents her from promising a dish she can't make; depends on #1 | Medium | ⬜ Not started |
| 8 | Weekly snapshot (revenue vs. last week, top dish, restock forecast) | Three honest numbers, not a BI dashboard | Medium | ⬜ Not started |
| 9 | Search/filter/date-range on admin tables | Cheap, not urgent until order volume grows | Small–Medium | ⬜ Not started |
| 10 | Real SMS provider (e.g. Africa's Talking) | Costs money per message; only worth it if WhatsApp-link (#3) proves insufficient | Medium | ⬜ Not started |
| 11 | Wire up the already-present brand assets + PWA "Add to Home Screen" | Assets already exist in `public/`; a home-screen icon matters a lot to a non-technical daily user | Small | 🔄 In progress (Phase 1) |

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
4. **Phase 3 — Compounding, once Phase 2 lands:** repeat-order, stock-aware fulfillment check,
   weekly snapshot, table search/filter, real SMS if the WhatsApp-link approach proves
   insufficient.

## 7. Decisions log

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
