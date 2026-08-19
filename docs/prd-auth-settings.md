# PRD: Phone-OTP Login, Unified Account Notifications, and a Settings Page

## Status
Draft

## Problem Statement
Chop with Rostty's own product framing is that the business owner "receives orders by phone or
WhatsApp" — yet the customer portal only supports magic-link login by email. Any customer the
owner has only a phone number for (which, for a phone/WhatsApp-first business, is likely a large
share of the customer list) is permanently locked out of self-service order tracking, and every
newly created customer is left to guess how to log in at all — nobody tells them. Separately, the
credentials for all three notification providers (Resend, Arkesel, Meta WhatsApp) live in a
`.env` file that only a developer can edit: the non-technical business owner cannot rotate a
leaked API key, switch providers, or silence a noisy channel without asking someone to redeploy
code.

## Goals
- Phone-only customers can log in with just their phone number and a text-message code, and reach
  their order-history dashboard, with no email address required. **We will know this is
  successful when** a customer with a valid, deliverable Ghanaian number reaches `/dashboard`
  within 2 attempts under normal conditions (excluding deliberately wrong codes).
- Every newly created customer is proactively told how to log in at creation time, on whichever
  channel(s) they actually have. **We will know this is successful when** 100% of `createCustomer`
  calls for a customer with at least one contact method result in an account-creation notification
  attempt on the appropriate channel(s), with a clean no-op (never a crash) for the small number of
  name-only customers who have neither.
- The business owner can view, add, and rotate every notification-provider credential and toggle
  each channel on or off from an in-app Settings page, with zero code changes or redeploys.
  **We will know this is successful when** a credential rotation or channel toggle takes effect on
  the very next notification attempt, with no deploy in between.
- Phone login and email login can each be turned on or off independently of the other, and
  independently of whether SMS notifications are enabled — because an admin may want to keep SMS
  notifications running while still deciding phone login isn't ready for customers yet. **We will
  know this is successful when** disabling one login channel in Settings measurably stops that
  channel from accepting logins (server-side, not just hidden in the UI) while leaving the other
  channel and existing notification behavior unaffected.
- Logging in via phone and logging in via email never create two separate accounts for the same
  person. **We will know this is successful when**, across a 30-day post-launch window, zero
  `User` rows are found sharing the same `phone` or `email` value (the concrete symptom of a
  duplicate-account bug in this schema, since both columns are unique).
- OTP codes are never recoverable in plaintext from the database. **We will know this is
  successful when** a direct query against the `OtpCode` table never returns a stored value equal
  to a code that was actually sent (verified by hash comparison in tests, not literal equality).

## Non-Goals
- No inbound/two-way SMS or WhatsApp chat handling (unchanged from the existing WhatsApp/Arkesel
  notifications work already on this branch).
- No password-based login of any kind — OTP (phone) and magic-link (email) only, matching the
  product's existing passwordless philosophy.
- No encryption-at-rest for provider secrets in the new Settings table. They are stored in plain
  text, protected only by the existing `requireAdmin()` gate — an explicit, accepted trade-off for
  this app's single-admin scale, not an oversight.
- No automatic migration of the current `.env` provider credentials into the new Settings table.
  The admin re-enters them once, manually, through the new UI after this ships.
- No data-preserving database migration path for this change. The schema may be pushed fresh
  (`prisma db push`) against dev/test databases that are freely reset.
- No CAPTCHA or IP-based rate limiting on OTP requests — only a per-phone-number cooldown. Broader
  abuse protection is an explicit future consideration, not v1 scope.
- No change to which order-status transitions trigger notifications, and no new admin-facing
  per-customer channel-preference toggle beyond the single `preferredLoginMethod` field already
  described below.
- No self-service customer sign-up *flow* beyond what already exists implicitly (a brand-new email
  or phone reaching `/login` and being auto-provisioned an account) — this expansion extends that
  existing auto-provisioning behavior to phone, it does not add a new sign-up form.
- **No WhatsApp channel for the account-creation notification** — it sends by email and SMS only.
  Reason: WhatsApp requires a pre-approved Meta template for every business-initiated message, and
  this feature should not be blocked behind a third template review (`order_status_update` and
  `low_stock_alert` are already pending approval for the unrelated order-status/low-stock
  notifications, which this does **not** change). A phone-preferred customer with no email
  therefore has exactly one delivery channel (SMS) for this specific message.

## User Stories
1. As a phone-only customer the owner added to the system over a phone call, I want to log in
   using just my phone number and a text-message code, so that I can check my order status
   without needing an email address.
