import { createClient } from '@supabase/supabase-js'

/**
 * SERVER-ONLY. Bypasses Row Level Security entirely.
 *
 * ⚠ NEVER import this module from a "use client" component, and never expose SUPABASE_SERVICE_ROLE_KEY
 * via a NEXT_PUBLIC_ prefix — either mistake hands every browser unrestricted database access.
 * There is no automated boundary check for this in the codebase today; it is enforced by review.
 *
 * Deliberately a separate module from utils/supabase/{client,server,session}.ts. Those three all
 * wrap SSR/browser cookie handling; this one must have none. The distinction matters at exactly
 * one place: admin.auth.admin.generateLink() needs THIS client (service-role, no cookies), while
 * the verifyOtp() call that redeems the resulting token must run on the cookie-writing SSR client
 * from server.ts — calling verifyOtp here would mint a session no browser ever receives.
 *
 * autoRefreshToken/persistSession are off because there is no session to manage: every call is
 * one-shot admin work on behalf of the server, not a logged-in user.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
