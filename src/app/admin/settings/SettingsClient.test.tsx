/**
 * Component tests for SettingsClient.
 *
 * Focused on the two properties that are easy to silently break and hard to catch any other way:
 * a stored secret must never reach the rendered DOM, and the Phone-login toggle must be genuinely
 * `disabled` (not merely dimmed) until SMS can actually deliver a code.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./actions', () => ({
  updateNotificationSettings: vi.fn(),
  updateLoginSettings: vi.fn(),
}))

import { SettingsClient } from './SettingsClient'
import type { MaskedNotificationSettings } from '@/lib/settings'
import type { LoginSettings } from '@prisma/client'

const REAL_SECRET = 'sk_live_super-secret-value-NEVER-RENDER-ME'

function notifications(overrides: Partial<MaskedNotificationSettings> = {}): MaskedNotificationSettings {
  return {
    fromEmail: 'orders@example.com',
    arkeselSenderId: 'Rostty',
    whatsappPhoneNumberId: '123456789012345',
    whatsappTemplateName: 'order_status_update',
    whatsappLowStockTemplateName: 'low_stock_alert',
    whatsappTemplateLanguage: 'en',
    emailEnabled: true,
    smsEnabled: true,
    whatsappEnabled: true,
    resendApiKeySet: true,
    arkeselApiKeySet: true,
    whatsappAccessTokenSet: true,
    whatsappAppSecretSet: true,
    whatsappWebhookVerifyTokenSet: true,
    ...overrides,
  }
}

function login(overrides: Partial<LoginSettings> = {}): LoginSettings {
  return {
    id: 'login-1',
    emailLoginEnabled: true,
    phoneLoginEnabled: false,
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('masked secrets', () => {
  it('renders a masked placeholder for a configured secret and never a real value', () => {
    render(
      <SettingsClient initialNotifications={notifications()} initialLogin={login()} />
    )

    // The masked shape cannot even carry a raw secret, but assert on the DOM as the last line of
    // defense against a future change that starts passing one through.
    expect(screen.queryByDisplayValue(REAL_SECRET)).toBeNull()
    expect(document.body.textContent).not.toContain(REAL_SECRET)
    expect(screen.getAllByPlaceholderText('•••• saved').length).toBeGreaterThan(0)
  })

  it('shows "Not set" for a secret that has never been configured', () => {
    render(
      <SettingsClient
        initialNotifications={notifications({ arkeselApiKeySet: false })}
        initialLogin={login()}
      />
    )

    expect(screen.getAllByPlaceholderText('Not set').length).toBeGreaterThan(0)
  })

  it('renders secret inputs empty, so an untouched save submits blank and keeps the stored value', () => {
    render(
      <SettingsClient initialNotifications={notifications()} initialLogin={login()} />
    )

    const apiKeyInput = screen.getByLabelText('API key', { selector: '#arkeselApiKey' })
    expect((apiKeyInput as HTMLInputElement).value).toBe('')
  })

  it('round-trips non-secret configuration into editable fields', () => {
    render(
      <SettingsClient initialNotifications={notifications()} initialLogin={login()} />
    )

    expect(screen.getByDisplayValue('orders@example.com')).toBeDefined()
    expect(screen.getByDisplayValue('Rostty')).toBeDefined()
    expect(screen.getByDisplayValue('order_status_update')).toBeDefined()
  })
})

/**
 * Base UI renders Switch.Root as a <span role="switch"> plus a hidden <input type="checkbox">, so
 * "disabled" surfaces as aria-disabled/data-disabled on the span, not as a `disabled` prop on the
 * span itself. aria-disabled is what a screen reader announces — the difference between genuinely
 * disabled and merely dimmed.
 *
 * Tabs only mount the selected panel, so the Login toggles do not exist in the DOM until the Login
 * tab is actually activated. Each test below switches to it first.
 */
async function renderOnLoginTab(props: Parameters<typeof SettingsClient>[0]) {
  render(<SettingsClient {...props} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Login' }))
}

function phoneLoginToggle() {
  return screen.getByRole('switch', { name: 'Phone login' })
}

describe('phone-login toggle gating', () => {
  it('is disabled with an explanation when SMS is enabled but has no API key', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: true, arkeselApiKeySet: false }),
      initialLogin: login(),
    })

    expect(phoneLoginToggle().getAttribute('aria-disabled')).toBe('true')
    expect(phoneLoginToggle().hasAttribute('data-disabled')).toBe(true)
    expect(document.body.textContent).toContain('Turn on SMS and save an Arkesel API key first')
  })

  it('is disabled when the SMS channel itself is switched off', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: false, arkeselApiKeySet: true }),
      initialLogin: login(),
    })

    expect(phoneLoginToggle().getAttribute('aria-disabled')).toBe('true')
  })

  it('is enabled once SMS is on and keyed', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: true, arkeselApiKeySet: true }),
      initialLogin: login(),
    })

    expect(phoneLoginToggle().getAttribute('aria-disabled')).not.toBe('true')
    expect(phoneLoginToggle().hasAttribute('data-disabled')).toBe(false)
    expect(document.body.textContent).not.toContain('Turn on SMS and save an Arkesel API key first')
  })

  it('leaves the other channel toggles interactive regardless', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: false, arkeselApiKeySet: false }),
      initialLogin: login(),
    })

    expect(screen.getByRole('switch', { name: 'Email login' }).getAttribute('aria-disabled')).not.toBe('true')
  })
})
