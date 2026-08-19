/**
 * Unit tests for src/lib/notifications/sms.ts — the Arkesel v1 transport plus both callers'
 * message shapes. `global.fetch` is mocked in every single case: NO test in this file may ever
 * make a real network call. A real Arkesel send costs credits from a live balance and delivers
 * to a real phone.
 *
 * ⚠ Credentials now come from the NotificationSettings table, not env vars, so `@/lib/settings` is
 * mocked here rather than the environment. Every config-dependent case sets its settings shape
 * explicitly: the mock has no ambient default, so a test that forgot to configure would fail
 * loudly rather than silently passing for the wrong reason.
 *
 * "enabled" and "configured" are two INDEPENDENT gates with distinct no-op reasons, and both are
 * covered below. The Arkesel v1 transport itself is untouched by that refactor — every
 * request-shape and success/failure-mapping assertion in this file is unchanged in intent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/settings', () => ({ getNotificationSettings: vi.fn() }))

import { getNotificationSettings } from '@/lib/settings'
import { sendLowStockSms, sendOrderStatusSms, sendSms } from './sms'

const TEST_API_KEY = 'test-arkesel-key-NEVER-LOG-ME'
const TEST_SENDER_ID = 'Rostty'
const GHANA_PHONE = '0241234567'
const NORMALIZED_GHANA_PHONE = '233241234567'
// Matches this repo's own seed data, which uses Nigerian numbers — toGhanaE164 rejects these.
const NON_GHANA_PHONE = '+2348012345678'

let fetchMock: ReturnType<typeof vi.fn>

const settingsMock = vi.mocked(getNotificationSettings)

/** A fully-configured, enabled SMS channel, with known assertable values. */
function stubSettings(overrides: Record<string, unknown> = {}) {
  settingsMock.mockResolvedValue({
    smsEnabled: true,
    arkeselApiKey: TEST_API_KEY,
    arkeselSenderId: TEST_SENDER_ID,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

/** A `Response`-shaped stub — only the three members sendSms actually touches. */
function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** The URL of the Nth fetch call, as a parsed URL regardless of whether a string or URL was passed. */
function requestUrlOfCall(callIndex = 0) {
  return new URL(String(fetchMock.mock.calls[callIndex][0]))
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  stubSettings()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sendSms', () => {
  describe('settings-gated no-op — "configured" and "enabled" are independent', () => {
    it('no-ops without calling fetch when the Arkesel API key is not stored', async () => {
      stubSettings({ arkeselApiKey: null })

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'sms_not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops without calling fetch when the Arkesel sender ID is not stored', async () => {
      stubSettings({ arkeselSenderId: null })

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'sms_not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    // The independence cases. A channel can hold perfectly valid credentials and still be switched
    // off, and that must be a DISTINCT, recognizable reason — not conflated with "not configured".
    it('no-ops with the distinct sms_disabled reason when the channel is off despite valid credentials', async () => {
      stubSettings({ smsEnabled: false })

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'sms_disabled' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports sms_not_configured — not sms_disabled — when enabled but credential-less', async () => {
      stubSettings({ smsEnabled: true, arkeselApiKey: null, arkeselSenderId: null })

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'sms_not_configured' })
    })
  })

  describe('phone-normalization no-op', () => {
    it('no-ops without calling fetch on a non-Ghana number', async () => {
      stubSettings()

      const result = await sendSms({ to: NON_GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'invalid_phone' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops without calling fetch on an empty phone string', async () => {
      stubSettings()

      const result = await sendSms({ to: '', message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'invalid_phone' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('the v1 query-string request shape', () => {
    beforeEach(() => {
      stubSettings()
      fetchMock.mockResolvedValue(mockResponse(200, { code: 'ok', message: 'Successfully Send' }))
    })

    it('issues a GET to the v1 endpoint — not a POST', async () => {
      await sendSms({ to: GHANA_PHONE, message: 'hello' })

      const [, init] = fetchMock.mock.calls[0]
      expect(init?.method).toBe('GET')
      expect(requestUrlOfCall().origin + requestUrlOfCall().pathname).toBe('https://sms.arkesel.com/sms/api')
    })

    it('puts action, api_key, to, from and sms in the query string', async () => {
      await sendSms({ to: GHANA_PHONE, message: 'hello there' })

      const params = requestUrlOfCall().searchParams
      expect(params.get('action')).toBe('send-sms')
      expect(params.get('api_key')).toBe(TEST_API_KEY)
      expect(params.get('to')).toBe(NORMALIZED_GHANA_PHONE)
      expect(params.get('from')).toBe(TEST_SENDER_ID)
      expect(params.get('sms')).toBe('hello there')
    })

    it('sends NO request body and NO api-key header — v1 carries everything in the URL', async () => {
      await sendSms({ to: GHANA_PHONE, message: 'hello' })

      const [, init] = fetchMock.mock.calls[0]
      expect(init?.body).toBeUndefined()
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(Object.keys(headers).map(k => k.toLowerCase())).not.toContain('api-key')
    })

    it('URL-encodes a message containing spaces, quotes and # so the query string stays intact', async () => {
      const message = 'Your order #42 ("40 pies & jollof") is READY!'

      await sendSms({ to: GHANA_PHONE, message })

      // The raw query string must not contain a literal '#' — it would truncate the URL at a
      // fragment — but decoding must round-trip back to the exact original message.
      const rawQuery = requestUrlOfCall().search
      expect(rawQuery).not.toContain('#42')
      expect(requestUrlOfCall().searchParams.get('sms')).toBe(message)
    })

    // '&', '=', and '+' are the three characters most likely to silently corrupt a hand-built
    // query string: an unescaped '&' or '=' splits/reinterprets query parameters, and a raw '+'
    // decodes back as a literal space rather than a plus sign. Order descriptions are free text
    // (see prisma/schema.prisma's Order.description) and can plausibly contain any of these —
    // e.g. "2 for 1 + extra rice", "Buy 1 Get 1 = free", "Tables A&B". url.searchParams handles
    // all of this correctly (it's the whole reason it's used instead of string concatenation),
    // but that guarantee had no direct regression test for these three characters specifically.
    it('round-trips a message containing &, = and + without corrupting the query string', async () => {
      const message = '2 for 1 + extra rice, Buy 1 Get 1 = free (Tables A&B, 50% off)'

      await sendSms({ to: GHANA_PHONE, message })

      const url = requestUrlOfCall()
      // Decoded via URL parsing, the message must survive byte-for-byte...
      expect(url.searchParams.get('sms')).toBe(message)
      // ...and sibling params must still parse as exactly themselves — an unescaped '&'/'=' in
      // `sms` would otherwise bleed into `to`/`from`/`action` or fabricate extra query keys.
      expect(url.searchParams.get('action')).toBe('send-sms')
      expect(url.searchParams.get('to')).toBe(NORMALIZED_GHANA_PHONE)
      expect(url.searchParams.get('from')).toBe(TEST_SENDER_ID)
      expect([...url.searchParams.keys()].sort()).toEqual(['action', 'api_key', 'from', 'response', 'sms', 'to'])
      // In application/x-www-form-urlencoded, a bare space legitimately encodes AS a raw '+' —
      // so the literal '+' character from the message must instead show up escaped as '%2B' in
      // the raw query string; if it appeared as a bare '+' it would be indistinguishable from an
      // encoded space and a spec-compliant decoder (Arkesel's server) would silently turn it into
      // one, corrupting the message.
      expect(url.search).toContain('%2B')
    })

    it('URL-encodes the ⚠️ emoji used in sendLowStockSms\'s existing copy without corrupting it', async () => {
      const message = '⚠️ Low Stock: Rice is at 3 kg. Please restock soon.'

      await sendSms({ to: GHANA_PHONE, message })

      expect(requestUrlOfCall().searchParams.get('sms')).toBe(message)
    })

    it('sends the normalized phone number, not the raw local-format input', async () => {
      await sendSms({ to: '024 123 4567', message: 'hello' })

      expect(requestUrlOfCall().searchParams.get('to')).toBe(NORMALIZED_GHANA_PHONE)
    })
  })

  describe('success/failure mapping — checks both signals, requires neither field', () => {
    beforeEach(() => stubSettings())

    it('maps 200 + {code: "ok"} to {success: true, data}', async () => {
      const body = { code: 'ok', message: 'Successfully Send', balance: 522, user: 'Faazele Ishola' }
      fetchMock.mockResolvedValue(mockResponse(200, body))

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: true, data: body })
    })

    it('maps 200 + a documented failure code ("102" = Authentication Failed) to a failure', async () => {
      const body = { code: '102', message: 'Authentication Failed' }
      fetchMock.mockResolvedValue(mockResponse(200, body))

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'api_error', code: '102', data: body })
    })

    // The regression test for "don't require the field to exist, don't crash on its absence".
    // The live-verified balance response has NO `code` field at all, proving the v1 envelope
    // varies per action — so a 200 without one must not be treated as a failure.
    it('maps 200 + a body with NO code field at all to {success: true, data}', async () => {
      const balanceShapedBody = { balance: 523, user: 'Faazele Ishola', country: 'Ghana' }
      fetchMock.mockResolvedValue(mockResponse(200, balanceShapedBody))

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: true, data: balanceShapedBody })
    })

    it('maps 200 + an unparseable (non-JSON) body to {success: true, data: null} without throwing', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not JSON') } })

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: true, data: null })
    })

    it('maps a non-2xx status to {success: false, reason: api_error, status, data}', async () => {
      const body = { code: '102', message: 'Authentication Failed' }
      fetchMock.mockResolvedValue(mockResponse(401, body))

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'api_error', status: 401, data: body })
    })

    it('maps a 500 with an unparseable body to a failure rather than crashing', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('gateway HTML') } })

      const result = await sendSms({ to: GHANA_PHONE, message: 'hello' })

      expect(result).toEqual({ success: false, reason: 'api_error', status: 500, data: null })
    })

    it('catches a thrown fetch and returns {success: false, error} without rejecting', async () => {
      const networkError = new Error('ECONNREFUSED')
      fetchMock.mockRejectedValue(networkError)

      await expect(sendSms({ to: GHANA_PHONE, message: 'hello' })).resolves.toEqual({
        success: false,
        error: networkError,
      })
    })
  })

  // PROACTIVE-001 — the API key travels in the URL here, which makes accidental logging of the
  // whole request object an especially easy mistake to make while debugging.
  describe('no secrets in logs', () => {
    it('never logs the API key on an HTTP-failure path', async () => {
      stubSettings()
      fetchMock.mockResolvedValue(mockResponse(401, { code: '102', message: 'Authentication Failed' }))

      await sendSms({ to: GHANA_PHONE, message: 'hello' })

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_API_KEY)
    })

    it('never logs the API key on a code-failure path', async () => {
      stubSettings()
      fetchMock.mockResolvedValue(mockResponse(200, { code: '102', message: 'Authentication Failed' }))

      await sendSms({ to: GHANA_PHONE, message: 'hello' })

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_API_KEY)
    })

    it('never logs the API key on a thrown-network-error path', async () => {
      stubSettings()
      fetchMock.mockRejectedValue(new Error('network down'))

      await sendSms({ to: GHANA_PHONE, message: 'hello' })

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_API_KEY)
    })
  })

  // PROACTIVE-001 — the no-op branches used to log the whole `data` object, message body included.
  // sendSms is a generic entry point and now carries phone-login OTPs, so that would print a live,
  // unexpired login code to the server log. The unconfigured branch is not hypothetical: it is the
  // real state of a fresh deploy until the admin enters credentials at /admin/settings.
  describe('no OTP codes in logs on a no-op path', () => {
    const OTP_MESSAGE = 'Your Chop with Rostty login code is 483920. It expires in 10 minutes.'

    it('never echoes the message body when the channel is disabled', async () => {
      stubSettings({ smsEnabled: false })

      await sendSms({ to: GHANA_PHONE, message: OTP_MESSAGE })

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain('483920')
      expect(JSON.stringify(logged)).not.toContain(OTP_MESSAGE)
    })

    it('never echoes the message body when credentials are absent', async () => {
      stubSettings({ arkeselApiKey: null })

      await sendSms({ to: GHANA_PHONE, message: OTP_MESSAGE })

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain('483920')
      expect(JSON.stringify(logged)).not.toContain(OTP_MESSAGE)
    })
  })
})

