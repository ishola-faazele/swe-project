"use server"

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const email = formData.get('email') as string

  const response = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
    },
  })

  if (response.error) {
    console.error('Login error FULL OBJECT:', JSON.stringify(response.error, null, 2))
    console.error('Login error plain:', response.error)
    redirect(`/login?message=Could not authenticate user: ${response.error.message || JSON.stringify(response.error)}`)
  }

  redirect('/login?message=Check your email for the magic link')
}
