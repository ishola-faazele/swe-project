# TDD/RFC: Phone-OTP Login, Unified Account Notifications, and a Settings Page

## Status
Draft

## Context & Motivation
This branch (`feature/whatsapp-arkesel-notifications`) already contains a complete, live-verified
notifications feature: WhatsApp Business Cloud API + Arkesel SMS for order-status changes and
low-stock alerts (252 unit tests / 90 integration tests / 0 lint errors at branch tip `451121c`,
clean tree). **None of that transport logic is being redesigned here.** This TDD specifies a scope
expansion layered on top of it, per the locked decisions in
`/home/ishola/.claude/plans/no-i-want-you-robust-moore.md` ("Phase 3 expansion"):

1. Phone-number OTP login, self-managed at the application layer (Arkesel is not one of Supabase
   Auth's supported native SMS providers — confirmed via `supabase/config.toml`'s closed provider
   list — so Supabase's native phone-OTP pipeline is not an option).
2. A single Supabase Auth identity mechanism for every user, phone-only customers included, via a
   synthetic placeholder email — so the app never needs a second, parallel session system.
3. Account-creation notifications that tell a new customer how to log in.
4. An admin Settings page that moves the three notification providers' credentials out of `.env`
   into the database, with independent per-channel and per-login-method toggles.

Today, two incomplete, independently-drifting Prisma-sync implementations exist
(`src/app/auth/callback/route.ts`, `src/app/page.tsx`), both keyed only on email — a phone-only
sign-in would be silently dropped by the first and only partially handled by the second. Both must
be unified before phone-OTP can safely coexist with email login without creating duplicate
accounts. This unification is treated as a **prerequisite fix**, not scope creep — the plan
explicitly calls this out and this TDD agrees.

## Proposed Design

### Ground-truth constraints this design is built against (verified live, not assumed)
These are treated as binding facts, not design choices up for reconsideration:

- **`generateLink`'s `verification_type` is not constant.** Calling
  `admin.auth.admin.generateLink({ type: 'magiclink', email })` for an `authEmail` that has no
  Supabase Auth identity yet returns HTTP 200, **auto-creates** the identity, and reports
  `properties.verification_type: "signup"`. A *second* call for the same, now-existing identity
  reports `"magiclink"`. Redeeming a `"signup"`-type link via `verifyOtp({ type: 'magiclink' })`
  fails with HTTP 403. **The code must always redeem using the `verification_type` the same
  `generateLink` call returned — never a hard-coded literal.** This is not an edge case to handle
  defensively; it is the *normal* path for every phone-only customer's first login, this feature's
  highest-value scenario.
- **Two different Supabase clients are required.** `generateLink` needs a service-role client
  (`@supabase/supabase-js`'s plain `createClient`, no cookies, server-only). `verifyOtp` must run
  on the existing cookie-writing SSR client (`src/utils/supabase/server.ts`) — that is what
  actually writes the session cookies the browser needs. Calling `verifyOtp` on the service-role
  client mints a session nobody receives.
- **`User.authEmail` must be nullable.** The plan's own text is self-contradictory here ("always
  set" vs. a backfill design that requires a null state to backfill into). Resolved:
  `authEmail String? @unique` — Postgres permits multiple `NULL`s under a `UNIQUE` constraint, so
  this is a real, valid schema, and it's the only shape consistent with the backfill design.
- **`getCurrentDbUser()`'s resolution order must become `id → authEmail → email`.** For a
  phone-only user, `authUser.email` (from Supabase) *is* the synthetic address — it must never be
  compared against `User.email` (the real contact column), which is the entire point of keeping
  the two columns separate. Skipping the `authEmail` step means a phone-only user with any `id`
  divergence resolves to `null` and gets treated as unauthenticated.

### New/changed Prisma models
```prisma
model User {
  id                   String        @id @default(uuid())
  shortId              Int           @unique @default(autoincrement())
  name                 String?
  email                String?       @unique   // unchanged: real, display/contact info only
  phone                String?       @unique
  authEmail            String?       @unique   // NEW — the email Supabase Auth actually uses as
                                                // this row's identity key. Nullable (see above).
                                                // Equals `email` for email-first customers; a
                                                // generated synthetic placeholder for phone-only
                                                // ones. NEVER rendered/exported/notified — see
                                                // Security Considerations.
  preferredLoginMethod LoginMethod   @default(EMAIL) // NEW
  role                 Role          @default(CUSTOMER)
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt

  orders               Order[]
}

enum LoginMethod {   // NEW
  EMAIL
  PHONE
}

model OtpCode {       // NEW
  id         String    @id @default(uuid())
  phone      String    // E.164, output of the existing toGhanaE164()
  codeHash   String    // HMAC-SHA256(code, OTP_HASH_SECRET) — never plaintext
  expiresAt  DateTime
  attempts   Int       @default(0)
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([phone, createdAt])
}

model NotificationSettings {  // NEW — application-level singleton, see "Singleton pattern" below
  id                          String   @id @default(uuid())
  resendApiKey                String?
  fromEmail                   String?
  arkeselApiKey                String?
  arkeselSenderId              String?
  whatsappAccessToken          String?
  whatsappPhoneNumberId        String?
  whatsappAppSecret            String?
  whatsappWebhookVerifyToken   String?
  whatsappTemplateName         String?  // e.g. "order_status_update" — moved from env, see below
  whatsappLowStockTemplateName String?  // e.g. "low_stock_alert"
  whatsappTemplateLanguage     String?  // e.g. "en"
  emailEnabled                 Boolean  @default(true)
  smsEnabled                   Boolean  @default(true)
  whatsappEnabled              Boolean  @default(true)
  updatedAt                    DateTime @updatedAt
}

model LoginSettings {  // NEW — separate singleton table, deliberately not merged with
                        // NotificationSettings (explicit "keep login separate from alerts"
                        // requirement)
  id                 String   @id @default(uuid())
  emailLoginEnabled  Boolean  @default(true)
  phoneLoginEnabled  Boolean  @default(false)  // opt-in on purpose — see Rollout Plan
  updatedAt          DateTime @updatedAt
}
```

**Which env vars move to `NotificationSettings`, and why exactly these:** grep-verified read
sites, not a guess — `sms.ts:34-35`, `email.ts:6,11,24,79`,
`whatsapp.ts:47-48,60,63,114-115,131-132`, `api/webhooks/whatsapp/route.ts:29,47`. That list
includes the WhatsApp **template names and language**, not just the bearer-token-style secrets —
those are genuinely per-provider configuration an admin should be able to change without a deploy
(e.g. if a template gets rejected and resubmitted under a new name). `WHATSAPP_API_VERSION` is
**not** in that list and stays an env var / in-code default — it's an infrastructure/API-surface
concern, not a provider credential, and nothing in the grep evidence calls for moving it.

**Singleton pattern — deliberately application-level, not DB-enforced.** Every other model in
this schema uses `id String @id @default(uuid())`; introducing a DB-enforced singleton (e.g. a
fixed-literal `Int @id @default(1)` primary key) would be a novel pattern this schema doesn't use
anywhere else. Instead, `getNotificationSettings()`/`getLoginSettings()` do a `findFirst()` and
`create()`-if-absent. The narrow race on the very first read (two concurrent requests both finding
no row) is accepted the same way this codebase already accepts the `deleteCustomer`
count-then-delete TOCTOU gap — a single-admin tool, low request volume, self-healing after the
first successful create. See Alternatives Considered.

### API Changes (Server Actions — this app has no REST/tRPC layer; every mutation is a `"use server"` function)

| Action | File | Auth | Notes |
|---|---|---|---|
| `requestPhoneOtp(phone: string)` | `src/app/login/actions.ts` | **Public** (pre-auth, by design) | Rate-limited per phone; returns `ActionResult<void>` |
| `verifyPhoneOtp(phone: string, code: string)` | `src/app/login/actions.ts` | **Public** (pre-auth, by design) | Returns `ActionResult<{ redirectTo: string }>` |
| `updateNotificationSettings(data)` | `src/app/admin/settings/actions.ts` | `requireAdmin()` | Blank secret field = keep stored value |
| `updateLoginSettings(data)` | `src/app/admin/settings/actions.ts` | `requireAdmin()` | |
| `getSettings()` | `src/app/admin/settings/actions.ts` | `requireAdmin()` | Returns the **masked** shape (see Security) |

`requestPhoneOtp`/`verifyPhoneOtp` are intentionally **not** `requireAdmin()`-gated — they're the
pre-authentication login flow, same trust boundary as today's `login()` action in the same file.
Both must still independently check `LoginSettings`/`NotificationSettings` server-side (not just
hide the UI), because every Server Action in this app is an independently-POST-able endpoint — the
same reasoning the Phase 0 hardening RFC already established for the admin actions applies here to
the public ones.

### Database Changes
This project uses Prisma **schema-push** (`npx prisma db push`), not migration files — there are
zero migration files in this repo by design, and that convention is unchanged here. The Prisma
schema blocks above are the actual "migration." Per the locked decision that the DB may be freely
reset, no data-preserving migration/backfill script is written; existing rows simply get `NULL`
for `authEmail` (matches the nullable design) and the schema-level default `EMAIL` for
`preferredLoginMethod` (harmless — see Domain & Service Layer for why the column default is a safe
fallback and not the real source of truth for actual writes).

**Required rollout step, not optional:** `vitest.integration.config.mts` explicitly forbids
scripting `prisma db push`/`db seed` into any test run and requires a **manual, human-approved**
push against the isolated `rosty_integrity_test` database specifically (never the shared
`postgres` database, which other worktrees may depend on). This expansion adds new models, so that
manual push is a genuine, required setup step before any integration test in this area can pass —
call it out explicitly in the implementation plan, don't let it get silently skipped.

### Domain & Service Layer

#### `src/lib/auth.ts` — identity resolution (the prerequisite fix + the new phone path)

```ts
// Shared by both syncPrismaUser (email path) and resolveCustomerForPhoneLogin (phone path) —
// a single admin-check implementation instead of a third independently-drifting copy.
function isAdminIdentity(candidate: { email?: string | null; phone?: string | null }): boolean {
  return Boolean(
    (process.env.ADMIN_EMAIL && candidate.email === process.env.ADMIN_EMAIL) ||
    (process.env.ADMIN_PHONE && candidate.phone === process.env.ADMIN_PHONE)
  )
}

/**
 * THE prerequisite fix. Replaces auth/callback/route.ts's email-only, `if (user?.email)`-guarded
 * sync block AND page.tsx's separate `OR:[{email},{phone}]` block with one implementation both
 * call. Resolution order: id (already-synced row) → authEmail (repeat login, exact identity
 * match) → real email/phone (an admin-created customer's row already exists with real contact
 * info but no authEmail yet — first login backfills authEmail onto THAT row instead of creating
 * a duplicate).
 */
export async function syncPrismaUser(authUser: {
  id: string
  email?: string | null   // may be a REAL email (this is the email-login path only)
  phone?: string | null
}): Promise<User> {
  let dbUser = await prisma.user.findUnique({ where: { id: authUser.id } })

  if (!dbUser && authUser.email) {
    dbUser = await prisma.user.findUnique({ where: { authEmail: authUser.email } })
  }
  if (!dbUser) {
    dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          ...(authUser.email ? [{ email: authUser.email }] : []),
          ...(authUser.phone ? [{ phone: authUser.phone }] : []),
        ],
      },
    })
  }

  const isAdmin = isAdminIdentity(authUser)

  if (dbUser) {
    const needsAuthEmailBackfill = !dbUser.authEmail && Boolean(authUser.email)
    const needsPromotion = isAdmin && dbUser.role !== 'ADMIN'
    if (needsAuthEmailBackfill || needsPromotion) {
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          ...(needsAuthEmailBackfill ? { authEmail: authUser.email } : {}),
          ...(needsPromotion ? { role: 'ADMIN' as const } : {}),
        },
      })
    }
    return dbUser
  }

  // Brand-new self-service signup — mirrors today's existing auto-create-on-first-login
  // behavior for email, unchanged in shape.
  return prisma.user.create({
    data: {
      id: authUser.id,
      email: authUser.email ?? null,
      authEmail: authUser.email ?? null,
      phone: authUser.phone ?? null,
      role: isAdmin ? 'ADMIN' : 'CUSTOMER',
    },
  })
}

const SYNTHETIC_EMAIL_DOMAIN = 'internal.chopwithrostty.app'
function syntheticEmailForPhone(phone: string) {
  return `phone-${phone}@${SYNTHETIC_EMAIL_DOMAIN}`
}

/**
 * Phone-OTP counterpart to syncPrismaUser — deliberately a SEPARATE function, not a branch
 * inside syncPrismaUser. Reason: this runs BEFORE any Supabase Auth identity exists for a
 * phone-only customer (we must decide the authEmail value first, then ask Supabase to create the
 * identity around it), whereas syncPrismaUser runs AFTER Supabase already has an identity
 * (email magic-link flow, where authUser.email is always genuinely real). Merging them would
 * force syncPrismaUser to guess whether an incoming email is "real" or one it invented itself —
 * fragile domain-suffix pattern-matching. Two small functions with simple, distinct
 * preconditions beats one function with a hidden mode flag.
 */
export async function resolveCustomerForPhoneLogin(
  phone: string
): Promise<{ user: User; authEmail: string }> {
  let user = await prisma.user.findUnique({ where: { phone } })
  const isAdmin = isAdminIdentity({ phone })

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone,
        authEmail: syntheticEmailForPhone(phone),
        preferredLoginMethod: 'PHONE',
        role: isAdmin ? 'ADMIN' : 'CUSTOMER',
      },
    })
    return { user, authEmail: user.authEmail! }
  }

  const needsAuthEmailBackfill = !user.authEmail
  const needsPromotion = isAdmin && user.role !== 'ADMIN'
  if (needsAuthEmailBackfill || needsPromotion) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(needsAuthEmailBackfill ? { authEmail: syntheticEmailForPhone(phone) } : {}),
        ...(needsPromotion ? { role: 'ADMIN' as const } : {}),
      },
    })
  }
  return { user, authEmail: user.authEmail! }
}

/**
 * Mints a real Supabase session for `authEmail` and redeems it on the cookie-writing SSR client
 * — used ONLY by the phone-OTP path (email magic-link customers already get a session through
 * Supabase's own signInWithOtp + exchangeCodeForSession flow).
 *
 * See "Ground-truth constraints" above: `type` for verifyOtp is NEVER a literal — always the
 * `verification_type` the same generateLink call returned. Hard-coding 'magiclink' works for
 * every returning customer and fails on exactly one path: a phone-only customer's very FIRST
 * login (Supabase reports "signup" that one time). That is this feature's highest-value path,
 * and a unit test mocking generateLink's response would never catch the mistake — it only
 * surfaces against the real Admin API.
 */
export async function mintSessionForAuthEmail(authEmail: string): Promise<void> {
  const admin = createAdminClient() // src/utils/supabase/admin.ts — service-role, no cookies
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: authEmail })
  if (error || !data?.properties) {
    throw new AuthError('Could not start a session. Please try again.')
  }

  const supabase = await createClient() // the EXISTING cookie-writing SSR client
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: data.properties.verification_type, // <-- read back, never hard-coded
  })
  if (verifyError) {
    throw new AuthError('Could not start a session. Please try again.')
  }
}
```

`getCurrentDbUser()` changes to:
```ts
export async function getCurrentDbUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const byId = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (byId) return byId

  if (authUser.email) {
    const byAuthEmail = await prisma.user.findUnique({ where: { authEmail: authUser.email } })
    if (byAuthEmail) return byAuthEmail
    // Preserves the ORIGINAL pre-existing-row fallback this function already documented before
    // this change (see the long comment already in this file) — kept as the last resort, not
    // removed, even though for a phone-only session authUser.email is synthetic and this branch
    // is effectively dead for that case by design (the synthetic address never matches a real
    // `email` column value).
    return prisma.user.findUnique({ where: { email: authUser.email } })
  }
  return null
}
```

`src/app/auth/callback/route.ts` and `src/app/page.tsx` both replace their inline sync blocks with
a single call: `const dbUser = await syncPrismaUser({ id: user.id, email: user.email, phone: user.phone })`.

#### `src/utils/supabase/admin.ts` (new)
```ts
import { createClient } from '@supabase/supabase-js'

// SERVER-ONLY. Bypasses RLS entirely. Never import this from a "use client" file, never expose
// the key via NEXT_PUBLIC_. Separate module from utils/supabase/{client,server,session}.ts on
// purpose — those three all wrap SSR/browser cookie handling; this one deliberately has none.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

#### `src/lib/otp.ts` (new) — pure hashing + constants, mirrors `src/lib/phone.ts`'s "no Prisma, no next/*" convention where possible
```ts
import crypto from 'node:crypto'

export const OTP_LENGTH = 6
export const OTP_EXPIRY_MS = 10 * 60 * 1000       // 10 minutes
export const OTP_COOLDOWN_MS = 60 * 1000          // 1 request per phone per 60s
export const MAX_OTP_ATTEMPTS = 5                 // matches this codebase's existing
                                                   // sanity-ceiling style (see
                                                   // MAX_INGREDIENT_LINES in validation.ts)

export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

export function hashOtpCode(code: string): string {
  const secret = process.env.OTP_HASH_SECRET
  if (!secret) throw new Error('OTP_HASH_SECRET is not configured')
  return crypto.createHmac('sha256', secret).update(code).digest('hex')
}

// Timing-safe compare — same crypto.timingSafeEqual pattern already established in
// src/app/api/webhooks/whatsapp/route.ts for its HMAC signature check, including the
// length-check-before-compare guard (timingSafeEqual throws on mismatched buffer lengths).
export function verifyOtpCodeHash(code: string, storedHash: string): boolean {
  const expected = Buffer.from(hashOtpCode(code), 'hex')
  const actual = Buffer.from(storedHash, 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
```

#### `src/app/login/actions.ts` — the two new Server Actions
```ts
export async function requestPhoneOtp(rawPhone: string): Promise<ActionResult<void>> {
  const [loginSettings, notifSettings] = await Promise.all([getLoginSettings(), getNotificationSettings()])
  if (!loginSettings.phoneLoginEnabled || !notifSettings.smsEnabled || !notifSettings.arkeselApiKey) {
    return { ok: false, error: 'Phone login is not available right now.', code: 'VALIDATION' }
  }

  const phone = toGhanaE164(rawPhone)
  if (!phone) return { ok: false, error: 'Enter a valid Ghanaian phone number.', code: 'VALIDATION' }

  const recent = await prisma.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } })
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_COOLDOWN_MS) {
    return { ok: false, error: 'Please wait a minute before requesting another code.', code: 'VALIDATION' }
  }

  const code = generateOtpCode()
  await prisma.otpCode.create({
    data: { phone, codeHash: hashOtpCode(code), expiresAt: new Date(Date.now() + OTP_EXPIRY_MS) },
  })

  const result = await sendSms({
    to: phone,
    message: `Your Chop with Rostty login code is ${code}. It expires in 10 minutes.`,
  })
  if (!result.success) {
    return { ok: false, error: 'Could not send the login code. Please try again.', code: 'UNKNOWN' }
  }
  return okResult(undefined)
}

