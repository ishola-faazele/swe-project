import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
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
              id: user.id, // Keep Supabase ID in sync with Prisma ID if possible (though Prisma id is uuid default, we can overwrite it if we want, but Prisma schema has default(uuid()). We'll let Prisma generate its own or use Supabase's)
              email: user.email,
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
