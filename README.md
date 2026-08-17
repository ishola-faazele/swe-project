# 🍲 Chop with Rostty

> **A full-stack web application designed for modern West African food business management.**  
> Streamlining customer orders, inventory tracking, role-based portals, and transactional notifications in one unified platform.

---

## 🌟 Overview

**Chop with Rostty** is a modern management system crafted specifically for West African catering and food businesses. It empowers business owners with real-time order tracking, precise inventory control with automated stock deduction, magic-link customer authentication, and instant email notifications for order status updates.

---

## ✨ Features

### 🔒 Authentication & Authorization
- **Magic Link Authentication**: Passwordless login via Supabase Auth for seamless user onboarding.
- **Role-Based Access Control (RBAC)**: Distinct access levels for **CUSTOMERS** and **ADMINS**.
- **Automated Admin Assignment**: Dynamic role assignment based on `ADMIN_EMAIL` and `ADMIN_PHONE` environment configuration.

### 👑 Admin Portal
- **Order Management Hub**: View, filter, and manage customer orders across all lifecycle states.
- **State Transition Controls**: Advance order status smoothly (`PENDING` ➔ `PREPPING` ➔ `COOKING` ➔ `READY` ➔ `COMPLETED`).
- **Cancellation & Inventory Reversion**: Cancel orders with automatic inventory restoration.
- **Stock Alert Dashboard**: Real-time notifications for ingredients or packaging falling below safety thresholds.

### 🛒 Customer Portal
- **Interactive Menu & Ordering**: Simple interface for customers to select items, specify custom notes, and place orders.
- **Live Order Tracking**: Real-time status updates on active orders from preparation to pickup/delivery.
- **Order History**: Personal order archives with order short IDs and status receipts.