export async function verifyPhoneOtp(rawPhone: string, code: string): Promise<ActionResult<{ redirectTo: string }>> {
  const [loginSettings, notifSettings] = await Promise.all([getLoginSettings(), getNotificationSettings()])
  if (!loginSettings.phoneLoginEnabled || !notifSettings.smsEnabled || !notifSettings.arkeselApiKey) {
    return { ok: false, error: 'Phone login is not available right now.', code: 'VALIDATION' }
  }

  const phone = toGhanaE164(rawPhone)
  if (!phone) return { ok: false, error: 'Enter a valid Ghanaian phone number.', code: 'VALIDATION' }

  const candidate = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!candidate) {
    return { ok: false, error: 'Code expired or not found. Request a new one.', code: 'NOT_FOUND' }
  }

  // Race-safe attempt guard — same updateMany-with-conditional-WHERE pattern already established
  // for race-safe stock decrement (tx.inventoryItem.updateMany + count===0 check): a plain
  // findFirst-then-update has a TOCTOU gap two concurrent verify calls could both slip through.
  const guarded = await prisma.otpCode.updateMany({
    where: { id: candidate.id, attempts: { lt: MAX_OTP_ATTEMPTS }, consumedAt: null },
    data: { attempts: { increment: 1 } },
  })
  if (guarded.count === 0) {
    return { ok: false, error: 'Too many incorrect attempts. Request a new code.', code: 'VALIDATION' }
  }

  if (!verifyOtpCodeHash(code, candidate.codeHash)) {
    return { ok: false, error: 'Incorrect code.', code: 'VALIDATION' }
  }

  await prisma.otpCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } })

  try {
    const { user, authEmail } = await resolveCustomerForPhoneLogin(phone)
    await mintSessionForAuthEmail(authEmail)
    return okResult({ redirectTo: user.role === 'ADMIN' ? '/admin' : '/dashboard' })
  } catch (err) {
    return toErrorResult(err, 'Could not start a session. Please try again.')
  }
}
```

#### `src/lib/settings.ts` (new) — the DB-backed accessor
```ts
export async function getNotificationSettings() {
  const existing = await prisma.notificationSettings.findFirst()
  if (existing) return existing
  return prisma.notificationSettings.create({ data: {} })
}

