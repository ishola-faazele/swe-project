import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { Role, type User } from '@prisma/client'

export class AuthError extends Error {}

/**
 * Resolves the Prisma User row for the currently authenticated Supabase session.
 *
 * IMPORTANT: src/app/auth/callback/route.ts only sets `id: user.id` (the Supabase auth UUID)
 * when it creates a brand-new Prisma User row. Any row that already existed at login time
 * (seeded via prisma/seed.ts, or created ahead of time via the admin's createCustomer action)
 * keeps its own Prisma-generated UUID — the callback promotes that row's `role` to ADMIN on
 * email match, but never reconciles its `id`. A lookup by `id` alone would then find nothing
 * for that user, and requireAdmin() would incorrectly treat the real business owner as
 * unauthenticated/unauthorized — an admin lockout. We resolve by id first (the common, correct
 * case for every row created after this fix), and fall back to a unique email match to cover
 * the pre-existing-row case. This does NOT fix the underlying id divergence (see "Follow-Up
 * Work" in the TDD) — it only prevents that divergence from locking anyone out.
 */
export async function getCurrentDbUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const byId = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (byId) return byId

  if (authUser.email) {
    return prisma.user.findUnique({ where: { email: authUser.email } })
  }
  return null
}

export async function requireAdmin(): Promise<User> {
  const dbUser = await getCurrentDbUser()
  if (!dbUser) {
    throw new AuthError('You must be signed in to do that.')
  }
  if (dbUser.role !== Role.ADMIN) {
    throw new AuthError('You do not have permission to do that.')
  }
  return dbUser
}
