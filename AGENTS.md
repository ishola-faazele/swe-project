<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Project: Chop with Rostty

This file provides orientation for AI coding agents (Copilot, Gemini, Claude, Cursor, etc.)
working in this repository. Read this before writing any code.

---

## What This Project Is

**Chop with Rostty** is a full-stack operations management platform built for a real West African
catering business. The business owner receives orders by phone or WhatsApp, cooks the food
in-house, and needs software to:

- **Track a live kitchen order queue** — from initial booking through preparation, cooking, and
  delivery, across six distinct statuses (`PENDING → PREPPING → COOKING → READY → COMPLETED`,
  plus `CANCELLED`).
- **Manage raw-material inventory** — ingredients (rice, palm oil, chicken…), drinks, and
  packaging, with automatic stock deduction when an order is created and stock reversion when
  ingredients are edited.
- **Keep persistent customer records** — name, email, phone, order history, auto-incrementing
  human-friendly `shortId` (e.g. `#12`).
- **Provide a lightweight customer portal** — magic-link login, personal order timeline with
  status badges.
- **Alert the admin** — low-stock warnings on the dashboard; transactional emails (via Resend)
  when order status changes.

This is **not** a SaaS product or a demo — it is production software for a specific small
business. Design decisions reflect that: simple, reliable, and easy for a non-technical owner
to use.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | See "Breaking Changes" below |
| Language | **TypeScript** | Strict mode; `@/*` → `src/*` |
| Database | **PostgreSQL** via Supabase | Local Docker instance for dev |
| ORM | **Prisma** | Schema-push workflow (`db push`, no migrations) |
| Auth | **Supabase Auth** | Magic-link / passwordless only |
| Styling | **Tailwind CSS v4** | Enterprise dark theme; amber/gold accent; Syne + DM Mono fonts |
| UI Primitives | **Base UI** (`@base-ui/react`) + Shadcn | `style: base-nova`, `neutral` base colour |
| Tables | **TanStack Table v8** | Headless; custom `<table>` HTML rendering |
| Email | **Resend** | Omitted locally — falls back to `console.log` |
| Icons | **Lucide React** | |

---

## ⚠️ Breaking Changes vs. Standard Next.js

Key differences you will hit immediately:

1. **No `middleware.ts`** — routing middleware lives in `src/proxy.ts`, exporting a `proxy()`
   function (not `middleware()`). If you are about to create or import `middleware.ts`, stop —
   edit `src/proxy.ts` instead.

2. **`params` and `searchParams` are `Promise`s** — dynamic-route page props must be awaited:
   ```ts
   // ✅ Correct
   export default async function Page(props: { params: Promise<{ id: string }> }) {
     const { id } = await props.params
   }
   // ❌ Wrong — params is NOT a plain object
   export default async function Page({ params }: { params: { id: string } }) {}
   ```

3. **Turbopack is the default bundler** — some webpack-specific plugins are unsupported.

---

## Repository Layout

```
swe-project/
├── prisma/
│   ├── schema.prisma      # Source of truth for DB shape
│   └── seed.ts            # Wipes and repopulates all tables with realistic fixture data
├── src/
│   ├── app/
│   │   ├── admin/         # Admin-only portal (orders, inventory, customers)
│   │   │   ├── orders/
│   │   │   │   ├── page.tsx          # Server Component — fetches + passes initialData
│   │   │   │   ├── OrderClient.tsx   # "use client" — table + create dialog
│   │   │   │   ├── actions.ts        # "use server" — createOrder, updateOrderStatus, deleteOrder
│   │   │   │   └── [id]/             # Full order detail + ingredient editor
│   │   │   ├── inventory/            # Same page / *Client / actions pattern
│   │   │   ├── menu/                 # Dish catalog + recipes — same pattern, no [id] route
│   │   │   └── customers/            # Same page / *Client / actions pattern
│   │   ├── auth/callback/route.ts    # Supabase PKCE callback — creates Prisma User on first login
│   │   ├── dashboard/                # Customer portal (order history)
│   │   ├── login/                    # Magic-link form
│   │   ├── globals.css               # Tailwind v4 tokens + enterprise dark theme
│   │   ├── layout.tsx                # Root layout — Syne + DM Mono fonts, forces dark class
│   │   └── page.tsx                  # Landing page / auth redirect hub
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AdminLayout.tsx       # Sidebar + Header shell
│   │   │   ├── Sidebar.tsx           # Nav with active-route detection
│   │   │   └── Header.tsx            # User pill, online indicator, sign-out
│   │   ├── ui/                       # Shadcn/Base UI primitives (Button, Dialog, Input…)
│   │   └── providers.tsx             # QueryClientProvider (installed but unused)
│   ├── lib/
│   │   ├── prisma.ts                 # Singleton PrismaClient
│   │   ├── recipe.ts                 # PURE recipe/pricing math — no Prisma, no next/*
│   │   ├── notifications/
│   │   │   ├── index.ts              # Fan-out: email + SMS (fire-and-forget)
│   │   │   ├── email.ts              # Resend integration
│   │   │   └── sms.ts               # Stub — logs only, no real provider
│   │   └── utils.ts
│   ├── utils/supabase/
│   │   ├── client.ts                 # Browser Supabase client
│   │   ├── server.ts                 # Server (RSC/Action) Supabase client — cookie-based
│   │   └── session.ts                # Proxy-context Supabase client
│   └── proxy.ts                      # Next.js routing middleware (renamed from middleware.ts)
├── test/                             # Unit-test support — setup.ts, next/cache mock, fixtures
├── tests/integration/                # Integration suite + guard-database-url.ts safety check
├── vitest.config.mts                 # Unit config — `node` + `jsdom` projects
├── vitest.integration.config.mts     # Integration config — isolated rosty_integrity_test DB
├── supabase/config.toml              # Local Supabase CLI config
├── .env                              # Real secrets — never commit
├── .env.example                      # Safe template
├── AGENTS.md                         # ← You are here
├── CLAUDE.md                         # Extended guidance for Claude Code
└── README.md                         # Product overview, setup guide, diagrams
```

