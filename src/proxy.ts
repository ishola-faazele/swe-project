import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/session'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - _next/webpack-hmr (dev-mode hot-reload WebSocket upgrade — routing this through
     *   updateSession()'s async Supabase call corrupts the 101 Switching Protocols handshake,
     *   breaking HMR and, worse, appearing to break client-side hydration/event handling
     *   entirely on some navigations, since the dev runtime restarts against a dead socket)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
