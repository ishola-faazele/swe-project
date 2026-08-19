/**
 * Component tests for SettingsClient.
 *
 * Focused on the property that's easy to silently break and hard to catch any other way: the
 * Phone-login toggle must be genuinely `disabled` (not merely dimmed) until SMS can actually
 * deliver a code — gated on BOTH the smsEnabled toggle and the server-computed
 * arkeselConfigured prop (a client component can't read env vars itself).
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./actions', () => ({
  updateNotificationSettings: vi.fn(),
  updateLoginSettings: vi.fn(),
}))

import { SettingsClient } from './SettingsClient'
import type { LoginSettings, NotificationSettings } from '@prisma/client'

function notifications(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    id: 'settings-1',
    emailEnabled: true,
    smsEnabled: true,
    whatsappEnabled: true,
    updatedAt: new Date(),
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

describe('notification channel toggles', () => {
  it('renders one toggle per channel, reflecting initial state, with no credential inputs', () => {
    render(
      <SettingsClient
        initialNotifications={notifications({ emailEnabled: true, smsEnabled: false, whatsappEnabled: true })}
        initialLogin={login()}
        arkeselConfigured
      />
    )

    expect(screen.getByRole('switch', { name: 'Email notifications' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'SMS notifications' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'WhatsApp notifications' }).getAttribute('aria-checked')).toBe('true')
    // The whole point of this correction: no API key/token/sender-ID input exists anywhere.
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByLabelText(/access token/i)).toBeNull()
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
  it('is disabled with an explanation when SMS is enabled but Arkesel is not configured', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: true }),
      initialLogin: login(),
      arkeselConfigured: false,
    })

    expect(phoneLoginToggle().getAttribute('aria-disabled')).toBe('true')
    expect(phoneLoginToggle().hasAttribute('data-disabled')).toBe(true)
    expect(document.body.textContent).toContain("Arkesel isn't configured on the server yet")
  })

  it('is disabled with a different explanation when the SMS channel itself is switched off', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: false }),
      initialLogin: login(),
      arkeselConfigured: true,
    })

    expect(phoneLoginToggle().getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('Turn on SMS notifications first')
  })

  it('is enabled once SMS is on and Arkesel is configured', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: true }),
      initialLogin: login(),
      arkeselConfigured: true,
    })

    expect(phoneLoginToggle().getAttribute('aria-disabled')).not.toBe('true')
    expect(phoneLoginToggle().hasAttribute('data-disabled')).toBe(false)
    expect(document.body.textContent).not.toContain('needs a working SMS channel to deliver codes.')
  })

  it('leaves the other login toggle interactive regardless', async () => {
    await renderOnLoginTab({
      initialNotifications: notifications({ smsEnabled: false }),
      initialLogin: login(),
      arkeselConfigured: false,
    })

    expect(screen.getByRole('switch', { name: 'Email login' }).getAttribute('aria-disabled')).not.toBe('true')
  })
})
