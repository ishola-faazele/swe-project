import type { User } from '@prisma/client'

/**
 * A User row with the internal Supabase-identity column stripped off — the shape every
 * client-facing query returns and every Client Component receives.
 *
 * WHY THIS EXISTS: props passed from a Server Component to a Client Component are serialized into
 * the page's RSC payload and are readable from the browser (page source, React DevTools) whether
 * or not any component actually renders them. So "no table column displays authEmail" is NOT
 * sufficient to keep it out of the browser — the query itself has to exclude it. Every
 * User-returning query whose result reaches a Client Component therefore passes
 * `omit: { authEmail: true }`, and types its result against this.
 *
 * The omit is applied PER QUERY, deliberately not globally on the shared PrismaClient in
 * src/lib/prisma.ts: src/lib/auth.ts's own internals (syncPrismaUser, resolveCustomerForPhoneLogin,
 * getCurrentDbUser) read authEmail directly and would silently break under a global omit — and
 * "silently break" there means reintroducing the admin-lockout bug that already has a dedicated
 * regression test.
 *
 * Deliberately a pure type-only module (no Prisma client, no next/*), following the same
 * convention as phone.ts and recipe.ts, so a Client Component can import it without dragging any
 * server-only code into its module graph.
 */
export type ClientSafeUser = Omit<User, 'authEmail'>