describe('sendOrderStatusSms', () => {
  beforeEach(() => {
    stubSettings()
    fetchMock.mockResolvedValue(mockResponse(200, { code: 'ok' }))
  })

  /** The message text actually put on the wire for the most recent call. */
  function sentMessage() {
    return requestUrlOfCall().searchParams.get('sms')
  }

  it('leads the PENDING message with the order shortId', async () => {
    await sendOrderStatusSms(GHANA_PHONE, 42, 'jollof', 'PENDING')

    expect(sentMessage()).toContain('#42')
    expect(sentMessage()).toBe('Your order #42 ("jollof") has been received.')
  })

  const allStatuses = ['PENDING', 'PREPPING', 'COOKING', 'READY', 'COMPLETED', 'CANCELLED'] as const

  it.each(allStatuses)('includes #shortId and the description in the %s message', async (status) => {
    await sendOrderStatusSms(GHANA_PHONE, 42, 'jollof', status)

    expect(sentMessage()).toContain('#42')
    expect(sentMessage()).toContain('jollof')
    // The UUID must never appear in customer-facing copy — this channel only ever gets shortId.
    expect(sentMessage()).not.toContain('-')
  })

  it('falls back to a shortId-carrying message for an unrecognized status', async () => {
    await sendOrderStatusSms(GHANA_PHONE, 7, 'jollof', 'SOME_NEW_STATUS')

    expect(sentMessage()).toBe('Order #7 status: SOME_NEW_STATUS')
  })

  it('reads its parameters in (phone, shortId, description, status) order', async () => {
    await sendOrderStatusSms(GHANA_PHONE, 99, 'banku and tilapia', 'COOKING')

    expect(requestUrlOfCall().searchParams.get('to')).toBe(NORMALIZED_GHANA_PHONE)
    expect(sentMessage()).toBe('Your order #99 ("banku and tilapia") is now being cooked!')
  })

  it('propagates sendSms\'s no-op result rather than throwing when unconfigured', async () => {
    stubSettings({ arkeselApiKey: null })

    const result = await sendOrderStatusSms(GHANA_PHONE, 42, 'jollof', 'PENDING')

    expect(result).toEqual({ success: false, reason: 'sms_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sendLowStockSms', () => {
  beforeEach(() => {
    stubSettings()
    fetchMock.mockResolvedValue(mockResponse(200, { code: 'ok' }))
  })

  it('keeps its pre-existing message format exactly — it takes no orderShortId', async () => {
    await sendLowStockSms(GHANA_PHONE, 'Rice', 3, 'kg')

    expect(requestUrlOfCall().searchParams.get('sms')).toBe('⚠️ Low Stock: Rice is at 3 kg. Please restock soon.')
  })

  it('does not leak an order shortId into the low-stock copy', async () => {
    await sendLowStockSms(GHANA_PHONE, 'Rice', 3, 'kg')

    expect(requestUrlOfCall().searchParams.get('sms')).not.toContain('#')
  })

  it('sends to the normalized admin phone number', async () => {
    await sendLowStockSms('024 123 4567', 'Rice', 3, 'kg')

    expect(requestUrlOfCall().searchParams.get('to')).toBe(NORMALIZED_GHANA_PHONE)
  })

  it('no-ops on an admin phone that fails normalization', async () => {
    const result = await sendLowStockSms(NON_GHANA_PHONE, 'Rice', 3, 'kg')

    expect(result).toEqual({ success: false, reason: 'invalid_phone' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
