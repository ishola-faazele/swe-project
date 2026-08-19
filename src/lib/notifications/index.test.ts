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
}))
vi.mock('./sms', () => ({
  sendOrderStatusSms: vi.fn().mockResolvedValue({ success: true, channel: 'sms' }),
  sendLowStockSms: vi.fn().mockResolvedValue({ success: true, channel: 'sms' }),
}))
vi.mock('./whatsapp', () => ({
  sendOrderStatusWhatsApp: vi.fn().mockResolvedValue({ success: true, channel: 'whatsapp' }),
  sendLowStockWhatsApp: vi.fn().mockResolvedValue({ success: true, channel: 'whatsapp' }),
}))

import { notifyLowStock, notifyOrderStatusChange } from './index'
import { sendLowStockAlert, sendOrderStatusEmail } from './email'
import { sendLowStockSms, sendOrderStatusSms } from './sms'
import { sendLowStockWhatsApp, sendOrderStatusWhatsApp } from './whatsapp'

const emailMock = vi.mocked(sendOrderStatusEmail)
const smsMock = vi.mocked(sendOrderStatusSms)
const whatsappMock = vi.mocked(sendOrderStatusWhatsApp)
const lowStockEmailMock = vi.mocked(sendLowStockAlert)
const lowStockSmsMock = vi.mocked(sendLowStockSms)
const lowStockWhatsappMock = vi.mocked(sendLowStockWhatsApp)

const ORDER = {
  customerEmail: 'ama@example.com',
  customerPhone: '0241234567',
  customerName: 'Ama',
  orderId: 'a3f9c1e2-0000-4000-8000-000000000000',
  orderShortId: 42,
  orderDescription: '40 pies, 40 bowls of jollof',
  newStatus: 'READY',
  dueDate: '12/25/2026',
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
    it('skips BOTH phone channels when customerPhone is absent, still attempting email', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerPhone: null })

      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).not.toHaveBeenCalled()
      expect(emailMock).toHaveBeenCalledTimes(1)
    })

    it('skips email when customerEmail is absent, still attempting BOTH phone channels', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerEmail: null })

      expect(emailMock).not.toHaveBeenCalled()
      expect(smsMock).toHaveBeenCalledTimes(1)
      expect(whatsappMock).toHaveBeenCalledTimes(1)
    })

    it('attempts nothing when the customer has neither contact method', async () => {
      const results = await notifyOrderStatusChange({ ...ORDER, customerEmail: null, customerPhone: null })

      expect(emailMock).not.toHaveBeenCalled()
      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).not.toHaveBeenCalled()
      expect(results).toEqual({})
    })

    it('treats an empty-string phone as absent rather than sending to it', async () => {
      await notifyOrderStatusChange({ ...ORDER, customerPhone: '' })

      expect(smsMock).not.toHaveBeenCalled()
      expect(whatsappMock).not.toHaveBeenCalled()
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
  const LOW_STOCK = { itemName: 'Rice', currentStock: 3, unit: 'kg', adminEmail: 'owner@example.com', adminPhone: '0241234567' }

  it('attempts all three channels exactly once when both adminEmail and adminPhone are present', async () => {
    await notifyLowStock(LOW_STOCK)

    expect(lowStockEmailMock).toHaveBeenCalledTimes(1)
    expect(lowStockSmsMock).toHaveBeenCalledTimes(1)
    expect(lowStockWhatsappMock).toHaveBeenCalledTimes(1)
  })

  it('passes the same item details to both phone channels', async () => {
    await notifyLowStock(LOW_STOCK)

    expect(lowStockSmsMock).toHaveBeenCalledWith('0241234567', 'Rice', 3, 'kg')
    expect(lowStockWhatsappMock).toHaveBeenCalledWith('0241234567', 'Rice', 3, 'kg')
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
    // ADMIN_ALERT_PHONE unset is a real deployed state, so this branch is the common one today.
    it('skips BOTH phone channels when adminPhone is absent, still attempting email', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminPhone: undefined })

      expect(lowStockSmsMock).not.toHaveBeenCalled()
      expect(lowStockWhatsappMock).not.toHaveBeenCalled()
      expect(lowStockEmailMock).toHaveBeenCalledTimes(1)
    })

    it('treats an empty-string adminPhone as absent rather than sending to it', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminPhone: '' })

      expect(lowStockSmsMock).not.toHaveBeenCalled()
      expect(lowStockWhatsappMock).not.toHaveBeenCalled()
    })

    it('skips email when adminEmail is absent, still attempting BOTH phone channels', async () => {
      await notifyLowStock({ ...LOW_STOCK, adminEmail: undefined })

      expect(lowStockEmailMock).not.toHaveBeenCalled()
      expect(lowStockSmsMock).toHaveBeenCalledTimes(1)
      expect(lowStockWhatsappMock).toHaveBeenCalledTimes(1)
    })

    it('attempts nothing when neither admin contact method is configured', async () => {
      const results = await notifyLowStock({ ...LOW_STOCK, adminEmail: undefined, adminPhone: undefined })

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
