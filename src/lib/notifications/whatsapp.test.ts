/**
 * Unit tests for src/lib/notifications/whatsapp.ts — the full failure-mode matrix for both
 * exported senders. `global.fetch` is mocked in every single case: NO test in this file may ever
 * make a real network call, because a real call would send a real WhatsApp message to a real
 * phone and cost real money.
 *
 * "enabled" comes from the database (mocked via @/lib/settings) — "configured" (access token,
 * phone number ID, template names/language, API version) comes from process.env, stubbed
 * per-test via vi.stubEnv. These are two INDEPENDENT gates with distinct no-op reasons, covered
 * for both exported senders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/settings', () => ({ getNotificationSettings: vi.fn() }))

import { getNotificationSettings } from '@/lib/settings'
import { sendLowStockWhatsApp, sendOrderStatusWhatsApp } from './whatsapp'

const TEST_TOKEN = 'test-access-token-NEVER-LOG-ME'
const TEST_PHONE_NUMBER_ID = '123456789012345'
const GHANA_PHONE = '0241234567'
const NORMALIZED_GHANA_PHONE = '233241234567'
// Matches this repo's own seed data, which uses Nigerian numbers — toGhanaE164 rejects these.
const NON_GHANA_PHONE = '+2348012345678'

let fetchMock: ReturnType<typeof vi.fn>

const settingsMock = vi.mocked(getNotificationSettings)

/** The database-backed side: just the enabled toggle. */
function stubSettings(overrides: Record<string, unknown> = {}) {
  settingsMock.mockResolvedValue({
    whatsappEnabled: true,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

/** The env-backed side: everything else, exactly as production reads it. */
function stubWhatsAppEnv(overrides: Partial<Record<
  'accessToken' | 'phoneNumberId' | 'templateName' | 'lowStockTemplateName' | 'templateLanguage' | 'apiVersion',
  string
>> = {}) {
  const {
    accessToken = TEST_TOKEN,
    phoneNumberId = TEST_PHONE_NUMBER_ID,
    templateName = 'order_status_update',
    lowStockTemplateName = 'low_stock_alert',
    templateLanguage = 'en_US',
    apiVersion = 'v24.0',
  } = overrides
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', accessToken)
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', phoneNumberId)
  vi.stubEnv('WHATSAPP_TEMPLATE_NAME', templateName)
  vi.stubEnv('WHATSAPP_LOW_STOCK_TEMPLATE_NAME', lowStockTemplateName)
  vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', templateLanguage)
  vi.stubEnv('WHATSAPP_API_VERSION', apiVersion)
}

/** A `Response`-shaped stub — only the three members the sender actually touches. */
function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** The parsed JSON body of the Nth fetch call. */
function requestBodyOfCall(callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex]
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  stubSettings()
  stubWhatsAppEnv()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sendOrderStatusWhatsApp', () => {
  describe('settings-gated no-op — "configured" and "enabled" are independent', () => {
    it('no-ops without calling fetch when the access token is not set', async () => {
      stubWhatsAppEnv({ accessToken: '' })

      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, reason: 'whatsapp_not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops without calling fetch when the phone number ID is not set', async () => {
      stubWhatsAppEnv({ phoneNumberId: '' })

      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, reason: 'whatsapp_not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops with the distinct whatsapp_disabled reason when off despite valid credentials', async () => {
      stubSettings({ whatsappEnabled: false })

      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, reason: 'whatsapp_disabled' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('phone-normalization no-op', () => {
    it('no-ops without calling fetch when the phone cannot be normalized to a Ghana number', async () => {
      const result = await sendOrderStatusWhatsApp(NON_GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, reason: 'invalid_phone' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops on an empty phone string', async () => {
      const result = await sendOrderStatusWhatsApp('', 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, reason: 'invalid_phone' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('successful send', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(mockResponse(200, { messages: [{ id: 'wamid.TEST' }] }))
    })

    it('returns {success: true, data} on a 200', async () => {
      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: true, data: { messages: [{ id: 'wamid.TEST' }] } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('POSTs to the versioned Graph API messages URL for the configured phone number id', async () => {
      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`https://graph.facebook.com/v24.0/${TEST_PHONE_NUMBER_ID}/messages`)
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      })
    })

    it('sends the exact template-message body shape, with all 4 parameters in {{1}}–{{4}} order', async () => {
      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'READY', '12/25/2026')

      expect(requestBodyOfCall()).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: NORMALIZED_GHANA_PHONE,
        type: 'template',
        template: {
          name: 'order_status_update',
          language: { code: 'en_US' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ama' },          // {{1}} customer name
              { type: 'text', text: '42' },           // {{2}} shortId — NEVER the UUID
              { type: 'text', text: 'Ready for pickup/delivery' }, // {{3}} short status label
              { type: 'text', text: 'Due: 12/25/2026.' },          // {{4}} due-date note
            ],
          }],
        },
      })
    })

    it('sends the normalized phone number, not the raw local-format input', async () => {
      await sendOrderStatusWhatsApp('024 123 4567', 'Ama', 42, 'PENDING')

      expect(requestBodyOfCall().to).toBe(NORMALIZED_GHANA_PHONE)
    })

    it('falls back to "there" for {{1}} when no customer name is available', async () => {
      await sendOrderStatusWhatsApp(GHANA_PHONE, undefined, 42, 'PENDING')

      expect(requestBodyOfCall().template.components[0].parameters[0]).toEqual({ type: 'text', text: 'there' })
    })

    it('uses a single space — never an empty string — for {{4}} when there is no due date', async () => {
      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      const dueDateParam = requestBodyOfCall().template.components[0].parameters[3]
      expect(dueDateParam.text).toBe(' ')
      expect(dueDateParam.text).not.toBe('')
    })

    it('passes an unrecognized status through verbatim as {{3}} rather than dropping it', async () => {
      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'SOME_NEW_STATUS')

      expect(requestBodyOfCall().template.components[0].parameters[2]).toEqual({
        type: 'text',
        text: 'SOME_NEW_STATUS',
      })
    })

    it('honours a WHATSAPP_API_VERSION override without a code change', async () => {
      vi.stubEnv('WHATSAPP_API_VERSION', 'v25.0')

      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(fetchMock.mock.calls[0][0]).toBe(`https://graph.facebook.com/v25.0/${TEST_PHONE_NUMBER_ID}/messages`)
    })
  })

  describe('failure modes — never throws', () => {
    it('maps a non-2xx Graph API response to {success: false, reason: api_error, status, data}', async () => {
      const graphError = {
        error: { message: 'Template name does not exist', type: 'OAuthException', code: 100, fbtrace_id: 'Abc123' },
      }
      fetchMock.mockResolvedValue(mockResponse(400, graphError))

      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, reason: 'api_error', status: 400, data: graphError })
    })

    it('maps an unparseable success body to {success: true, data: null} without throwing', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not JSON') } })

      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: true, data: null })
    })

    it('catches a thrown fetch (network failure) and returns {success: false, error}', async () => {
      const networkError = new Error('ECONNREFUSED')
      fetchMock.mockRejectedValue(networkError)

      const result = await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(result).toEqual({ success: false, error: networkError })
    })

    it('resolves rather than rejects on a thrown fetch — no exception escapes to the fan-out', async () => {
      fetchMock.mockRejectedValue(new Error('boom'))

      await expect(sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')).resolves.toBeDefined()
    })
  })

  // PROACTIVE-001: no-secrets-in-logs matters because the real .env now holds genuine
  // credentials, so an accidental debug log would leak something that actually works.
  describe('no secrets in logs', () => {
    it('never logs the access token on an API-error failure path', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, { error: { message: 'Invalid OAuth access token' } }))

      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_TOKEN)
    })

    it('never logs the access token on a thrown-network-error path', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))

      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      expect(JSON.stringify(logged)).not.toContain(TEST_TOKEN)
    })
  })
})

