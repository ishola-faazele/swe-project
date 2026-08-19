/**
 * Unit tests for src/lib/notifications/email.ts.
 *
 * The `resend` SDK is mocked wholesale: NO test here may construct a real client or make a real
 * network call. "enabled" comes from the database (mocked @/lib/settings); "configured" (the API
 * key/from-address) comes from process.env, stubbed per-test via vi.stubEnv.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.fn()
const resendConstructorMock = vi.fn()

vi.mock('resend', () => ({
  Resend: class {
    emails: { send: typeof sendMock }
    constructor(apiKey: string) {
      resendConstructorMock(apiKey)
      this.emails = { send: sendMock }
    }
  },
}))
vi.mock('@/lib/settings', () => ({ getNotificationSettings: vi.fn() }))

import { getNotificationSettings } from '@/lib/settings'
import { sendAccountCreatedEmail, sendLowStockAlert, sendOrderStatusEmail } from './email'

const settingsMock = vi.mocked(getNotificationSettings)

const TEST_API_KEY = 'test-resend-key-NEVER-LOG-ME'
const TEST_FROM = 'Chop with Rostty <orders@example.com>'

/** The database-backed side: just the enabled toggle. */
function stubSettings(overrides: Record<string, unknown> = {}) {
  settingsMock.mockResolvedValue({
    emailEnabled: true,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

/** The env-backed side: the actual credentials, exactly as production reads them. */
function stubResendEnv({ apiKey = TEST_API_KEY, from = TEST_FROM }: { apiKey?: string; from?: string } = {}) {
  vi.stubEnv('RESEND_API_KEY', apiKey)
  vi.stubEnv('FROM_EMAIL', from)
}

const ORDER = {
  customerEmail: 'ama@example.com',
  customerName: 'Ama',
  orderId: 'a3f9c1e2-0000-4000-8000-000000000000',
  orderDescription: '40 pies, 40 bowls of jollof',
  newStatus: 'READY',
  dueDate: '12/25/2026',
}

/** The single email argument the most recent send received. */
function sentEmail() {
  return sendMock.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  stubSettings()
  stubResendEnv()
  sendMock.mockResolvedValue({ id: 'email-id' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('settings-gated no-op — "configured" and "enabled" are independent', () => {
  it('sendOrderStatusEmail no-ops with email_disabled and constructs no client', async () => {
    stubSettings({ emailEnabled: false })

    const result = await sendOrderStatusEmail(ORDER)

    expect(result).toEqual({ success: false, reason: 'email_disabled' })
    expect(resendConstructorMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sendLowStockAlert no-ops with email_disabled and constructs no client', async () => {
    stubSettings({ emailEnabled: false })

    const result = await sendLowStockAlert('Rice', 3, 'kg', 'admin@example.com')

    expect(result).toEqual({ success: false, reason: 'email_disabled' })
    expect(resendConstructorMock).not.toHaveBeenCalled()
  })

  it('sendAccountCreatedEmail no-ops with email_disabled and constructs no client', async () => {
    stubSettings({ emailEnabled: false })

    const result = await sendAccountCreatedEmail({
      to: 'ama@example.com',
      name: 'Ama',
      magicLink: 'https://example.com/auth/confirm?token_hash=abc&type=signup',
    })

    expect(result).toEqual({ success: false, reason: 'email_disabled' })
    expect(resendConstructorMock).not.toHaveBeenCalled()
  })

  it('no-ops with the existing no_api_key reason when the key is absent but the channel is on', async () => {
    stubResendEnv({ apiKey: '' })

    await expect(sendOrderStatusEmail(ORDER)).resolves.toEqual({ success: false, reason: 'no_api_key' })
    await expect(sendLowStockAlert('Rice', 3, 'kg', 'admin@example.com')).resolves.toEqual({
      success: false,
      reason: 'no_api_key',
    })
    expect(resendConstructorMock).not.toHaveBeenCalled()
  })
})

// THE regression test for the singleton-cache removal. The API key can be rotated in .env with a
// redeploy; a lingering module-scope client would keep using the first key it ever saw.
describe('constructs a fresh Resend client per call, never a cached one', () => {
  it('uses each distinct key in sequence rather than the first one twice', async () => {
    stubResendEnv({ apiKey: 'first-key' })
    await sendOrderStatusEmail(ORDER)

    stubResendEnv({ apiKey: 'second-key-after-rotation' })
    await sendOrderStatusEmail(ORDER)

    expect(resendConstructorMock).toHaveBeenCalledTimes(2)
    expect(resendConstructorMock).toHaveBeenNthCalledWith(1, 'first-key')
    expect(resendConstructorMock).toHaveBeenNthCalledWith(2, 'second-key-after-rotation')
  })

  it('picks up a rotated key across two different senders too', async () => {
    stubResendEnv({ apiKey: 'first-key' })
    await sendOrderStatusEmail(ORDER)

    stubResendEnv({ apiKey: 'second-key-after-rotation' })
    await sendLowStockAlert('Rice', 3, 'kg', 'admin@example.com')

    expect(resendConstructorMock).toHaveBeenNthCalledWith(2, 'second-key-after-rotation')
  })
})

describe('sendOrderStatusEmail', () => {
  it('sends from the configured FROM_EMAIL to the customer', async () => {
    await sendOrderStatusEmail(ORDER)

    expect(sentEmail().from).toBe(TEST_FROM)
    expect(sentEmail().to).toBe('ama@example.com')
  })

  it('falls back to the default from-address when none is set', async () => {
    stubResendEnv({ from: '' })

    await sendOrderStatusEmail(ORDER)

    expect(sentEmail().from).toBe('Chop with Rostty <onboarding@resend.dev>')
  })

  it('returns {success: true, data} on a successful send', async () => {
    const result = await sendOrderStatusEmail(ORDER)

    expect(result).toEqual({ success: true, data: { id: 'email-id' } })
  })

  it('catches a thrown send and returns {success: false, error} without rejecting', async () => {
    const apiError = new Error('Resend is down')
    sendMock.mockRejectedValue(apiError)

    await expect(sendOrderStatusEmail(ORDER)).resolves.toEqual({ success: false, error: apiError })
  })
})

describe('sendLowStockAlert', () => {
  it('sends to the admin address with the item in the subject', async () => {
    await sendLowStockAlert('Rice', 3, 'kg', 'admin@example.com')

    expect(sentEmail().to).toBe('admin@example.com')
    expect(sentEmail().subject).toContain('Rice')
  })

  it('catches a thrown send rather than rejecting', async () => {
    sendMock.mockRejectedValue(new Error('boom'))

    await expect(sendLowStockAlert('Rice', 3, 'kg', 'admin@example.com')).resolves.toMatchObject({
      success: false,
    })
  })
})

describe('sendAccountCreatedEmail', () => {
  const MAGIC_LINK = 'https://rostty.example.com/auth/confirm?token_hash=abc123&type=signup'

  it('embeds the magic link it was handed, verbatim', async () => {
    await sendAccountCreatedEmail({ to: 'ama@example.com', name: 'Ama', magicLink: MAGIC_LINK })

    expect(sentEmail().html).toContain(MAGIC_LINK)
  })

  it('sends to the customer from the configured from-address', async () => {
    await sendAccountCreatedEmail({ to: 'ama@example.com', name: 'Ama', magicLink: MAGIC_LINK })

    expect(sentEmail().to).toBe('ama@example.com')
    expect(sentEmail().from).toBe(TEST_FROM)
  })

  it('greets by name when one is given, and falls back gracefully when not', async () => {
    await sendAccountCreatedEmail({ to: 'ama@example.com', name: 'Ama', magicLink: MAGIC_LINK })
    expect(sentEmail().html).toContain('Ama')

    sendMock.mockClear()
    await sendAccountCreatedEmail({ to: 'ama@example.com', name: null, magicLink: MAGIC_LINK })
    expect(sentEmail().html).toContain('there')
  })

  // No hard-coded fallback URL: an email whose only call to action is a broken link is worse than
  // one the caller chose not to send at all.
  it('contains no URL other than the one passed in', async () => {
    await sendAccountCreatedEmail({ to: 'ama@example.com', name: 'Ama', magicLink: MAGIC_LINK })

    const hrefs = [...String(sentEmail().html).matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual([MAGIC_LINK])
  })

  it('returns {success: true, data} on a successful send', async () => {
    const result = await sendAccountCreatedEmail({
      to: 'ama@example.com',
      name: 'Ama',
      magicLink: MAGIC_LINK,
    })

    expect(result).toEqual({ success: true, data: { id: 'email-id' } })
  })

  it('never throws — a Resend failure comes back as {success: false, error}', async () => {
    const apiError = new Error('Resend rejected the request')
    sendMock.mockRejectedValue(apiError)

    await expect(
      sendAccountCreatedEmail({ to: 'ama@example.com', name: 'Ama', magicLink: MAGIC_LINK })
    ).resolves.toEqual({ success: false, error: apiError })
  })
})

describe('no secrets in logs', () => {
  it('never logs the API key on a failure path', async () => {
    sendMock.mockRejectedValue(new Error('boom'))

    await sendOrderStatusEmail(ORDER)

    const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
    expect(JSON.stringify(logged)).not.toContain(TEST_API_KEY)
  })

  it('never logs the API key on a no-op path', async () => {
    stubSettings({ emailEnabled: false })

    await sendOrderStatusEmail(ORDER)

    const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
    expect(JSON.stringify(logged)).not.toContain(TEST_API_KEY)
  })
})
