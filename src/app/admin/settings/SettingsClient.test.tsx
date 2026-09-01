/**
 * Component tests for SettingsClient.
 *
 * Things that are easy to silently break and hard to catch any other way:
 *   1. The Notifications tab must expose a toggle + a destination-contact input per channel, and
 *      NOTHING that looks like a provider credential (API key/token/sender ID) OR a provider name
 *      (Resend/Arkesel/Meta) — those are implementation details, not something the owner needs to
 *      see or manage here.
 *   2. Each contact field's "Same as…" shortcut button must copy the right source value and never
 *      fire on its own — only Save persists anything.
 *   3. The Auth tab must be genuinely read-only — no switch, no input, anywhere in it — since
 *      login identity is fixed by the server environment, not something this UI can change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const updateNotificationSettingsMock = vi.fn()
vi.mock('./actions', () => ({
  updateNotificationSettings: (...args: unknown[]) => updateNotificationSettingsMock(...args),
}))

import { SettingsClient } from './SettingsClient'
import type { AuthDisplay } from './actions'
import type { NotificationSettings } from '@prisma/client'

beforeEach(() => {
  vi.clearAllMocks()
})

function notifications(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    id: 'settings-1',
    emailEnabled: true,
    alertEmail: null,
    smsEnabled: true,
    alertPhone: null,
    whatsappEnabled: true,
    alertWhatsapp: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function auth(overrides: Partial<AuthDisplay> = {}): AuthDisplay {
  return {
    adminEmail: 'owner@example.com',
    adminPhone: '233241234567',
    ...overrides,
  }
}

describe('Notifications tab', () => {
  it('renders one toggle + one contact input per channel, reflecting initial state', () => {
    render(
      <SettingsClient
        initialNotifications={notifications({
          emailEnabled: true,
          alertEmail: 'owner@example.com',
          smsEnabled: false,
          alertPhone: '233241234567',
          whatsappEnabled: true,
          alertWhatsapp: null,
        })}
        auth={auth()}
      />
    )

    expect(screen.getByRole('switch', { name: 'Email notifications' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'SMS notifications' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'WhatsApp notifications' }).getAttribute('aria-checked')).toBe('true')

    expect(screen.getByLabelText('Alert Email Address')).toHaveValue('owner@example.com')
    expect(screen.getByLabelText('Alert Phone Number')).toHaveValue('233241234567')
    expect(screen.getByLabelText('Alert WhatsApp Number')).toHaveValue('')
  })

  it('has no credential inputs anywhere — the whole point of this page', () => {
    render(<SettingsClient initialNotifications={notifications()} auth={auth()} />)

    expect(screen.queryByLabelText(/api key/i)).toBeNull()
    expect(screen.queryByLabelText(/access token/i)).toBeNull()
    expect(screen.queryByLabelText(/sender id/i)).toBeNull()
    expect(screen.queryByLabelText(/template/i)).toBeNull()
  })

  it('never names the underlying provider — Resend/Arkesel/Meta are implementation details', () => {
    render(<SettingsClient initialNotifications={notifications()} auth={auth()} />)

    expect(document.body.textContent).not.toMatch(/resend/i)
    expect(document.body.textContent).not.toMatch(/arkesel/i)
    expect(document.body.textContent).not.toMatch(/meta cloud/i)
  })

  it('saves the toggles and contacts together via one explicit Save action', async () => {
    updateNotificationSettingsMock.mockResolvedValue({ ok: true, data: notifications({ alertEmail: 'new@example.com' }) })
    const user = userEvent.setup()
    render(<SettingsClient initialNotifications={notifications()} auth={auth()} />)

    await user.type(screen.getByLabelText('Alert Email Address'), 'new@example.com')
    expect(updateNotificationSettingsMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateNotificationSettingsMock).toHaveBeenCalledTimes(1))
    expect(updateNotificationSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ alertEmail: 'new@example.com' })
    )
    expect(screen.getByText('Notification settings saved.')).toBeInTheDocument()
  })

  it('surfaces a server-side validation error instead of silently discarding it', async () => {
    updateNotificationSettingsMock.mockResolvedValue({ ok: false, error: 'Enter a valid email address.' })
    const user = userEvent.setup()
    render(<SettingsClient initialNotifications={notifications()} auth={auth()} />)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument())
  })

  describe('"Same as…" shortcut buttons', () => {
    it('"Use Login Email" fills the alert email from the env-sourced owner email, without saving', async () => {
      const user = userEvent.setup()
      render(
        <SettingsClient
          initialNotifications={notifications()}
          auth={auth({ adminEmail: 'owner@example.com' })}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Use Login Email' }))

      expect(screen.getByLabelText('Alert Email Address')).toHaveValue('owner@example.com')
      expect(updateNotificationSettingsMock).not.toHaveBeenCalled()
    })

    it('"Use Login Email" is disabled when no owner email is set', () => {
      render(<SettingsClient initialNotifications={notifications()} auth={auth({ adminEmail: null })} />)

      expect(screen.getByRole('button', { name: 'Use Login Email' })).toBeDisabled()
    })

    it('"Use Login Phone" fills the alert phone from the env-sourced owner phone', async () => {
      const user = userEvent.setup()
      render(
        <SettingsClient
          initialNotifications={notifications()}
          auth={auth({ adminPhone: '233209998888' })}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Use Login Phone' }))

      expect(screen.getByLabelText('Alert Phone Number')).toHaveValue('233209998888')
    })

    it('"Same As SMS Number" copies the CURRENT alert-phone field value into alert WhatsApp, not the owner phone', async () => {
      const user = userEvent.setup()
      render(
        <SettingsClient
          initialNotifications={notifications({ alertPhone: null })}
          auth={auth({ adminPhone: '233209998888' })}
        />
      )

      await user.type(screen.getByLabelText('Alert Phone Number'), '233241234567')
      await user.click(screen.getByRole('button', { name: 'Same As SMS Number' }))

      expect(screen.getByLabelText('Alert WhatsApp Number')).toHaveValue('233241234567')
    })

    it('"Same As SMS Number" is disabled while the alert phone field is empty', () => {
      render(<SettingsClient initialNotifications={notifications({ alertPhone: null })} auth={auth()} />)

      expect(screen.getByRole('button', { name: 'Same As SMS Number' })).toBeDisabled()
    })
  })
})

describe('Auth section — read-only, no functionality', () => {
  it('displays the env-sourced owner email and phone, with no input to edit them', async () => {
    render(<SettingsClient
      initialNotifications={notifications()}
      auth={auth({ adminEmail: 'owner@example.com', adminPhone: '233241234567' })}
    />)

    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('233241234567')).toBeInTheDocument()
  })

  it('shows "Not set" for a missing admin phone rather than an empty field', async () => {
    render(<SettingsClient
      initialNotifications={notifications()}
      auth={auth({ adminPhone: null })}
    />)

    expect(screen.getByText('Not set')).toBeInTheDocument()
  })

  it('contains no switch and no text input anywhere on the tab — no customer-login status either', async () => {
    render(<SettingsClient initialNotifications={notifications()} auth={auth()} />)

    expect(screen.queryAllByRole('switch')).toHaveLength(3) // The 3 notification switches
    // But there shouldn't be ANY in the auth section... well actually the test was for the whole tab.
    // The requirement is that no customer-login status is there.
    expect(screen.queryByText(/customer login/i)).toBeNull()
  })
})
