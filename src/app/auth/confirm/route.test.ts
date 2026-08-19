/**
 * Route tests for /auth/confirm — server-side redemption of an admin-generated magic link.
 *
 * Follows the pattern route.test.ts established for the WhatsApp webhook: construct a real
 * Request, call the exported GET directly. No server, no supertest, no network. The Supabase SSR
 * client is mocked, so no test here makes a real auth call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { GET } from './route'

const createClientMock = vi.mocked(createClient)

const SITE_URL = 'http://127.0.0.1:3000'
const verifyOtpMock = vi.fn()

function confirmRequest(params: Record<string, string>) {
  const url = new URL(`${SITE_URL}/auth/confirm`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL)
  verifyOtpMock.mockResolvedValue({ error: null })
  createClientMock.mockResolvedValue({
    auth: { verifyOtp: verifyOtpMock },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('successful redemption', () => {
  it('redeems the token and redirects away from /auth/confirm', async () => {
    const response = await GET(confirmRequest({ token_hash: 'hash-abc', type: 'signup' }))

    expect(verifyOtpMock).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${SITE_URL}/`)
    expect(response.headers.get('location')).not.toContain('/auth/confirm')
  })

  it('honours a `next` param when one is present', async () => {
    const response = await GET(
      confirmRequest({ token_hash: 'hash-abc', type: 'magiclink', next: '/dashboard' })
    )

    expect(response.headers.get('location')).toBe(`${SITE_URL}/dashboard`)
  })
})

/**
 * THE binding directive, and the reason this route exists as its own file rather than folded into
 * /auth/callback. generateLink reports "signup" the first time an identity is created and
 * "magiclink" afterwards; redeeming one as the other returns HTTP 403. An admin-created customer's
 * very first sign-in link is exactly the "signup" case, so a hard-coded literal would break
 * precisely the path this route was built for.
 */
describe('the `type` argument is always the request\'s own value, never a literal', () => {
  it('passes type=signup through unchanged (the first-login case)', async () => {
    await GET(confirmRequest({ token_hash: 'hash-abc', type: 'signup' }))

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'hash-abc', type: 'signup' })
  })

  it('passes type=magiclink through unchanged (the repeat-login case)', async () => {
    await GET(confirmRequest({ token_hash: 'hash-def', type: 'magiclink' }))

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'hash-def', type: 'magiclink' })
  })

  it('passes an unfamiliar type through verbatim rather than substituting a known one', async () => {
    await GET(confirmRequest({ token_hash: 'hash-ghi', type: 'email_change' }))

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'hash-ghi', type: 'email_change' })
  })

  it('forwards the token_hash verbatim too', async () => {
    await GET(confirmRequest({ token_hash: 'a-very-specific-hash', type: 'signup' }))

    expect(verifyOtpMock.mock.calls[0][0].token_hash).toBe('a-very-specific-hash')
  })
})

describe('rejected tokens degrade to a login redirect, never an unhandled throw', () => {
  it('redirects to /login with a message when verifyOtp reports an error', async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } })

    const response = await GET(confirmRequest({ token_hash: 'stale-hash', type: 'signup' }))

    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/login?message=')
    expect(location).not.toContain('/auth/confirm')
  })

  it('resolves rather than rejecting on a verifyOtp error — no raw 500 escapes', async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: 'nope' } })

    await expect(GET(confirmRequest({ token_hash: 'stale', type: 'signup' }))).resolves.toBeDefined()
  })

  it('never leaks the raw Supabase error text into the redirect URL', async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: 'internal-token-detail-xyz' } })

    const response = await GET(confirmRequest({ token_hash: 'stale', type: 'signup' }))

    expect(response.headers.get('location')).not.toContain('internal-token-detail-xyz')
  })
})

describe('missing parameters are rejected before any Supabase call', () => {
  it('redirects to /login without calling verifyOtp when token_hash is absent', async () => {
    const response = await GET(confirmRequest({ type: 'signup' }))

    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('/login?message=')
  })

  it('redirects to /login without calling verifyOtp when type is absent', async () => {
    const response = await GET(confirmRequest({ token_hash: 'hash-abc' }))

    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('/login?message=')
  })

  it('redirects to /login for a request with no query params at all', async () => {
    const response = await GET(confirmRequest({}))

    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('/login?message=')
  })
})

/**
 * The redirect origin comes from NEXT_PUBLIC_SITE_URL, not from request.url — the same reasoning
 * /auth/callback documents. Next's dev server resolves request.url's origin to localhost even when
 * the browser asked for 127.0.0.1, and redirecting to a different origin than the one this
 * response just set session cookies on would leave the app looking logged-out.
 */
describe('redirect origin', () => {
  it('builds the redirect from NEXT_PUBLIC_SITE_URL rather than the request origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://rostty.example.com')

    const response = await GET(
      new Request('http://localhost:3000/auth/confirm?token_hash=h&type=signup', { method: 'GET' })
    )

    expect(response.headers.get('location')).toBe('https://rostty.example.com/')
  })
})