2. As a returning phone-only customer, I want logging in again later to resolve to the exact same
   account and order history I had before, so that I never see a fresh, empty account.
3. As a new customer created by the admin with only a phone number on file, I want to receive a
   text message right away explaining how to log in, so that I'm not left guessing how to access
   my account.
4. As a new customer created by the admin with an email on file, I want to receive a working,
   click-to-log-in link by email right away, so that I can get into my account in one tap without
   waiting for a text message code.
5. As the business owner, I want to enter my Resend, Arkesel, and WhatsApp credentials into a
   Settings page instead of asking a developer to edit a file, so that I can rotate a leaked key or
   switch providers myself.
6. As the business owner, I want to turn phone login off entirely without turning off SMS
   notifications (or vice versa), so that I control the customer-facing login rollout
   independently of the notification channels I already rely on.
7. As a customer entering a wrong code by mistake, I want a clear error and a limited number of
   retries — not an infinite guessing window and not a number that tells an attacker exactly how
   many tries are left — so my account stays secure without being confusing to use.

## Success Metrics
- % of customer accounts with a phone number and no email that successfully log in at least once
  within 30 days of launch (baseline: 0%, since this login path does not exist today).
- 0 duplicate `User` rows created via the phone-login path in the first 30 days post-launch
  (measured by scanning for rows sharing a `phone` or `email` value).
- 100% of provider-credential rotations and channel toggles observed to take effect without a code
  deploy (a binary architectural gate, verified at launch and by test coverage, not an ongoing
  metric).
- 0 plaintext OTP codes recoverable from a database dump (verified by test assertion: hash
  comparison never allows byte-for-byte code storage).
- Qualitative: a measurable drop in the business owner having to personally explain "how do I log
  in" to a new customer, self-reported after 30 days.

## UX/Flow Summary
1. `/login` gains a channel switcher — **Email** and **Phone** tabs. The Phone tab is hidden
   entirely if phone login is disabled in Settings (or if SMS isn't configured/enabled — see the
   TDD for why phone login is deliberately gated on both).
2. **Phone tab:** customer enters their phone number → taps "Send code" → sees a confirmation → a
   6-digit code-entry step appears inline on the same page (no navigation) → taps "Verify" → on
   success, redirected to `/admin` or `/dashboard` exactly like a magic-link login today.
3. **Wrong code:** a generic "Incorrect code" error, without revealing how many attempts remain
   (to avoid helping an attacker calibrate a brute-force attempt). The code-entry step stays open
   for retry up to a fixed cap; past the cap, the customer must request a new code.
4. **New customer, phone only:** immediately receives an SMS with plain instructions to visit the
   login page and enter their number — never a pre-issued code, since a code sent at creation time
   risks expiring before the customer actually logs in. **Email and SMS only, deliberately no
   WhatsApp for this message** (see Non-Goals) — this does not affect the separate, existing
   WhatsApp order-status and low-stock notifications, which are unchanged.
5. **New customer, has an email:** immediately receives an email containing a working,
   click-to-log-in magic link — no separate "instructions" message needed, since the link itself
   is the whole action.
6. **Admin Settings page** (`/admin/settings`, new Sidebar entry): two sections, **Notifications**
   and **Login**. Notifications: one card per channel (Email / SMS / WhatsApp) with credential
   fields (secret fields render blank/masked — "•••• saved" once configured, never round-tripping
   the real secret to the browser) and an on/off toggle. Login: two independent toggles (Email
   login, Phone login); the Phone login toggle is visually disabled with an explanatory note if SMS
   isn't configured and enabled yet.
7. **Customer form:** the existing Customers CRUD dialog gains a "Preferred login method" field,
   constrained to whichever contact fields are actually filled in (can't prefer a channel with no
   contact info behind it).

## Open Questions
- Should the account-creation SMS copy for phone-preferred customers include the business's
  WhatsApp number or a website URL as the "next step," and does the owner want to approve that
  exact copy before launch?
- Does the owner want a visible retry-cooldown countdown in the phone-login UI, or is a static
  "please wait before requesting another code" message sufficient for v1?
- Should `preferredLoginMethod` auto-update itself if an admin later adds an email to a
  previously phone-only customer (or vice versa), or should it always require a manual edit?
- **Operational, time-sensitive:** because the new Settings table starts empty, all customer
  notifications (not just the new ones in this expansion) go silent immediately after this ships,
  until the admin visits `/admin/settings` and re-enters every provider credential. The owner
  should be available to do this at or immediately after deploy — see the TDD's Rollout Plan.