### 📦 Inventory & Ingredient Log
- **Multi-Category Tracking**: Categorized inventory support (`INGREDIENT`, `DRINK`, `PACKAGING`, `OTHER`).
- **Low-Stock Safety Alerts**: Automated flags when item stock reaches or drops below minimum thresholds.
- **Order Ingredient Audit Trail**: Detailed `OrderIngredientLog` records tracking exact quantities deducted per order.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose / Details |
| :--- | :--- | :--- |
| **Framework** | [Next.js 16 App Router](https://nextjs.org/) | Server Components, Turbopack, API Routes |
| **Language** | [TypeScript](https://www.typescriptlang.org/) | End-to-end static type safety |
| **Database** | [PostgreSQL](https://www.postgresql.org/) | Relational database hosted via Supabase |
| **ORM** | [Prisma ORM](https://www.prisma.io/) | Type-safe query building, migrations, and seeding |
| **Auth** | [Supabase Auth](https://supabase.com/auth) | Magic link passwordless email authentication |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) | Modern utility-first CSS framework |
| **UI Components** | [Shadcn UI](https://ui.shadcn.com/) / [Base UI](https://base-ui.com/) | Accessible component primitives and icons |
| **Data Tables** | [TanStack Table v8](https://tanstack.com/table) | Performant, headless tables for order/inventory lists |
| **Email Service** | [Resend](https://resend.com/) | Transactional email notifications for status changes |
| **Local Tooling** | [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker | Local PostgreSQL, Auth engine, & Inbucket webmail server |

---

## 🏗️ Architecture Diagram

```mermaid
graph TD
    subgraph Client ["Client Layer"]
        B[User Browser / Device]
    end

    subgraph AppServer ["Next.js 16 Application Server"]
        AppRouter[App Router / Server Actions]
        AuthMiddleware[Role-Based Auth Middleware]
        PrismaClient[Prisma ORM Client]
    end

    subgraph BackendServices ["Backend & External Services"]
        SupaAuth[Supabase Auth Engine]
        PostgresDB[(PostgreSQL Database)]
        ResendAPI[Resend Email Service]
        Inbucket[Local Inbucket Mail Server]
    end

    B <-->|HTTP / HTML / JS| AppRouter
    AppRouter <--> AuthMiddleware
    AuthMiddleware <-->|Verify Session| SupaAuth
    AppRouter <-->|Type-safe Queries| PrismaClient
    PrismaClient <-->|SQL Connection| PostgresDB
    AppRouter -->|Send Notifications| ResendAPI
    AppRouter -.->|Intercept Dev Emails| Inbucket
```

---

## 🔄 Order Lifecycle State Machine

An order progresses through a structured pipeline. Orders can be cancelled from any active state prior to completion, which automatically triggers inventory reversion.

```mermaid
stateDiagram-v2
    [*] --> PENDING : Order Placed
    PENDING --> PREPPING : Admin Accepts & Preps Ingredients
    PREPPING --> COOKING : Kitchen Begins Cooking
    COOKING --> READY : Food Packaged & Ready
    READY --> COMPLETED : Order Delivered / Picked Up
    COMPLETED --> [*]

    PENDING --> CANCELLED : Cancel Order
    PREPPING --> CANCELLED : Cancel Order (Reverts Stock)
    COOKING --> CANCELLED : Cancel Order (Reverts Stock)
    READY --> CANCELLED : Cancel Order (Reverts Stock)
    CANCELLED --> [*]
```

---

## 💻 Local Development Setup

Follow these step-by-step instructions to get **Chop with Rostty** running locally.

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher
- **Docker Desktop**: Required to run local Supabase services
- **Supabase CLI**: Installed globally or executed via `npx`

### 2. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/your-username/swe-project.git
cd swe-project

# Install npm packages
npm install
```

### 3. Environment Configuration
Copy the `.env.example` template to create your local `.env` file:
```bash
cp .env.example .env
```

### 4. Start Local Supabase Stack
Start local PostgreSQL, Supabase Auth, and Inbucket email testing server via Docker:
```bash
# Using npm script shortcut
npm run supabase:start

# Or directly via Supabase CLI
npx supabase start
```

### 5. Push Database Schema
Sync your Prisma schema with the local PostgreSQL database:
```bash
npx prisma db push
```

### 6. Seed Initial Database Data
Populate the database with sample inventory items, demo users, and test orders:
```bash
npx prisma db seed
```

### 7. Launch Development Server
Start the Next.js development server powered by Turbopack:
```bash
npm run dev
```

### 8. Access the Application & Tools
- 🌐 **Web Application**: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- 📬 **Inbucket Email Interceptor**: [http://127.0.0.1:54324](http://127.0.0.1:54324) *(Intercepts magic login links and customer notification emails locally)*
- 🛠️ **Supabase Studio**: [http://127.0.0.1:54323](http://127.0.0.1:54323)

---

## 🔑 Environment Variables Reference

| Variable | Description | Required | Default / Example |
| :--- | :--- | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the Supabase API instance | **Yes** | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable anonymous key | **Yes** | *(Generated by Supabase CLI)* |
| `DATABASE_URL` | PostgreSQL connection pooled URL (Transaction mode) | **Yes** | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `DIRECT_URL` | PostgreSQL direct connection URL (Session mode) | **Yes** | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `RESEND_API_KEY` | API Key for Resend email notifications | No | `re_123456789` |
| `FROM_EMAIL` | Sender address for outgoing transactional emails | No | `Chop with Rostty <orders@yourdomain.com>` |
| `ADMIN_EMAIL` | Email address automatically assigned `ADMIN` role | **Yes** | `admin@chopwithrostty.com` |
| `ADMIN_PHONE` | Phone number automatically assigned `ADMIN` role | No | `+2348000000000` |
| `ADMIN_ALERT_EMAIL` | Recipient email for automated low-stock notifications | No | `admin@chopwithrostty.com` |
| `NEXT_PUBLIC_SITE_URL` | Application root URL (used for Auth redirects) | **Yes** | `http://127.0.0.1:3000` |

---

## 📁 Project Structure

```
swe-project/
├── prisma/
│   └── schema.prisma        # Database schema definitions (User, Order, Inventory, Log)
├── public/                  # Static assets and brand imagery
├── src/
│   ├── app/
│   │   ├── admin/           # Admin portal (Orders dashboard, Inventory management)
│   │   ├── auth/            # Auth callback & session handling routes
│   │   ├── dashboard/       # Customer portal & active order views
│   │   ├── login/           # Magic-link passwordless login page
│   │   ├── globals.css      # Tailwind v4 styles & theme design tokens
│   │   ├── layout.tsx       # Root layout wrapper with providers
│   │   └── page.tsx         # Public landing & showcase page
│   ├── components/
│   │   ├── layout/          # Navbar, Footer, & Sidebar navigation
│   │   ├── ui/              # Reusable Base UI / Shadcn primitives
│   │   └── providers.tsx    # TanStack Query & React state context providers
│   ├── lib/
│   │   ├── notifications/   # Email trigger routines via Resend API
│   │   ├── prisma.ts        # Singleton Prisma client instance
│   │   └── utils.ts         # Utility helpers (cn, formatting)
│   └── proxy.ts             # Route proxy handlers
├── supabase/
│   └── config.toml          # Supabase CLI local configuration
├── .env.example             # Template environment configuration file
├── package.json             # Package manifests and script definitions
└── README.md                # Project documentation
```

---

## 📜 Available NPM Scripts

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts Next.js development server with Turbopack fast refresh |
| `npm run build` | Compiles and builds the production bundle |
| `npm run start` | Boots up the production build server |
| `npm run lint` | Executes ESLint to check for code quality and style issues |
| `npm run supabase:start` | Spins up local Docker containers for Supabase PostgreSQL & Auth |
| `npm run supabase:stop` | Stops local Supabase Docker containers |

---

## 🚀 Future Roadmap

- 💬 **WhatsApp Business API Integration (Meta)**: Real-time WhatsApp notifications for order confirmation and dispatch alerts directly to customer phones.
- 📊 **Analytics & Revenue Dashboard**: Interactive visual reports tracking top-selling dishes, daily revenue, and ingredient consumption trends.
- 📋 **Dynamic Recipe & Menu Management**: Ability for admins to define ingredient quantities per dish for automatic inventory deductions upon ordering.
- 🎁 **Customer Loyalty & Rewards System**: Point accumulation per order, granting discounts on future West African feast orders.

---

## 📄 License

This project is released under the [MIT License](LICENSE).

---

<p align="center">
  Crafted with ❤️ for <b>Chop with Rostty</b>
</p>
