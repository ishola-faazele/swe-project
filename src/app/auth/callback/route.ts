import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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
      // Sync user to Prisma Database
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        // We import prisma here to avoid top-level issues in Edge API if there were any, though this is Node runtime
        const { prisma } = await import('@/lib/prisma')
        
        const existingUser = await prisma.user.findFirst({
          where: { email: user.email }
        })

        const isAdmin = 
          (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL) || 
          (process.env.ADMIN_PHONE && user.phone === process.env.ADMIN_PHONE)

        if (!existingUser) {
          await prisma.user.create({
            data: {
              id: user.id, // Keep Supabase ID in sync with Prisma ID if possible
              email: user.email,
              name: user.user_metadata?.full_name || user.user_metadata?.name || 'New User',
              role: isAdmin ? 'ADMIN' : 'CUSTOMER',
            }
          })
        } else if (isAdmin && existingUser.role !== 'ADMIN') {
          // Promote to admin if email matches
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { role: 'ADMIN' }
          })
        }
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
