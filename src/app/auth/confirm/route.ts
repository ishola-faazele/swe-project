/**
 * Server-side redemption of an admin-generated magic link.
 *
 * WHY THIS ROUTE EXISTS, and why it is not /auth/callback:
 * `supabase.auth.admin.generateLink()` returns an implicit-flow `action_link` whose session
 * credentials arrive in the URL FRAGMENT (`#access_token=...`), and browsers never transmit a
 * fragment to the server (RFC 3986 — fragments are client-side only). No server route can read it,
 * however it is written. So this route ignores `action_link` entirely and instead redeems the
 * `hashed_token` the same generateLink response carries, server-side, via verifyOtp. This matches
 * Supabase's own documented "confirm" route pattern.
 *
 * /auth/callback is deliberately untouched and stays PKCE-only: it remains the landing route for
 * the browser-driven signInWithOtp flow that today's email magic-link login uses, where a `?code=`
 * query param genuinely is present.
 *
 * ⚠ UNAUTHENTICATED BY DESIGN — this route ESTABLISHES a session, so it cannot require one.
 * No requireAdmin()/getCurrentDbUser() guard belongs here, exactly like /auth/callback.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  // A plain Request with no dynamic segments, so Next.js 16's async params/searchParams change
  // does not apply — this reads the query string off the URL directly.
  const { searchParams } = new URL(request.url)

  // Deliberately NOT `new URL(request.url).origin`, for the same reason auth/callback/route.ts
  // avoids it: Next's dev server resolves that to localhost:3000 even when the browser actually
  // requested 127.0.0.1:3000, and redirecting to a different origin than the one this response
  // just set session cookies on would leave the app looking logged-out.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/'

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?message=That sign-in link is invalid. Please request a new one.`)
  }

  // ⚠ `type` is passed through VERBATIM from the link's own query string — never a hard-coded
  // 'magiclink' or 'signup' literal. generateLink reports "signup" the first time an identity is
  // created and "magiclink" on every subsequent call, and redeeming one as the other fails with
  // HTTP 403. An admin-created customer's very first login link is precisely the "signup" case
  // this route exists to handle, so hard-coding would break exactly the path that matters most.
  // Same binding rule as mintSessionForAuthEmail in src/lib/auth.ts.
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

  if (error) {
    // Expired, already-consumed, or otherwise rejected. Never let this throw out of the handler as
    // a raw 500 — the customer gets a plain-language message and a way to try again.
    console.error('[Auth Confirm] Token redemption failed:', error.message)
    return NextResponse.redirect(`${origin}/login?message=That sign-in link has expired or was already used. Please request a new one.`)
  }

  // Session cookies are now set on this response. `/` routes on to /admin or /dashboard by role
  // via syncPrismaUser in src/app/page.tsx.
  return NextResponse.redirect(`${origin}${next}`)
}
