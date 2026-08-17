<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Project: Chop with Rosty

This file provides orientation for AI coding agents (Copilot, Gemini, Claude, Cursor, etc.)
working in this repository. Read this before writing any code.

---

## What This Project Is

**Chop with Rosty** is a full-stack operations management platform built for a real West African
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
| UI Primitives | **Base UI** (`@base-ui-components/react`) + Shadcn | `style: base-nova`, `neutral` base colour |
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
```

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
locations are `createOrder` (deduct) and `updateOrderIngredients` (revert old + apply new).
Never mutate stock outside a transaction.

### Dialog Triggers
`<DialogTrigger render={<Button />}>` from Base UI **does not work** with our `Button` component.
Always use the direct pattern instead:
```tsx
// ✅ Works
<Button onClick={() => setIsOpen(true)}>Open</Button>

// ❌ Silently broken — click events swallowed
<DialogTrigger render={<Button />}>Open</DialogTrigger>
```

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

# 4. Run dev server
npm run dev
# → http://127.0.0.1:3000       (use 127.0.0.1, NOT localhost — cookies are origin-scoped)
# → http://127.0.0.1:54324      (Inbucket — catches magic-link emails locally)
# → http://127.0.0.1:54323      (Supabase Studio)
```

> **Always use `http://127.0.0.1:3000`, not `http://localhost:3000`.** Supabase PKCE cookies are
> scoped to the exact origin — mismatches silently break authentication.
