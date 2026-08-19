import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { syncPrismaUser } from '@/lib/auth'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Deliberately NOT `new URL(request.url).origin`: Next.js's dev server resolves that to
  // `http://localhost:3000` even when the browser actually requested `127.0.0.1:3000`, so a
  // redirect built from it lands the browser on a different origin than the one that holds the
  // PKCE code_verifier cookie set by signInWithOtp — the exchange above succeeds, but the app
  // then looks logged-out, and clicking "sign in" again from that wrong origin sets a NEW
  // code_verifier cookie there, which does NOT match the *next* magic link's code (still built
  // against NEXT_PUBLIC_SITE_URL), producing "PKCE code verifier not found in storage" on the
  // following attempt. Use the same env var login/actions.ts already uses for emailRedirectTo,
  // so the origin that sets the cookie and the origin that redirects after reading it always
  // agree.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const code = searchParams.get('code')
  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // One shared identity-resolution implementation instead of the inline block that used to
      // live here — see syncPrismaUser in src/lib/auth.ts. That function also backfills authEmail
      // and promotes an admin, so neither concern needs restating at this call site.
      //
      // The old `if (user?.email)` guard is deliberately gone: syncPrismaUser handles a
      // phone-carrying authUser correctly on its own. In practice this route is only ever reached
      // by the browser-driven PKCE signInWithOtp flow, where an email is always present — dropping
      // the guard is defense-in-depth and consistency with the shared contract, not a new code path.
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await syncPrismaUser({ id: user.id, email: user.email, phone: user.phone })
      }

      return NextResponse.redirect(`${origin}${next}`)
    } else {
      console.error('Callback error FULL:', JSON.stringify(error, null, 2))
      console.error('Callback error plain:', error.message)
      return NextResponse.redirect(`${origin}/login?message=Could not login: ${error.message}`)
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?message=Missing code in URL`)
}