---

## Data Model (Quick Reference)

```
User            id (UUID = Supabase auth UUID), shortId (auto-increment), name?, email?, phone?,
                role (ADMIN | CUSTOMER)

InventoryItem   id, name, category (INGREDIENT | DRINK | PACKAGING | OTHER),
                currentStock, minimumThreshold, unit

Order           id, shortId (auto-increment), customerId → User, description, status,
                totalPrice, dueDate?
                status flow: PENDING → PREPPING → COOKING → READY → COMPLETED
                             (CANCELLED reachable from any active state)

OrderIngredientLog  orderId → Order, inventoryItemId → InventoryItem, quantityUsed
                    (audit trail; always written in the same transaction as stock changes)

Dish            id, shortId (auto-increment), name, price, isActive
                the reusable menu catalog; archived (isActive: false) rather than deleted
                whenever an OrderDish row references it

DishIngredient  dishId → Dish, inventoryItemId → InventoryItem, quantityPerDish
                the recipe — how much of an InventoryItem ONE unit of the dish consumes
                @@unique([dishId, inventoryItemId]), so duplicate picks must be summed
                before writing (see mergeDuplicateIngredients in src/lib/recipe.ts)

OrderDish       orderId → Order, dishId → Dish, dishName, unitPrice, quantity
                the order's line items. dishName/unitPrice are SNAPSHOTS taken from the
                Dish row server-side at create/edit time — never re-joined for display,
                so renaming or repricing a dish can't rewrite order history.
```

`OrderDish` and `OrderIngredientLog` are two separate records of truth and neither is derived
from the other at read time: `OrderDish` is what the customer ordered and was charged, while
`OrderIngredientLog` is what the kitchen consumed. Both are written once, together, in the same
transaction. When several dishes share an ingredient, the log gets **one merged row per
`InventoryItem`**, not one per dish. Orders created before this feature simply have `dishes: []`.

The recipe/pricing math (`expandDishesToIngredients`, `computeDishSubtotal`,
`mergeDuplicateIngredients`) lives in `src/lib/recipe.ts` and is deliberately pure — no Prisma,
no `next/*` — so the same functions run inside a server transaction and in the browser for the
live total-price preview. Keep it that way; don't inline that math into a `"use server"` body.

**Always use `shortId` in user-facing strings** (e.g. "Order #42"). Use `id` (UUID) for
URL parameters, relations, and DB lookups.

---

## Patterns to Follow

### Data Fetching & Mutation
- **Server Components (`page.tsx`)** fetch directly with Prisma and pass `initialData` as props.
- **Client Components (`*Client.tsx`)** hold `initialData` in `useState` and optimistically update it.
- **Server Actions (`actions.ts`)** perform the DB write and call `revalidatePath()`.
- **Do not** introduce `useQuery` / `useMutation` — follow the existing Server Action pattern.

### Inventory Mutations
Always use `prisma.$transaction` when touching `InventoryItem.currentStock`. The two canonical
locations are `createOrder` (deduct) and `updateOrderItems` (revert old + apply new).
Never mutate stock outside a transaction. `updateOrderItems` — in
`src/app/admin/orders/[id]/actions.ts` — is the single writer of `OrderIngredientLog`/`OrderDish`
in the edit flow; don't add a second one, or two "delete all and recreate" writers will clobber
each other.