export async function getLoginSettings() {
  const existing = await prisma.loginSettings.findFirst()
  if (existing) return existing
  return prisma.loginSettings.create({ data: {} })
}

// Never returns raw secret values — only whether each is set. Non-secret configuration fields
// (fromEmail, arkeselSenderId, template name/language, the enabled flags) round-trip in full,
// since they aren't sensitive and an admin needs to see/edit them directly.
export async function getMaskedNotificationSettings() {
  const s = await getNotificationSettings()
  return {
    fromEmail: s.fromEmail,
    arkeselSenderId: s.arkeselSenderId,
    whatsappTemplateName: s.whatsappTemplateName,
    whatsappLowStockTemplateName: s.whatsappLowStockTemplateName,
    whatsappTemplateLanguage: s.whatsappTemplateLanguage,
    emailEnabled: s.emailEnabled,
    smsEnabled: s.smsEnabled,
    whatsappEnabled: s.whatsappEnabled,
    resendApiKeySet: Boolean(s.resendApiKey),
    arkeselApiKeySet: Boolean(s.arkeselApiKey),
    whatsappAccessTokenSet: Boolean(s.whatsappAccessToken),
    whatsappAppSecretSet: Boolean(s.whatsappAppSecret),
    whatsappWebhookVerifyTokenSet: Boolean(s.whatsappWebhookVerifyToken),
  }
}
```

#### Sender module refactor — preserve the exact no-op contract, change only *where* the check reads from
`sms.ts`'s transport logic (the Arkesel v1 `fetch` call, query-string construction, response
mapping) is **untouched**. Only its configuration read changes:
```ts
// BEFORE
const apiKey = process.env.ARKESEL_API_KEY
const senderId = process.env.ARKESEL_SENDER_ID
if (!apiKey || !senderId) { ... return { success: false, reason: 'sms_not_configured' } }

