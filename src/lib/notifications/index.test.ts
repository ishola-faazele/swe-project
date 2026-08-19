/**
 * Unit tests for src/lib/notifications/index.ts — the fan-out control flow.
 *
 * This is the file that actually proves "all three channels, every time". It mocks the three
 * channel modules (`./email`, `./sms`, `./whatsapp`) INDIVIDUALLY and imports the barrel for
 * real, so the fan-out logic under test genuinely executes. That distinction is the whole point:
 * every integration test mocks the `@/lib/notifications` barrel wholesale, which makes it
 * structurally impossible for any of them to observe what happens *inside* this module.
 *
 * No fetch mocking is needed here — the senders themselves never run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./email', () => ({
  sendOrderStatusEmail: vi.fn().mockResolvedValue({ success: true, channel: 'email' }),
  sendLowStockAlert: vi.fn().mockResolvedValue({ success: true, channel: 'email' }),
  sendAccountCreatedEmail: vi.fn().mockResolvedValue({ success: true, channel: 'email' }),
}))
vi.mock('./sms', () => ({
  sendOrderStatusSms: vi.fn().mockResolvedValue({ success: true, channel: 'sms' }),
  sendLowStockSms: vi.fn().mockResolvedValue({ success: true, channel: 'sms' }),
  sendSms: vi.fn().mockResolvedValue({ success: true, channel: 'sms' }),
}))
vi.mock('./whatsapp', () => ({
  sendOrderStatusWhatsApp: vi.fn().mockResolvedValue({ success: true, channel: 'whatsapp' }),
  sendLowStockWhatsApp: vi.fn().mockResolvedValue({ success: true, channel: 'whatsapp' }),
}))

import { notifyAccountCreated, notifyLowStock, notifyOrderStatusChange } from './index'
import { sendAccountCreatedEmail, sendLowStockAlert, sendOrderStatusEmail } from './email'
import { sendLowStockSms, sendOrderStatusSms, sendSms } from './sms'
import { sendLowStockWhatsApp, sendOrderStatusWhatsApp } from './whatsapp'

const emailMock = vi.mocked(sendOrderStatusEmail)
const smsMock = vi.mocked(sendOrderStatusSms)
const whatsappMock = vi.mocked(sendOrderStatusWhatsApp)
const lowStockEmailMock = vi.mocked(sendLowStockAlert)
const lowStockSmsMock = vi.mocked(sendLowStockSms)
const lowStockWhatsappMock = vi.mocked(sendLowStockWhatsApp)
const accountCreatedEmailMock = vi.mocked(sendAccountCreatedEmail)
const genericSmsMock = vi.mocked(sendSms)

// customerPhone (SMS) and customerWhatsapp are DELIBERATELY the same value in this default
// fixture, so every existing assertion built around '0241234567' still holds — the tests that
// specifically exercise the two as independent destinations set them differently themselves.
const ORDER = {
  customerEmail: 'ama@example.com',
  customerPhone: '0241234567',
  customerWhatsapp: '0241234567',
  customerName: 'Ama',
  orderId: 'a3f9c1e2-0000-4000-8000-000000000000',
  orderShortId: 42,
  orderDescription: '40 pies, 40 bowls of jollof',
  newStatus: 'READY',
  dueDate: '12/25/2026',
  notifyByEmail: true,
  notifyBySms: true,
  notifyByWhatsapp: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notifyOrderStatusChange', () => {
  it('attempts all three channels exactly once when both email and phone are present', async () => {
    await notifyOrderStatusChange(ORDER)

    expect(emailMock).toHaveBeenCalledTimes(1)
    expect(smsMock).toHaveBeenCalledTimes(1)
    expect(whatsappMock).toHaveBeenCalledTimes(1)
  })

  it('returns every channel result keyed by channel', async () => {
    const results = await notifyOrderStatusChange(ORDER)

    expect(results).toEqual({
      email: { success: true, channel: 'email' },
      sms: { success: true, channel: 'sms' },
      whatsapp: { success: true, channel: 'whatsapp' },
    })
  })

  it('forwards the SAME orderShortId to both phone channels', async () => {
    await notifyOrderStatusChange({ ...ORDER, orderShortId: 99 })

    // SMS signature: (phone, orderShortId, orderDescription, newStatus)
    expect(smsMock).toHaveBeenCalledWith('0241234567', 99, ORDER.orderDescription, 'READY')
    // WhatsApp signature: (phone, customerName, orderShortId, newStatus, dueDate)
    expect(whatsappMock).toHaveBeenCalledWith('0241234567', 'Ama', 99, 'READY', '12/25/2026')

    const smsShortId = smsMock.mock.calls[0][1]
    const whatsappShortId = whatsappMock.mock.calls[0][2]
    expect(smsShortId).toBe(whatsappShortId)
    expect(smsShortId).toBe(99)
  })

  it('never passes the order UUID to a customer-facing phone channel', async () => {
    await notifyOrderStatusChange(ORDER)

    expect(JSON.stringify(smsMock.mock.calls)).not.toContain(ORDER.orderId)
    expect(JSON.stringify(whatsappMock.mock.calls)).not.toContain(ORDER.orderId)
  })

  it('passes the UUID (not the shortId) to email, whose shape is unchanged by this phase', async () => {
    await notifyOrderStatusChange(ORDER)

    expect(emailMock).toHaveBeenCalledWith({
      customerEmail: 'ama@example.com',
      customerName: 'Ama',
      orderId: ORDER.orderId,
      orderDescription: ORDER.orderDescription,
      newStatus: 'READY',
      dueDate: '12/25/2026',
    })
    // email.ts is deliberately out of scope this phase — it must not receive orderShortId.
    expect(emailMock.mock.calls[0][0]).not.toHaveProperty('orderShortId')
  })

  describe('per-contact-method guards', () => {
    it('skips SMS when customerPhone is absent, still attempting email and WhatsApp', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerPhone: null })

      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).toHaveBeenCalledTimes(1)
      expect(emailMock).toHaveBeenCalledTimes(1)
    })

    it('skips WhatsApp when customerWhatsapp is absent, still attempting email and SMS', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerWhatsapp: null })

      expect(whatsappMock).not.toHaveBeenCalled()
      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(emailMock).toHaveBeenCalledTimes(1)
    })

    it('sends SMS to customerPhone and WhatsApp to customerWhatsapp — two distinct destinations', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerPhone: '0241111111', customerWhatsapp: '0242222222' })

      expect(smsMock).toHaveBeenCalledWith('0241111111', 42, ORDER.orderDescription, 'READY')
      expect(whatsappMock).toHaveBeenCalledWith('0242222222', 'Ama', 42, 'READY', '12/25/2026')
    })

    it('skips email when customerEmail is absent, still attempting BOTH phone channels', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerEmail: null })

      expect(emailMock).not.toHaveBeenCalled()
      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })

    it('attempts nothing when the customer has no contact method on any channel', async () => {
      const results = await notifyOrderStatusChange({
        ...ORDER,
        customerEmail: null,
        customerPhone: null,
        customerWhatsapp: null,
      })

      expect(emailMock).not.toHaveBeenCalled()
      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).not.toHaveBeenCalled()
      expect(results).toEqual({})
    })

    it('treats an empty-string phone/whatsapp as absent rather than sending to it', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerPhone: '', customerWhatsapp: '' })

      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).not.toHaveBeenCalled()
    })
  })

  describe('per-customer channel opt-out', () => {
    it('skips email when the customer has opted out, still attempting both phone channels', async () => {
      await notifyOrderStatusChange({ ...ORDER, notifyByEmail: false })

      expect(emailMock).not.toHaveBeenCalled()
      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })

    it('skips SMS but still sends WhatsApp when the customer opted out of SMS only', async () => {
      await notifyOrderStatusChange({ ...ORDER, notifyBySms: false })

      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).toHaveBeenCalledTimes(1)
      expect(emailMock).toHaveBeenCalledTimes(1)
    })

    it('skips WhatsApp but still sends SMS when the customer opted out of WhatsApp only', async () => {
      await notifyOrderStatusChange({ ...ORDER, notifyByWhatsapp: false })

      expect(whatsappMock).not.toHaveBeenCalled()
      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(emailMock).toHaveBeenCalledTimes(1)
    })

    it('attempts nothing when every channel is opted out, even with both contact methods present', async () => {
      const results = await notifyOrderStatusChange({
        ...ORDER,
        notifyByEmail: false,
        notifyBySms: false,
        notifyByWhatsapp: false,
      })

      expect(emailMock).not.toHaveBeenCalled()
      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).not.toHaveBeenCalled()
      expect(results).toEqual({})
    })
  })

  describe('"send both, always" — no primary/fallback branching', () => {
    it('still attempts WhatsApp when SMS reports a failure', async () => {
      smsMock.mockResolvedValueOnce({ success: false, reason: 'sms_not_configured' })

      await notifyOrderStatusChange(ORDER)

      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })

    it('still attempts WhatsApp when SMS succeeds — WhatsApp is not a fallback', async () => {
      smsMock.mockResolvedValueOnce({ success: true, data: {} })

      await notifyOrderStatusChange(ORDER)

      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })

    // A phone that fails Ghana E.164 normalization is a per-channel concern handled one level
    // down (each sender calls toGhanaE164 itself, see phone.test.ts/sms.test.ts/whatsapp.test.ts)
    // — index.ts's own guard is presence-only, so one channel's normalization failure must not
    // suppress the other. Distinct from the 'sms_not_configured' case above: this specifically
    // exercises the reason a real, oddly-formatted customer number would produce.
    it('still attempts WhatsApp when SMS no-ops with invalid_phone, and vice versa', async () => {
      smsMock.mockResolvedValueOnce({ success: false, reason: 'invalid_phone' })

      await notifyOrderStatusChange(ORDER)

      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(whatsappMock).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      whatsappMock.mockResolvedValueOnce({ success: false, reason: 'invalid_phone' })

      await notifyOrderStatusChange(ORDER)

      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })

    it('still attempts both phone channels when email fails', async () => {
      emailMock.mockResolvedValueOnce({ success: false, reason: 'no_api_key' })

      await notifyOrderStatusChange(ORDER)

      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })
  })

  it('forwards a null dueDate through to WhatsApp rather than dropping the argument', async () => {
    await notifyOrderStatusChange({ ...ORDER, dueDate: null })

    expect(whatsappMock).toHaveBeenCalledWith('0241234567', 'Ama', 42, 'READY', null)
  })
})

describe('notifyLowStock', () => {
  // adminPhone (SMS) and adminWhatsapp are DELIBERATELY different values in this fixture — they
  // are two independently-settable alert contacts (see NotificationSettings' schema comment), not
  // one phone number shared by two channels.
  const LOW_STOCK = {
    itemName: 'Rice',
    currentStock: 3,
    unit: 'kg',
    adminEmail: 'owner@example.com',
    adminPhone: '0241234567',
    adminWhatsapp: '0207654321',
  }

  it('attempts all three channels exactly once when every contact is configured', async () => {
    await notifyLowStock(LOW_STOCK)

    expect(lowStockEmailMock).toHaveBeenCalledTimes(1)
    expect(lowStockSmsMock).toHaveBeenCalledTimes(1)
    expect(lowStockWhatsappMock).toHaveBeenCalledTimes(1)
  })

  it('sends SMS to adminPhone and WhatsApp to adminWhatsapp — two distinct destinations', async () => {
    await notifyLowStock(LOW_STOCK)

    expect(lowStockSmsMock).toHaveBeenCalledWith('0241234567', 'Rice', 3, 'kg')
    expect(lowStockWhatsappMock).toHaveBeenCalledWith('0207654321', 'Rice', 3, 'kg')
  })

  it('returns every channel result keyed by channel', async () => {
    const results = await notifyLowStock(LOW_STOCK)

    expect(results).toEqual({
      email: { success: true, channel: 'email' },
      sms: { success: true, channel: 'sms' },
      whatsapp: { success: true, channel: 'whatsapp' },
    })
  })

  describe('per-contact-method guards', () => {
    // A blank alert contact is a real, common state — the admin can toggle a channel on before
    // ever filling in its destination at /admin/settings.
    it('skips SMS when adminPhone is absent, still attempting email and WhatsApp', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminPhone: undefined })

      expect(lowStockSmsMock).not.toHaveBeenCalled()
      expect(lowStockEmailMock).toHaveBeenCalledTimes(1)
      expect(lowStockWhatsappMock).toHaveBeenCalledTimes(1)
    })

    it('skips WhatsApp when adminWhatsapp is absent, still attempting email and SMS', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminWhatsapp: undefined })

      expect(lowStockWhatsappMock).not.toHaveBeenCalled()
      expect(lowStockEmailMock).toHaveBeenCalledTimes(1)
      expect(lowStockSmsMock).toHaveBeenCalledTimes(1)
    })

    it('treats an empty-string adminPhone/adminWhatsapp as absent rather than sending to it', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminPhone: '', adminWhatsapp: '' })

      expect(lowStockSmsMock).not.toHaveBeenCalled()
      expect(lowStockWhatsappMock).not.toHaveBeenCalled()
    })

    it('skips email when adminEmail is absent, still attempting BOTH phone channels', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminEmail: undefined })

      expect(lowStockEmailMock).not.toHaveBeenCalled()
      expect(lowStockSmsMock).toHaveBeenCalledTimes(1)
      expect(lowStockWhatsappMock).toHaveBeenCalledTimes(1)
    })

    it('attempts nothing when no admin contact method is configured', async () => {
      const results = await notifyLowStock({
        ...LOW_STOCK,
        adminEmail: undefined,
        adminPhone: undefined,
        adminWhatsapp: undefined,
      })

      expect(lowStockEmailMock).not.toHaveBeenCalled()
      expect(lowStockSmsMock).not.toHaveBeenCalled()
      expect(lowStockWhatsappMock).not.toHaveBeenCalled()
      expect(results).toEqual({})
    })
  })

  it('still attempts WhatsApp when the low-stock SMS fails', async () => {
    lowStockSmsMock.mockResolvedValueOnce({ success: false, reason: 'invalid_phone' })

    await notifyLowStock(LOW_STOCK)

    expect(lowStockWhatsappMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * notifyAccountCreated — EMAIL + SMS only, never WhatsApp.
 *
 * The two branches are mutually exclusive and neither is a fallback for the other: each is gated
 * purely on preferredLoginMethod plus its own contact field. Note this describe block asserts
 * against ./email and ./sms only — ./whatsapp is deliberately never involved.
 */
