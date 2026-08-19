/**
 * Route tests for the WhatsApp webhook — the first route-handler tests in this repo, so this
 * file establishes the pattern: construct a real `Request` and call the exported GET/POST
 * directly. No server, no supertest, no network.
 *
 * ⚠ Every env-dependent case stubs its env var explicitly. This is load-bearing: WHATSAPP_APP_SECRET
 * and WHATSAPP_WEBHOOK_VERIFY_TOKEN are both real, non-empty values in this repo's `.env`, which
 * vitest.config.mts's `node` project loads via `dotenv/config`. The fail-closed cases (403/503)
 * would silently test nothing if they relied on ambient absence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { GET, POST } from './route'

const TEST_APP_SECRET = 'test-app-secret-NEVER-LOG-ME'
const TEST_VERIFY_TOKEN = 'test-verify-token-NEVER-LOG-ME'
const WEBHOOK_URL = 'https://example.com/api/webhooks/whatsapp'

/** A realistic Cloud API delivery-event payload — shape is logged, never parsed for fields. */
const SAMPLE_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_ID',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        statuses: [{ id: 'wamid.TEST', status: 'delivered', recipient_id: '233241234567' }],
      },
    }],
  }],
}

/** Signs a body exactly the way Meta does, so the route's own HMAC must agree. */
function sign(body: string, secret = TEST_APP_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

function getRequest(params: Record<string, string>) {
  const url = new URL(WEBHOOK_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url, { method: 'GET' })
}

function postRequest(body: string, signature?: string) {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature === undefined ? {} : { 'x-hub-signature-256': signature }),
    },
    body,
  })
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET — Meta verification handshake', () => {
  it('returns 200 with the RAW challenge as plain text on a correct handshake', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TEST_VERIFY_TOKEN)

    const response = await GET(getRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    }))

    expect(response.status).toBe(200)
    // Must be the bare challenge string — NOT JSON-wrapped. Meta's verification fails otherwise.
    expect(await response.text()).toBe('1158201444')
    expect(response.headers.get('content-type')).toContain('text/plain')
  })

  it('returns the challenge verbatim without JSON-parsing it', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TEST_VERIFY_TOKEN)

    const response = await GET(getRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    }))
    const text = await response.text()

    expect(text).not.toContain('{')
    expect(text).not.toContain('"')
  })

  it('returns 403 when the verify token does not match', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TEST_VERIFY_TOKEN)

    const response = await GET(getRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': '1158201444',
    }))

    expect(response.status).toBe(403)
    expect(await response.text()).not.toBe('1158201444')
  })

  it('returns 403 when hub.mode is not "subscribe"', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TEST_VERIFY_TOKEN)

    const response = await GET(getRequest({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    }))

    expect(response.status).toBe(403)
  })

  it('returns 403 when hub.challenge is absent', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TEST_VERIFY_TOKEN)

    const response = await GET(getRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
    }))

    expect(response.status).toBe(403)
  })

  // Fail-closed. Explicitly stubbed empty — the real .env sets this to a live value, so relying
  // on ambient absence would make this test pass without exercising the branch it names.
  it('fails closed with 403 when WHATSAPP_WEBHOOK_VERIFY_TOKEN is unset', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')

    const response = await GET(getRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'anything',
      'hub.challenge': '1158201444',
    }))

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Webhook verify token not configured')
  })

  it('does not auto-verify an empty-token request when the env var is also unset', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')

    const response = await GET(getRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': '',
      'hub.challenge': '1158201444',
    }))

    expect(response.status).toBe(403)
  })
})