// AFTER
const settings = await getNotificationSettings()
if (!settings.smsEnabled) {
  return { success: false, reason: 'sms_disabled' }         // NEW distinct reason
}
const apiKey = settings.arkeselApiKey
const senderId = settings.arkeselSenderId
if (!apiKey || !senderId) {
  return { success: false, reason: 'sms_not_configured' }   // unchanged reason, DB-sourced now
}
```
The same shape applies to `whatsapp.ts`'s two senders and the webhook route's two secret reads.
"Configured" and "enabled" stay two **independent** checks throughout, mirroring the plan's
instruction exactly — a channel can have valid credentials but be toggled off, or be toggled on
with no credentials yet, and each produces a distinct no-op reason.

**A real bug this refactor must fix, not just carry forward:** `email.ts` currently caches its
Resend client in a module-scope singleton, constructed once from `process.env.RESEND_API_KEY` on
first use (`_resend`). Once the API key can change at runtime (via the Settings UI, no redeploy),
that cache would silently keep using a stale/rotated-away key until the process restarts. Fix:
drop the singleton, construct a fresh `Resend(apiKey)` per call — the SDK's client construction is
cheap (no network call), so there's no meaningful performance cost.

#### Account-creation notification — **EMAIL + SMS only, no WhatsApp**
**Scope correction locked in by the user after initial drafting:** the account-creation
notification fans out to email and SMS only. `sendAccountCreatedWhatsApp` and any new generic
WhatsApp entry point are **out of scope entirely** — not deferred, not "future," withdrawn. The
reasoning: WhatsApp Business Cloud API requires a pre-approved Meta template for every
business-initiated message, and the user does not want this feature blocked behind a third
template review (`order_status_update` and `low_stock_alert` are already pending approval).
Email and SMS both send free-form text immediately, with no approval step, so they carry this
notification alone.

**This does NOT touch the existing order-status/low-stock WhatsApp notifications.**
`sendOrderStatusWhatsApp`/`sendLowStockWhatsApp` and their two templates are unaffected — still
pending Meta approval, still fired from `notifyOrderStatusChange`/`notifyLowStock` exactly as
today. `src/lib/notifications/whatsapp.ts` is touched by this expansion **only** for the
`process.env` → `getNotificationSettings()` accessor refactor described above — no new function is
added to it, and none of its existing exports change shape. Do not read "no WhatsApp for
account-creation" as "WhatsApp templates are no longer needed" anywhere downstream — they're still
needed for the two notification types this branch already ships.

`sms.ts`'s `sendSms` is already a generic entry point, so account-creation SMS needs no new
transport code. New in `email.ts`: `sendAccountCreatedEmail({ to, name, magicLink })`. New in
`src/lib/notifications/index.ts`:
```ts
export async function notifyAccountCreated(data: {
  customerName?: string
  customerEmail?: string | null
  customerPhone?: string | null
  preferredLoginMethod: 'EMAIL' | 'PHONE'
  magicLink?: string | null   // only meaningful when preferredLoginMethod === 'EMAIL'
}) {
  const results: {
    email?: Awaited<ReturnType<typeof sendAccountCreatedEmail>>
    sms?: Awaited<ReturnType<typeof sendSms>>
  } = {}

  // EMAIL-preferred: the magic-link email only — a phone send would be redundant and this
  // customer's phone may not even be on file.
  if (data.preferredLoginMethod === 'EMAIL' && data.customerEmail && data.magicLink) {
    results.email = await sendAccountCreatedEmail({
      to: data.customerEmail, name: data.customerName, magicLink: data.magicLink,
    })
  }

  // PHONE-preferred: SMS only (no WhatsApp — see above). Single-channel, so no
  // Promise.allSettled pair is needed here the way notifyOrderStatusChange's SMS+WhatsApp pair
  // needs one — but the shape (independently gated on the contact method existing, fire-and-
  // forget, never throws) still follows notifyOrderStatusChange's established convention.
  if (data.preferredLoginMethod === 'PHONE' && data.customerPhone) {
    results.sms = await sendSms({
      to: data.customerPhone,
      message: `Welcome to Chop with Rostty! Visit our login page and enter your phone number to receive a login code.`,
    })
  }

  // Neither branch fires if the matching contact field is absent (the name-only-customer case,
  // or a phone-preferred customer whose phone somehow isn't set) — a clean no-op, not a crash,
  // per createCustomerSchema's "at least one of name/email/phone" refinement already allowing
  // exactly that shape.
  return results
}
```
`createCustomer` (`src/app/admin/customers/actions.ts`) calls this fire-and-forget, same
convention as every other notification call site in this app — never inside the transaction,
never awaited in a way that could block or fail the customer-creation response.

**Consequence worth stating explicitly:** for a phone-preferred customer, SMS is the *only*
delivery channel for this notification (they typically have no email, and WhatsApp is out of
scope per the above). If `NotificationSettings.smsEnabled` is off, or Arkesel isn't configured,
that customer receives **nothing** — `sendSms` no-ops with its existing `sms_disabled`/
`sms_not_configured` reason, logged server-side same as every other no-op in this app, and
`notifyAccountCreated`'s result simply reflects that. This must never surface as an error that
fails `createCustomer` — the fire-and-forget rule (notification failures never roll back or block
a DB write) applies here exactly as it does everywhere else in this app.

**Computing `preferredLoginMethod` at creation time.** The Prisma column default (`EMAIL`) is a
*safe fallback for the name-only-customer edge case only* — it is never the real source of truth
for an actual customer with contact info. `createCustomer` always computes an explicit value:
```ts
const preferredLoginMethod =
  input.preferredLoginMethod ?? (input.email ? 'EMAIL' : input.phone ? 'PHONE' : 'EMAIL')