### ⚠️ Dev server: `127.0.0.1` requires `allowedDevOrigins`, or NOTHING is clickable
This app requires `http://127.0.0.1:3000` for local dev (see Auth Flow below — Supabase's PKCE
cookie is scoped to the exact sign-in origin). But Next.js's dev server only trusts `localhost`
for dev-only asset/HMR requests **by default**, so without `allowedDevOrigins: ["127.0.0.1"]` in
`next.config.ts`, every request from `127.0.0.1` — including the HMR WebSocket upgrade — gets
silently blocked as untrusted cross-origin. This Next.js version's dev-mode `hydrate()` call
creates that WebSocket directly, so a blocked handshake takes client-side interactivity down
with it: **no `onClick` handler anywhere fires**, for any component, using any pattern. If you
ever see "nothing on the page responds to clicks" together with
`WebSocket connection to '.../_next/webpack-hmr' failed` in the browser console, this config is
missing or was reverted — that is the fix, not a code change in whatever component you were
about to blame. Verified end-to-end with a scripted browser session: config present → HMR
connects, deletes/dialogs/dropdowns all work; config absent → HMR fails, nothing responds.

This was also the real cause behind an earlier, wrong diagnosis in this file: a "`DialogTrigger`
silently swallows clicks, always use `<Button onClick={...}>` instead" rule that used to live
here. That guidance was incorrect — `DialogTrigger` works fine once `allowedDevOrigins` is set;
it just happened to be the first thing someone clicked while *all* interactivity was broken by
this exact origin-blocking issue, and the wrong conclusion stuck. Both patterns are fine now.
Existing code that already avoids `DialogTrigger` doesn't need to be changed back — it's not
broken, just unnecessary caution — but don't keep telling new code to avoid it.

### TanStack Table — `data` must be referentially stable
Every `*Client.tsx` passes its `useState` array straight into `useReactTable({ data })`, which is
stable across renders by construction. If you ever pass a **derived** array instead — a
`.filter(...)`/`.map(...)` computed in the render body — wrap it in `useMemo`:

```tsx
// ✅ Stable: the table rebuilds its row model only when the inputs actually change.
const visibleData = useMemo(() => data.filter(i => showArchived || i.isActive), [data, showArchived])

// ❌ New array identity every render — the table re-renders continuously and REMOUNTS every row's
// DOM. Row buttons then silently drop clicks, because the node pressed is replaced mid-interaction.
const visibleData = data.filter(i => showArchived || i.isActive)
```
The failure is nasty because it looks like an event-wiring bug, not a memoization one: the handler
is correct and `fireEvent.click` triggers it fine, while real clicks and `userEvent.click` do
nothing. `InventoryClient.tsx`'s `showArchived` filter is the one place this applies today.

### Auth Flow
- Supabase Auth is the identity layer (magic-link, sessions, cookies).
- `src/app/auth/callback/route.ts` creates a Prisma `User` row on first login with the Supabase UUID.
- The app **will not start** without `ADMIN_EMAIL` or `ADMIN_PHONE` set in `.env`.
- Admin layout only verifies a session exists — **role gating is not yet enforced server-side**.

### Notifications
Fire-and-forget only. Notification calls must never block or roll back a DB transaction.
Without `RESEND_API_KEY`, emails fall back to `console.log`.

---

## Known Gaps (Do Not Assume These Work)

| Gap | Reality |
|---|---|
| Order cancellation reverts stock | **Not implemented.** `updateOrderStatus(CANCELLED)` only updates the status field. |
| SMS notifications | **Stub only.** `sms.ts` logs to console; no real provider is connected. |
| Role gating on `/admin/*` | **Not enforced server-side.** Any authenticated user can reach admin routes. |
| WhatsApp alerts | **Planned, not built.** Meta Business API integration is on the roadmap. |

---

## Local Dev Quick Start

```bash
# 1. Start local Supabase (Postgres + Auth + Inbucket mail server)
npm run supabase:start

# 2. Push schema
npx prisma db push

# 3. Seed realistic fixture data (10 customers, 20 inventory items, 15 orders)
npx prisma db seed

# 4. Start MinIO (object storage for dish media + customer photos)
#    Deliberately a SEPARATE lifecycle from Supabase — its own root docker-compose.yml, not
#    managed by the Supabase CLI. Skip it only if you are not touching uploads; without it,
#    presigning still succeeds (it is pure local crypto) and the failure surfaces only at the
#    browser's actual PUT.
npm run minio:up          # npm run minio:down to stop
# → http://127.0.0.1:9000       (S3 API — both the server and the browser hit this)
# → http://127.0.0.1:9001       (MinIO console, minioadmin/minioadmin)

# 5. Run dev server
npm run dev
# → http://127.0.0.1:3000       (use 127.0.0.1, NOT localhost — cookies are origin-scoped)
# → http://127.0.0.1:54324      (Inbucket — catches magic-link emails locally)
# → http://127.0.0.1:54323      (Supabase Studio)
```

> **Always use `http://127.0.0.1:3000`, not `http://localhost:3000`.** Supabase PKCE cookies are
> scoped to the exact origin — mismatches silently break authentication.
