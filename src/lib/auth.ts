import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { prisma } from '@/lib/prisma'
import { toGhanaE164 } from '@/lib/phone'
import { Prisma, Role, type User } from '@prisma/client'
import { redirect } from 'next/navigation'

export class AuthError extends Error {}

/**
 * Shared by both sync paths so there is ONE admin-check implementation rather than the three
 * independently-drifting inline copies this codebase had before (auth/callback/route.ts,
 * page.tsx, and this file).
 *
 * Both phone values are normalized to E.164 before comparing. `ADMIN_PHONE` is set in .env in
 * whatever format a human typed it (e.g. "0200480505"), while every phone value that actually
 * reaches this function — resolveCustomerForPhoneLogin's `phone` param, a Supabase authUser's
 * `.phone` — has already been through toGhanaE164 upstream. A raw string comparison between the
 * two therefore silently NEVER matches unless the env var happens to already be in bare E.164
 * form, which is exactly the bug this fixes: the admin's own phone login was being treated as a
 * brand-new customer because "0200480505" !== "233200480505".
 */
export function isAdminIdentity(candidate: { email?: string | null; phone?: string | null }): boolean {
  const adminPhone = toGhanaE164(process.env.ADMIN_PHONE)
  const candidatePhone = toGhanaE164(candidate.phone)
  return Boolean(
    (process.env.ADMIN_EMAIL && candidate.email === process.env.ADMIN_EMAIL) ||
    (adminPhone && candidatePhone && adminPhone === candidatePhone)
  )
}

const SYNTHETIC_EMAIL_DOMAIN = 'internal.chopwithrostty.app'

/**
 * The placeholder address a phone-only customer's Supabase Auth identity is registered under.
 *
 * Phone-only customers still get a real Supabase session — Arkesel is not one of Supabase Auth's
 * supported native SMS providers, so its own phone-OTP pipeline isn't available to us, and a
 * second parallel session system would be far worse than one synthetic address. This value is
 * internal plumbing: it is never displayed, exported, or sent to anyone.
 */
export function syntheticEmailForPhone(phone: string): string {
  return `phone-${phone}@${SYNTHETIC_EMAIL_DOMAIN}`
}

/**
 * Resolves the Prisma User row for the currently authenticated Supabase session.
 *
 * Resolution order is id → authEmail → email, and each step earns its place:
 *
 * - `id` is the common, correct case for every row created after first login.
 * - `authEmail` is the exact-identity match for a repeat login. It must come BEFORE the real-email
 *   fallback: for a phone-only user, authUser.email IS the synthetic address, and comparing that
 *   against User.email (the real contact column) is precisely the conflation keeping the two
 *   columns separate exists to prevent. Skipping this step would make any phone-only user with an
 *   id divergence resolve to null and be treated as unauthenticated.
 * - `email` is the ORIGINAL pre-existing-row fallback, deliberately preserved rather than replaced.
 *   Any row that existed before its owner's first login (seeded, or created by the admin's
 *   createCustomer action) keeps its own Prisma-generated UUID, which no Supabase auth UUID will
 *   ever match — without this step, requireAdmin() would treat the real business owner as
 *   unauthorized. That is the admin-lockout regression this fallback was added for, and it stays
 *   covered by tests/integration/admin-lockout.integration.test.ts.
 */
export async function getCurrentDbUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const byId = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (byId) return byId

  if (authUser.email) {
    const byAuthEmail = await prisma.user.findUnique({ where: { authEmail: authUser.email } })
    if (byAuthEmail) return byAuthEmail

    return prisma.user.findUnique({ where: { email: authUser.email } })
  }
  return null
}

/**
 * THE prerequisite fix: one identity-sync implementation for the email path, replacing
 * auth/callback/route.ts's email-only guarded block and page.tsx's separate OR-lookup block.
 *
 * Runs AFTER Supabase already has an identity, so authUser.email here is always genuinely real —
 * never one this app invented. (The phone path, which must decide authEmail BEFORE an identity
 * exists, is resolveCustomerForPhoneLogin below.)
 *
 * The third lookup is what stops a duplicate account: an admin-created customer's row already
 * holds their real email/phone but no authEmail yet, so their first login backfills authEmail onto
 * THAT row instead of creating a second one alongside it.
 */
export async function syncPrismaUser(authUser: {
  id: string
  email?: string | null
  phone?: string | null
  name?: string | null
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
    const needsPromotion = isAdmin && dbUser.role !== Role.ADMIN
    if (needsAuthEmailBackfill || needsPromotion) {
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          ...(needsAuthEmailBackfill ? { authEmail: authUser.email } : {}),
          ...(needsPromotion ? { role: Role.ADMIN } : {}),
        },
      })
    }
    return dbUser
  }

  // Brand-new self-service signup — mirrors the existing auto-create-on-first-login behavior.
  // `name` is a required column with nothing authoritative to draw it from at this point (a
  // fresh OAuth/magic-link identity may or may not carry user_metadata) — 'New User' is a
  // placeholder the admin/the customer themselves can overwrite later, not a real name guess.
  return prisma.user.create({
    data: {
      id: authUser.id,
      email: authUser.email || null,
      authEmail: authUser.email || null,
      phone: authUser.phone || null,
      name: authUser.name || 'New User',
      role: isAdmin ? Role.ADMIN : Role.CUSTOMER,
    },
  })
}