describe('POST — signature-verified event logging', () => {
  it('accepts a validly-signed payload with 200 {received: true}', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = JSON.stringify(SAMPLE_PAYLOAD)

    const response = await POST(postRequest(body, sign(body)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
  })

  it('logs the verified payload', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = JSON.stringify(SAMPLE_PAYLOAD)

    await POST(postRequest(body, sign(body)))

    expect(console.log).toHaveBeenCalledWith('[WhatsApp Webhook] Received event:', expect.stringContaining('wamid.TEST'))
  })

  it('rejects a tampered signature (valid hex, wrong value) with 401', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = JSON.stringify(SAMPLE_PAYLOAD)
    // Same length, same hex alphabet, wrong digest — the exact case timingSafeEqual exists for.
    const tampered = 'sha256=' + 'a'.repeat(64)

    const response = await POST(postRequest(body, tampered))

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Invalid signature')
  })

  it('rejects a signature computed with the WRONG secret with 401', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = JSON.stringify(SAMPLE_PAYLOAD)

    const response = await POST(postRequest(body, sign(body, 'a-different-app-secret')))

    expect(response.status).toBe(401)
  })

  it('rejects a valid signature over a DIFFERENT body with 401', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const signedBody = JSON.stringify(SAMPLE_PAYLOAD)
    const deliveredBody = JSON.stringify({ ...SAMPLE_PAYLOAD, object: 'tampered_in_flight' })

    // Signature is genuine, but for other bytes — this is what verifying the RAW body catches.
    const response = await POST(postRequest(deliveredBody, sign(signedBody)))

    expect(response.status).toBe(401)
  })

  it('rejects a missing signature header with 401', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = JSON.stringify(SAMPLE_PAYLOAD)

    const response = await POST(postRequest(body, undefined))

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Missing signature')
  })

  it('rejects a signature header without the sha256= prefix with 401', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = JSON.stringify(SAMPLE_PAYLOAD)
    const unprefixed = crypto.createHmac('sha256', TEST_APP_SECRET).update(body, 'utf8').digest('hex')

    const response = await POST(postRequest(body, unprefixed))

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Missing signature')
  })

  // The regression test for the crypto.timingSafeEqual length-mismatch crash. Without the
  // explicit length check in the route, each of these throws a RangeError and the route 500s.
  describe('malformed signatures reject cleanly instead of throwing', () => {
    const malformed: [label: string, signature: string][] = [
      ['truncated hex', 'sha256=abc123'],
      ['empty after the prefix', 'sha256='],
      ['non-hex characters', 'sha256=' + 'z'.repeat(64)],
      ['odd-length hex', 'sha256=abc'],
      ['far too long', 'sha256=' + 'a'.repeat(200)],
      ['whitespace', 'sha256=   '],
    ]

    it.each(malformed)('%s → resolves with 401, does not throw', async (_label, signature) => {
      vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
      const body = JSON.stringify(SAMPLE_PAYLOAD)

      const call = POST(postRequest(body, signature))

      // Explicitly assert the promise RESOLVES — a rejection here is the crash this guards.
      await expect(call).resolves.toBeDefined()
      expect((await call).status).toBe(401)
    })
  })

  it('returns 400 when a correctly-signed body is not parseable JSON', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
    const body = 'this is definitely not json'

    const response = await POST(postRequest(body, sign(body)))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid payload')
  })

  // Fail-closed. Explicitly stubbed empty — the real .env holds a live secret.
  describe('fails closed when WHATSAPP_APP_SECRET is unset', () => {
    it('returns 503', async () => {
      vi.stubEnv('WHATSAPP_APP_SECRET', '')
      const body = JSON.stringify(SAMPLE_PAYLOAD)

      const response = await POST(postRequest(body, sign(body)))

      expect(response.status).toBe(503)
      expect(await response.text()).toBe('Not configured')
    })

    it('never reads, parses or logs the payload', async () => {
      vi.stubEnv('WHATSAPP_APP_SECRET', '')
      const body = JSON.stringify(SAMPLE_PAYLOAD)
      const request = postRequest(body, sign(body))

      await POST(request)

      expect(console.log).not.toHaveBeenCalled()
      // The body stream is untouched, which is the observable proof it was never read.
      expect(request.bodyUsed).toBe(false)
    })

    it('rejects even a validly-signed request rather than trusting it unverified', async () => {
      vi.stubEnv('WHATSAPP_APP_SECRET', '')
      const body = JSON.stringify(SAMPLE_PAYLOAD)

      const response = await POST(postRequest(body, sign(body)))

      expect(response.status).not.toBe(200)
    })
  })

  // PROACTIVE-001 — the app secret is the whole security boundary here; leaking it into a CI log
  // would be worse than any other secret in this feature.
  describe('no secrets in logs', () => {
    it('never logs the app secret when rejecting an invalid signature', async () => {
      vi.stubEnv('WHATSAPP_APP_SECRET', TEST_APP_SECRET)
      const body = JSON.stringify(SAMPLE_PAYLOAD)

      await POST(postRequest(body, 'sha256=' + 'a'.repeat(64)))

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_APP_SECRET)
    })

    it('never logs the app secret when failing closed', async () => {
      vi.stubEnv('WHATSAPP_APP_SECRET', '')
      const body = JSON.stringify(SAMPLE_PAYLOAD)

      await POST(postRequest(body, sign(body)))

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_APP_SECRET)
    })

    it('never logs the verify token when rejecting a GET handshake', async () => {
      vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TEST_VERIFY_TOKEN)

      await GET(getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' }))

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_VERIFY_TOKEN)
    })
  })
})