describe('sendLowStockWhatsApp', () => {
  describe('settings-gated no-op — "configured" and "enabled" are independent', () => {
    it('no-ops without calling fetch when the access token is not set', async () => {
      stubWhatsAppEnv({ accessToken: '' })

      const result = await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(result).toEqual({ success: false, reason: 'whatsapp_not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops without calling fetch when the phone number ID is not set', async () => {
      stubWhatsAppEnv({ phoneNumberId: '' })

      const result = await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(result).toEqual({ success: false, reason: 'whatsapp_not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('no-ops with the distinct whatsapp_disabled reason when off despite valid credentials', async () => {
      stubSettings({ whatsappEnabled: false })

      const result = await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(result).toEqual({ success: false, reason: 'whatsapp_disabled' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('no-ops without calling fetch when the admin phone cannot be normalized', async () => {
    const result = await sendLowStockWhatsApp(NON_GHANA_PHONE, 'Rice', 3, 'kg')

    expect(result).toEqual({ success: false, reason: 'invalid_phone' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('successful send', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(mockResponse(200, { messages: [{ id: 'wamid.LOWSTOCK' }] }))
    })

    it('returns {success: true, data} on a 200', async () => {
      const result = await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(result).toEqual({ success: true, data: { messages: [{ id: 'wamid.LOWSTOCK' }] } })
    })

    it('targets WHATSAPP_LOW_STOCK_TEMPLATE_NAME with the 3 stock parameters in order', async () => {
      await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(requestBodyOfCall()).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: NORMALIZED_GHANA_PHONE,
        type: 'template',
        template: {
          name: 'low_stock_alert',
          language: { code: 'en_US' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: 'Rice' }, // {{1}} item name
              { type: 'text', text: '3' },    // {{2}} current stock
              { type: 'text', text: 'kg' },   // {{3}} unit
            ],
          }],
        },
      })
    })

    it('uses a template DISTINCT from the order-status one — they are independently configured', async () => {
      await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')
      await sendOrderStatusWhatsApp(GHANA_PHONE, 'Ama', 42, 'PENDING')

      expect(requestBodyOfCall(0).template.name).toBe('low_stock_alert')
      expect(requestBodyOfCall(1).template.name).toBe('order_status_update')
      expect(requestBodyOfCall(0).template.name).not.toBe(requestBodyOfCall(1).template.name)
    })

    // Regression guard: the two template settings must stay independent. Pointing the order-status
    // one somewhere else must not drag the low-stock alert along with it.
    it('does not read WHATSAPP_TEMPLATE_NAME for the low-stock alert', async () => {
      vi.stubEnv('WHATSAPP_TEMPLATE_NAME', 'some_other_order_template')

      await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(requestBodyOfCall().template.name).toBe('low_stock_alert')
    })
  })

  describe('failure modes — never throws', () => {
    it('maps a non-2xx response to {success: false, reason: api_error, status, data}', async () => {
      const graphError = { error: { message: 'Template not approved', type: 'OAuthException', code: 132001 } }
      fetchMock.mockResolvedValue(mockResponse(400, graphError))

      const result = await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

      expect(result).toEqual({ success: false, reason: 'api_error', status: 400, data: graphError })
    })

    it('catches a thrown fetch and returns {success: false, error} without rejecting', async () => {
      const networkError = new Error('ETIMEDOUT')
      fetchMock.mockRejectedValue(networkError)

      await expect(sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')).resolves.toEqual({
        success: false,
        error: networkError,
      })
    })
  })

  it('never logs the access token on a failure path', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { error: { message: 'Internal error' } }))

    await sendLowStockWhatsApp(GHANA_PHONE, 'Rice', 3, 'kg')

    const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
    expect(JSON.stringify(logged)).not.toContain(TEST_TOKEN)
  })
})