```
`createCustomerSchema`/`updateCustomerSchema` both gain a refinement rejecting a mismatch (e.g.
explicitly choosing `PHONE` with no phone filled in) — same house style as the existing
`hasAtLeastOneContactMethod` refinement:
```ts
.refine(
  (v) => !v.preferredLoginMethod ||
    (v.preferredLoginMethod === 'EMAIL' ? Boolean(v.email) : Boolean(v.phone)),
  { message: 'Preferred login method must match a contact field that is actually filled in.' }
)
```
`updateCustomerSchema` overwrites all three contact fields on every call (existing, unchanged
behavior) — this refinement is what stops an edit from silently leaving `preferredLoginMethod`
pointing at a channel the edit just blanked out.

### Frontend Changes
- **`src/app/login/page.tsx`** (modify) — becomes settings-aware: fetches `LoginSettings` +
  `NotificationSettings` server-side (already an async Server Component) and conditionally renders
  the Email/Phone tab switcher using the new `src/components/ui/tabs.tsx` wrapper.
- **`src/app/login/PhoneLoginForm.tsx`** (new, `"use client"`) — two-step UI: phone-number input →
  `requestPhoneOtp` → code-entry step using `@base-ui/react/otp-field`'s `OTPField.Root`
  (`length={6}`, `validationType: 'numeric'` default) + `OTPField.Input` slots, wired to
  `verifyPhoneOtp` via `onValueComplete` (auto-submit once all 6 digits are entered — a materially
  better mobile UX than a separate "Verify" tap for a non-technical, one-handed user, and exactly
  what this Base UI primitive is built for).
- **`src/components/ui/switch.tsx`** (new) — thin wrapper around `@base-ui/react/switch`'s
  `Switch.Root`/`Switch.Thumb`, matching `dialog.tsx`'s existing wrapper convention exactly
  (`import { Switch as SwitchPrimitive } from "@base-ui/react/switch"`, `cn()`-merged className,
  `data-slot` attributes).
- **`src/components/ui/tabs.tsx`** (new) — same wrapper convention, around `@base-ui/react/tabs`.
- **`src/app/admin/settings/page.tsx`** (new, Server Component) — `requireAdmin()`, fetches
  `getMaskedNotificationSettings()` + `getLoginSettings()`, passes as `initialData` — matching the
  page.tsx/`*Client.tsx`/actions.ts convention used by every other admin screen.
- **`src/app/admin/settings/SettingsClient.tsx`** (new, `"use client"`) — `Tabs` with two panels
  (Notifications, Login), one card per channel with masked secret `Input`s and a `Switch`, calling
  `updateNotificationSettings`/`updateLoginSettings` and optimistically updating local state, same
  as every other `*Client.tsx` in this app.
- **`src/components/layout/Sidebar.tsx`** (modify) — one new nav entry, `Settings` (lucide icon,
  already a dependency), pointing at `/admin/settings`.
- **`src/app/admin/customers/CustomerClient.tsx`** (modify) — the create/edit dialog gains a
  "Preferred login method" `<select>`, its options filtered to whichever of email/phone are
  currently filled in (mirrors the existing `optionsForRow` re-injection pattern's spirit: never
  offer a choice the current form state can't support).

## Alternatives Considered

1. **Env-var fallback alongside the DB-backed settings accessor** (for local-dev convenience, so a
   freshly-reset dev database doesn't require a Settings-UI trip before any real send can be
   tested). **Rejected.** The plan's own architecture direction is explicit about replacement, and
   a stray lingering env var creating a "why is this still sending after I disabled it in
   Settings" failure mode is worse for a non-technical admin than a slightly slower local dev
   loop. One source of truth, no exceptions, is the more defensible design; the locked "DB may be
   freely reset" decision already accepts that the admin re-enters credentials once, not that dev
   resets must be frictionless.
2. **DB-enforced singleton for `NotificationSettings`/`LoginSettings`** via a fixed-literal integer
   primary key (`id Int @id @default(1)`). **Rejected** in favor of the existing
   `String @id @default(uuid())` + `findFirst()`-then-`create()` convention every other model in
   this schema already uses — introducing a second PK pattern for two tables would be a bigger
   architectural inconsistency than the tiny, self-healing first-read race it would prevent.
3. **Merge `resolveCustomerForPhoneLogin` into `syncPrismaUser`** as a branch, rather than a
   sibling function. **Rejected** — see the code comment above: the phone path must decide
   `authEmail` *before* a Supabase identity exists, the email path only ever runs *after* one
   already does. Forcing one function to serve both timings means it has to guess whether an
   incoming email is real or self-generated, which is strictly more fragile than two small
   functions with distinct, explicit preconditions.
4. **A per-record random salt instead of one global `OTP_HASH_SECRET` HMAC pepper.** Considered —
   per-record salting matters most against rainbow-table attacks across *many* stored password
   hashes; a 6-digit, 10-minute-lived, attempt-capped OTP code has a search space small enough that
   the real defenses are the expiry and the attempt cap, not the hashing scheme. A single pepper is
   simpler to implement correctly and sufficient here; per-record salting is the stronger choice if
   this ever needs to defend a much higher-volume, longer-lived code in the future.

## Edge Cases & Failure Modes
- **Phone number changed via `updateCustomer` after a phone-only login already happened.** The
  existing `authEmail` still encodes the *old* phone number. A login attempt at the new number
  won't match any existing row's `authEmail`, so `resolveCustomerForPhoneLogin` creates a **second**
  `User` row — a silent duplicate account. Not auto-fixed by this design; flagged explicitly as an
  Open Question for the implementation planner (see below) rather than silently assumed away.
- **Concurrent `verifyPhoneOtp` calls with the correct code** (e.g. two browser tabs). The
  attempt-guard `updateMany` prevents the attempt counter from being bypassed, but two concurrent
  calls can both pass it and both successfully mint a session before either commits `consumedAt`.
  Accepted: unlike a payment or a single-use financial token, two valid sessions for the same
  login is harmless, and re-fetching consumedAt inside a full serializable transaction to close
  this gap would add real complexity for no meaningful security benefit here.
- **`requestPhoneOtp`/`verifyPhoneOtp` called directly (bypassing the UI).** Both are public
  Server Actions and independently POST-able — both re-check `LoginSettings`/
  `NotificationSettings` server-side on every call, not just once at page render, closing the gap
  the Phase 0 hardening RFC already identified for admin actions.
- **SMS send fails inside `requestPhoneOtp` after the `OtpCode` row is already created.** The
  action still returns `{ ok: false }` to the caller (so the UI doesn't advance to the code-entry
  step), but the unusable `OtpCode` row is left in the table. Harmless — it simply expires
  normally and is never a valid candidate in `verifyPhoneOtp`'s `consumedAt: null, expiresAt: {gt}`
  filter once past its 10-minute window; no cleanup job is needed for v1.
- **`SUPABASE_SERVICE_ROLE_KEY` missing or rotated in production.** `mintSessionForAuthEmail`'s
  `generateLink` call fails; the error is caught and returned as an `ActionResult` failure by
  `verifyPhoneOtp` (via `toErrorResult`), never an unhandled crash — but this means phone login is
  **entirely broken** without this key. It is a hard external prerequisite, not a soft one — see
  Rollout Plan and the "Business/external prerequisites" list in the handoff.
- **Name-only customer (`createCustomerSchema` legitimately allows this).** `notifyAccountCreated`
  is called with `customerEmail: null, customerPhone: null` — both channel branches no-op cleanly;
  no crash, matching the explicit requirement.
- **Phone-preferred customer with SMS unconfigured or disabled.** Since account-creation
  notifications are email + SMS only (no WhatsApp — see Domain & Service Layer), a phone-preferred
  customer with no email on file has exactly one possible delivery channel. If that channel is off
  or unconfigured, they receive nothing at all. This is a clean, logged no-op (`sendSms`'s existing
  `sms_disabled`/`sms_not_configured` reasons) — never an error, and never something that fails or
  rolls back `createCustomer`, consistent with this app's fire-and-forget notification rule.
- **Settings singleton first-read race** — see Alternatives Considered #2; accepted, self-healing.
- **A customer's `email`/`phone` is cleared via `updateCustomer` while `preferredLoginMethod` still
  points at the now-blank channel.** Rejected at the validation layer by the new refinement above
  — the update itself fails with a clear message, rather than silently leaving an inconsistent
  row.
- **The `action_link` embedded in the account-creation email for email-preferred customers** is
  generated by the same `generateLink` call used elsewhere, but its redemption path (a
  Supabase-hosted verify URL that redirects into this app) has **not** been live-verified the way
  the `token_hash`/`verifyOtp` path has been. This app's existing magic-link flow uses the PKCE
  `code` exchange (`exchangeCodeForSession` in `auth/callback/route.ts`); whether `action_link`'s
  redirect lands there cleanly or needs a small dedicated landing route is unconfirmed. **Flagged
  as an implementation-blocking open question**, not assumed — see below.

## Security Considerations
- **OTP codes are hashed, never stored in plaintext**, via HMAC-SHA256 with a server-only
  `OTP_HASH_SECRET` pepper (new env var). Rotating this secret invalidates every outstanding,
  unexpired code — an acceptable, documented side effect.
- **Per-phone rate limiting** (one `requestPhoneOtp` success per 60 seconds) prevents a single
  abusive or mistaken repeated tap from burning through the business's Arkesel SMS credit balance.
  **Not** IP-based — an attacker rotating through many phone numbers isn't rate-limited by source;
  explicitly out of scope for v1 (see PRD Non-Goals), consistent with this app's overall
  single-business-scale security posture (plain-text Settings secrets, no per-resource ownership
  checks).
- **Attempt cap** (5 per code) plus a short expiry (10 minutes) bound the brute-force search space
  regardless of hashing strength.
- **Generic error messages** — `verifyPhoneOtp` never reports a remaining-attempts count, to avoid
  helping an attacker calibrate.
- **Settings secrets are masked/write-only in the UI**: `getMaskedNotificationSettings()` never
  returns raw secret values to the browser (booleans only); a blank input on save means "keep the
  stored value," never "clear it" — this is a UI/API-shape precaution independent of the
  locked-in decision to store secrets in plain text server-side.
- **`SUPABASE_SERVICE_ROLE_KEY` is the single highest-sensitivity new secret in this expansion** —
  bypasses Row Level Security entirely. `src/utils/supabase/admin.ts` is the only file that may
  read it; it must never be imported into a `"use client"` component or exposed via a
  `NEXT_PUBLIC_` prefix. `.env.example` gets a loud, explicit comment to this effect.
- **Every Settings mutation is `requireAdmin()`-gated**, same as every other admin action in this
  app — no new authorization pattern introduced.
- **The webhook route's fail-closed behavior is preserved exactly** through the refactor — when
  `NotificationSettings.whatsappWebhookVerifyToken`/`whatsappAppSecret` are unset (e.g. before the
  admin has visited Settings post-deploy), `GET`/`POST` continue to reject with 403/503 rather than
  silently accepting unverified requests.
- **`authEmail` must never be displayed, exported, or included in any notification** — it's an
  internal Supabase-identity implementation detail, not contact info. No code path in this design
  reads it outside `src/lib/auth.ts`/`src/utils/supabase/admin.ts`; keep it that way in review.

## Testing Strategy
Follows this project's established, layered pattern (unit vs. integration split already
documented for the existing notifications work).

**Unit** (`vitest.config.mts`, `node` project):
- `src/lib/otp.test.ts` — `generateOtpCode` produces valid-length numeric strings;
  `hashOtpCode`/`verifyOtpCodeHash` round-trip; mismatched-length buffers handled without throwing
  (mirrors the webhook route's existing test coverage for the same `timingSafeEqual` guard).
- `src/lib/auth.test.ts` (extend) — `syncPrismaUser`'s id/authEmail/email resolution order and
  backfill-vs-create branches (mocked Prisma); `resolveCustomerForPhoneLogin`'s
  create/backfill/already-synced branches; `getCurrentDbUser`'s new `authEmail` fallback step.
- `src/lib/settings.test.ts` — singleton get-or-create behavior; masked-settings shape never
  contains a raw secret value.
- `src/app/login/actions.test.ts` — `requestPhoneOtp`: cooldown rejection, invalid-phone
  rejection, disabled/unconfigured rejection; `verifyPhoneOtp`: expired/missing-code rejection,
  attempt-cap rejection, wrong-code rejection, correct-code success path (mocked Prisma, mocked
  `sendSms`, mocked `mintSessionForAuthEmail`).
- `src/lib/notifications/{sms,email,whatsapp}.test.ts` (extend) — the existing env-gated no-op
  tests become settings-gated; add cases proving "configured" and "enabled" are independently
  checked (configured-but-disabled and enabled-but-unconfigured both no-op, with distinct
  `reason` values).
- `src/lib/notifications/index.test.ts` (extend) — `notifyAccountCreated`'s EMAIL-preferred vs.
  PHONE-preferred branching, the name-only-customer no-op case, and the phone-preferred-with-SMS-
  disabled no-op case, mocking `./email`/`./sms` (only the two channels this function actually
  calls — `./whatsapp` is untouched by `notifyAccountCreated` and needs no mock here).

**Integration** (`vitest.integration.config.mts`, against `rosty_integrity_test`, **after** the
manual schema push described above):
- `tests/integration/phone-login.integration.test.ts` (new) — `OtpCode` lifecycle against the real
  isolated DB (create → rate-limit rejection → attempt-cap rejection → expiry) and
  `resolveCustomerForPhoneLogin`'s create/backfill behavior against real `User` rows.
  `mintSessionForAuthEmail`/the Supabase Admin client boundary is **mocked** here — hitting a real
  (even local) Supabase Auth Admin API isn't something today's integration harness depends on for
  any existing test (it only guards `DATABASE_URL`), and adding that dependency is a larger
  infrastructure change than this feature needs. The `generateLink`/`verifyOtp` handshake itself
  is covered by the live probe already performed during this spec's research, plus a manual QA
  step at rollout (see below) — not by CI.
- `tests/integration/customers-actions.integration.test.ts` (extend) — `createCustomer` fires
  `notifyAccountCreated` with the correct data shape, asserting the call-site *contract* against a
  still-mocked `notifications` module (same split this project already uses for order-status
  notifications: fan-out logic is a unit-test concern, call-site wiring is an integration-test
  concern).
- `tests/integration/settings-actions.integration.test.ts` (new) — `requireAdmin()` gating on both
  Settings actions; a blank secret field on update does not clobber a previously stored value;
  singleton get-or-create behavior against the real DB.

**Manual QA** (mirrors how the existing WhatsApp/Arkesel work was verified before merge): one real
end-to-end phone-OTP login against local Supabase (confirming the `generateLink`/`verifyOtp`
handshake works exactly as probed during this spec's research), and one real account-creation SMS.
No WhatsApp QA step for account creation — that channel isn't part of this notification (see
Domain & Service Layer). The two pre-existing WhatsApp templates' own QA (order-status, low-stock)
is unaffected and unchanged by this expansion.

## Rollout Plan
**⚠️ This ships a real, immediate behavior change on deploy day: every customer notification
(order-status email/SMS/WhatsApp, low-stock alerts — not just this expansion's new ones) goes
silent the moment this deploys, because `NotificationSettings` starts empty per the locked "no
auto-migration" decision.** This is not a soft risk — it is the loudest operational item in this
entire expansion and must be scheduled with the business owner's availability in mind, not treated
as a routine deploy.

Deployment sequence:
1. `prisma generate` + `npx prisma db push` against the local/dev database.
2. **Manual, human-approved** `npx prisma db push` against the isolated `rosty_integrity_test`
   database specifically (per `vitest.integration.config.mts`'s existing hard constraint) —
   required before any integration test in this area can pass.
3. Deploy the code.
4. **Immediately** (same session, not "later"): the admin logs into `/admin/settings` and
   re-enters Resend/Arkesel/WhatsApp credentials, confirming each channel's toggle is on.
5. Only after confirming a real test SMS arrives does the admin enable `phoneLoginEnabled` in the
   Login tab — it defaults to `false` specifically so email-only login remains the default,
   unaffected behavior until the admin has verified SMS delivery works end-to-end post-deploy.

**Rollback:** every schema change here is purely additive (new nullable columns, new tables,
nothing removed or renamed). Reverting the code deploy is sufficient — no schema rollback step is
needed, since old code simply ignores the new columns/tables and nothing depends on their absence.

## Open Questions

**(a) Business / external prerequisites — the user must action these, not engineering:**
- **`SUPABASE_SERVICE_ROLE_KEY` for production** must be supplied by the owner from their
  Supabase project's API settings. The value already present in this worktree's local `.env` is
  Supabase's well-known local-demo key (identical on every machine, safe to share) — it is **not**
  usable in production.
- The manual `rosty_integrity_test` schema push (deployment step 2 above) needs a human to run it
  — this must not be scripted into any automated pipeline per the existing test-harness
  constraint.
- The rollout-day credential re-entry (deployment step 4) needs the business owner's availability
  at or immediately after deploy, given the notification-silence window described in Rollout Plan.

**(b) Anything that would block the implementation planner:**
- **One genuine open question, flagged explicitly rather than assumed:** the redemption path for
  the `action_link` embedded in the email-preferred account-creation email has not been
  live-verified against this app's specific PKCE-configured magic-link flow (see Edge Cases). The
  implementation plan should include an early spike — generate one real link via `generateLink`
  and confirm it round-trips through the existing `/auth/callback` route cleanly — **before**
  building the full account-creation email template around it. If it doesn't round-trip cleanly,
  the fallback is a small dedicated landing route that reads `token_hash`/`type` as query params
  and calls the same `verifyOtp` pattern `mintSessionForAuthEmail` already uses. This is a
  contained, well-understood fallback, not a design gap — it just wasn't part of the ground truth
  this spec was handed, and shouldn't be silently assumed to work.
- Everything else in this design — the schema, the resolution-order logic, the session-minting
  helper, the sender-module refactor, the Settings page shape — is specified concretely enough to
  begin implementation without further clarification.