/**
 * Phone-OTP counterpart to syncPrismaUser — deliberately a SEPARATE function, not a branch inside
 * it.
 *
 * The two have genuinely different preconditions. This one runs BEFORE any Supabase identity
 * exists for a phone-only customer: we must decide the authEmail value first, then ask Supabase to
 * create an identity around it. syncPrismaUser runs AFTER Supabase already has one. Merging them
 * would force a single function to guess whether an incoming email is real or one this app
 * generated — fragile domain-suffix pattern-matching. Two small functions with explicit, distinct
 * preconditions is the more defensible shape.
 */
export async function resolveCustomerForPhoneLogin(
  phone: string
): Promise<{ user: User; authEmail: string }> {
  let user = await prisma.user.findUnique({ where: { phone } })
  const isAdmin = isAdminIdentity({ phone })

  if (!user) {
    try {
      const created = await prisma.user.create({
        data: {
          phone,
          authEmail: syntheticEmailForPhone(phone),
          preferredLoginMethod: 'PHONE',
          // No metadata source at all on a phone-only first login — see syncPrismaUser's own
          // comment on the same placeholder.
          name: 'New User',
          role: isAdmin ? Role.ADMIN : Role.CUSTOMER,
        },
      })
      return { user: created, authEmail: created.authEmail! }
    } catch (err) {
      // A double-submit on a slow mobile connection can race two first-login requests through
      // this branch for the same number. User.phone is @unique, so the loser gets a P2002 — which
      // would otherwise surface to a customer who just entered a correct code as "A customer with
      // that email or phone number already exists", a baffling message on this feature's
      // highest-value path. Re-fetch and continue instead, turning the race into the same harmless
      // outcome (two valid sessions) already accepted for returning customers.
      //
      // Scoped narrowly to the unique-constraint collision: any other failure still propagates.
      const isUniqueCollision =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      if (!isUniqueCollision) throw err

      user = await prisma.user.findUnique({ where: { phone } })
      if (!user) throw err // genuinely absent — the collision was on some other constraint
    }
  }

  const needsAuthEmailBackfill = !user.authEmail
  const needsPromotion = isAdmin && user.role !== Role.ADMIN
  if (needsAuthEmailBackfill || needsPromotion) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(needsAuthEmailBackfill ? { authEmail: syntheticEmailForPhone(phone) } : {}),
        ...(needsPromotion ? { role: Role.ADMIN } : {}),
      },
    })
  }
  return { user, authEmail: user.authEmail! }
}

/**
 * Mints a real Supabase session for `authEmail` and redeems it onto the current request's cookies.
 * Used ONLY by the phone-OTP path — email customers already get a session through Supabase's own
 * signInWithOtp + exchangeCodeForSession flow.
 *
 * ⚠ THE `type` ARGUMENT IS NEVER A LITERAL. It is always the `verification_type` that this same
 * generateLink call just returned. Supabase reports "signup" the first time an authEmail has no
 * identity yet (generateLink auto-creates it) and "magiclink" on every subsequent call — and
 * redeeming a "signup" token as 'magiclink' fails with HTTP 403. Hard-coding 'magiclink' therefore
 * works for every returning customer and breaks on exactly one path: a phone-only customer's very
 * FIRST login, which is this whole feature's highest-value scenario. A unit test that mocks
 * generateLink's response cannot catch that mistake — it only surfaces against the real Admin API.
 *
 * The two clients are also not interchangeable: generateLink needs the service-role client, while
 * verifyOtp must run on the cookie-writing SSR client, because that is what actually writes the
 * session cookies the browser needs. verifyOtp on the service-role client mints a session nobody
 * receives.
 */
export async function mintSessionForAuthEmail(authEmail: string): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authEmail,
  })
  if (error || !data?.properties) {
    throw new AuthError('Could not start a session. Please try again.')
  }

  const supabase = await createClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: data.properties.verification_type, // read back from the response — never hard-coded
  })
  if (verifyError) {
    throw new AuthError('Could not start a session. Please try again.')
  }
}

export async function requireRole(allowedRoles: Role[]): Promise<User> {
  const dbUser = await getCurrentDbUser()
  if (!dbUser) {
    throw new AuthError('You must be signed in to do that.')
  }
  if (!allowedRoles.includes(dbUser.role)) {
    throw new AuthError('You do not have permission to do that.')
  }
  return dbUser
}

export async function requireAdmin(): Promise<User> {
  return requireRole([Role.ADMIN])
}

export async function requireStaffOrAdmin(): Promise<User> {
  return requireRole([Role.ADMIN, Role.KITCHEN_STAFF])
}

export function getRoleRedirect(role?: Role): string {
  if (role === 'DELIVERY_DRIVER') return '/admin/driver'
  if (role === 'KITCHEN_STAFF') return '/admin/orders'
  if (role === 'CUSTOMER') return '/dashboard'
  return '/login'
}

export async function authorizePage(allowedRoles: Role[]): Promise<User> {
  const dbUser = await getCurrentDbUser()
  if (!dbUser) {
    redirect('/login')
  }
  if (!allowedRoles.includes(dbUser.role)) {
    redirect(getRoleRedirect(dbUser.role))
  }
  return dbUser
}