describe('notifyAccountCreated', () => {
  const MAGIC_LINK = 'https://rostty.example.com/auth/confirm?token_hash=abc123&type=signup'

  it('EMAIL-preferred with an email and a link sends the email once and never an SMS', async () => {
    await notifyAccountCreated({
      customerName: 'Ama',
      customerEmail: 'ama@example.com',
      customerPhone: null,
      preferredLoginMethod: 'EMAIL',
      magicLink: MAGIC_LINK,
    })

    expect(accountCreatedEmailMock).toHaveBeenCalledTimes(1)
    expect(accountCreatedEmailMock).toHaveBeenCalledWith({
      to: 'ama@example.com',
      name: 'Ama',
      magicLink: MAGIC_LINK,
    })
    expect(genericSmsMock).not.toHaveBeenCalled()
  })

  it('PHONE-preferred with a phone sends one SMS and never an email', async () => {
    await notifyAccountCreated({
      customerName: 'Kofi',
      customerEmail: null,
      customerPhone: '0241234567',
      preferredLoginMethod: 'PHONE',
      magicLink: null,
    })

    expect(genericSmsMock).toHaveBeenCalledTimes(1)
    expect(accountCreatedEmailMock).not.toHaveBeenCalled()
    expect(emailMock).not.toHaveBeenCalled()
  })

  it('points the SMS copy at the real site URL rather than a vague instruction', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://rostty.example.com')

    await notifyAccountCreated({
      customerName: 'Kofi',
      customerPhone: '0241234567',
      preferredLoginMethod: 'PHONE',
    })

    const { message } = genericSmsMock.mock.calls[0][0]
    expect(message).toContain('https://rostty.example.com/login')
    // Never a pre-issued code — one sent at creation time would likely expire before use.
    expect(message).not.toMatch(/\b\d{6}\b/)
    vi.unstubAllEnvs()
  })

  // createCustomerSchema legitimately allows a name-only customer.
  it('no-ops cleanly for a name-only customer, firing neither channel and never throwing', async () => {
    const results = await notifyAccountCreated({
      customerName: 'Nameless',
      customerEmail: null,
      customerPhone: null,
      preferredLoginMethod: 'EMAIL',
      magicLink: null,
    })

    expect(results).toEqual({})
    expect(accountCreatedEmailMock).not.toHaveBeenCalled()
    expect(genericSmsMock).not.toHaveBeenCalled()
  })

  it('no-ops when EMAIL-preferred but the magic link could not be generated', async () => {
    const results = await notifyAccountCreated({
      customerEmail: 'ama@example.com',
      preferredLoginMethod: 'EMAIL',
      magicLink: null,
    })

    expect(results).toEqual({})
    expect(accountCreatedEmailMock).not.toHaveBeenCalled()
  })

  it('does not fall back to email when a PHONE-preferred customer also has one on file', async () => {
    await notifyAccountCreated({
      customerEmail: 'both@example.com',
      customerPhone: '0241234567',
      preferredLoginMethod: 'PHONE',
      magicLink: MAGIC_LINK,
    })

    expect(genericSmsMock).toHaveBeenCalledTimes(1)
    expect(accountCreatedEmailMock).not.toHaveBeenCalled()
  })

  // Fire-and-forget: a disabled channel is a resolved no-op result, not a rejection.
  it('resolves cleanly when the SMS channel reports itself disabled', async () => {
    genericSmsMock.mockResolvedValueOnce({ success: false, reason: 'sms_disabled' })

    const results = await notifyAccountCreated({
      customerPhone: '0241234567',
      preferredLoginMethod: 'PHONE',
    })

    expect(results.sms).toEqual({ success: false, reason: 'sms_disabled' })
  })
})
