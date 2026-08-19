# Rollout Runbook — Phone-OTP Login, Account Notifications, and the Settings Page

**Purpose**: this expansion is **not a routine deploy**. The moment it ships, every customer
notification goes silent until a human re-enters credentials through the new Settings UI. This
document is the sequence whoever deploys it must follow, and the risks they must understand
before starting.

> ⚠ **Nothing in the automated suite sends a real message.** Every test mocks `global.fetch`. The
> live checks in section 5 cost real Arkesel credit and reach a real phone, so they require the
> business owner's explicit go-ahead.

---

## 1. The one risk that dominates everything else

**On deploy, all customer notifications stop working — including ones that already worked.**

Provider credentials no longer come from `.env`. They live in the `NotificationSettings` table,
managed at `/admin/settings`. That table starts **empty**, by an explicit decision: there is no
automatic migration of existing `.env` values, and deliberately **no env-var fallback**.

The fallback was rejected on purpose. A stray value left in a `.env` could keep a channel sending
after the admin had explicitly switched it off in the UI — which is precisely the failure this
move exists to prevent. The cost of that choice is this silence window.

What goes silent, until step 4 is done:

| Affected | Behavior in the window |
|---|---|
| Order-status email / SMS / WhatsApp | No-op, logged, `reason: 'no_api_key'` / `'sms_not_configured'` / `'whatsapp_not_configured'` |
| Low-stock alerts | Same |
| Account-creation notifications (new) | Same |
| WhatsApp webhook (`GET`/`POST` from Meta) | **Fails closed** — 403 / 503. Deliberate: an unverifiable request must be rejected, never trusted. Meta's dashboard will show failed deliveries during the window. |

None of this crashes anything. Every path is a logged no-op. But a customer who places an order in
this window is **not** told about it.

**Therefore: schedule this deploy when the business owner is actually available to complete step 4
immediately afterwards.** Confirm their availability ahead of time — do not assume it.

---

## 2. Before you deploy

- [ ] **`SUPABASE_SERVICE_ROLE_KEY` is set in the production environment**, with the real value
      from the owner's Supabase project (Project Settings → API). The value in local `.env` is
      Supabase's well-known demo key and is **not** usable in production.
      - ⚠ Server-only. Bypasses Row Level Security entirely. Must **never** carry a
        `NEXT_PUBLIC_` prefix. Without it, phone login and account-creation magic links are
        entirely non-functional — they fail gracefully as an `ActionResult` error, not a crash.
- [ ] **`OTP_HASH_SECRET` is set in the production environment** to a long random value
      (`openssl rand -hex 32`). Without it, `hashOtpCode` throws and phone login cannot work.
      Rotating it later invalidates every outstanding unexpired code — accepted and documented.
- [ ] **The production Supabase project's Auth redirect allow-list includes
      `${NEXT_PUBLIC_SITE_URL}/auth/confirm`.** This is a new route. Local dev is already covered
      by `supabase/config.toml`'s wildcard, but the hosted project's allow-list is configured
      separately and does **not** inherit it.
- [ ] You have the Resend, Arkesel, and Meta WhatsApp credentials **on hand** for step 4. Copy them
      out of the current `.env` before deploying — that is the last moment they are easy to reach.
      `.env.example` documents which value maps to which Settings field.

---

## 3. Deploy sequence

1. **Push the schema to the dev database**: `npx prisma generate && npx prisma db push`.
2. **Push the schema to the isolated test database**, manually and once, with `DATABASE_URL`
   pointed at `rosty_integrity_test`. Never the shared `postgres` database, and never as part of a
   test run — `prisma/seed.ts` opens with destructive `deleteMany()` calls.
   *(Already done during implementation; reconfirmed here as part of the deploy sequence.)*
3. **Deploy the code.** All schema changes are additive — new nullable columns and new tables,
   nothing removed or renamed.
4. **Immediately** — same session, not "later" — the admin signs in, opens `/admin/settings`, and
   re-enters every provider credential, confirming each channel's toggle is on:
   - Email: Resend API key, from-address
   - SMS: Arkesel API key, sender ID
   - WhatsApp: access token, phone number ID, app secret, webhook verify token, both template
     names, template language (`en`, not `en_US`, for this business's templates)

   Secret fields show `•••• saved` once set and never display the stored value again. **A blank
   secret field on save means "keep what is stored", never "clear it"** — so editing an unrelated
   field cannot wipe a working credential.
5. **Verify notifications are live again** before considering the window closed — trigger one
   order-status change and confirm delivery.
6. **Only then** consider enabling phone login (section 5). It defaults to `false` on purpose.

---

## 4. Verify the window is closed

- [ ] A real order-status change produces a received email and/or SMS.
- [ ] Meta's webhook dashboard stops showing failed deliveries.
- [ ] `/admin/settings` shows `•••• saved` against every secret you entered.

---

## 5. Enabling phone login (a separate, later decision)

`LoginSettings.phoneLoginEnabled` ships as **`false`**. Email-only login therefore remains the
default, entirely unaffected behavior until someone deliberately turns phone login on. Do **not**
flip it as part of the deploy.

The Phone-login toggle in Settings stays **disabled** until SMS is both enabled and has a stored
Arkesel key — phone login without a working SMS channel would collect a number and never deliver a
code.

Before enabling, with the owner's explicit go-ahead (these cost real credit and reach a real phone):

- [ ] **A real phone-OTP login, end to end, for a number that has NEVER logged in before.**
      This specific case matters more than a repeat login: on a first-ever login Supabase reports
      `verification_type: "signup"`, and on every later one `"magiclink"`. Redeeming with the wrong
      one returns HTTP 403. The code always reads the type back from the response rather than
      hard-coding it, so this path should work — but a mocked test cannot prove it, which is
      exactly why it is on this checklist. Request code → receive SMS → enter it → land on
      `/dashboard`.
- [ ] **A real account-creation SMS** for a phone-preferred test customer. Check the copy renders
      cleanly: correct site URL, no typos, and **no login code** in it (the message points at the
      login page by design — a code issued at creation time would likely expire before use).
- [ ] **A real account-creation email** for an email-preferred test customer, and confirm the
      "Sign in to my account" link actually signs you in. It points at `/auth/confirm`, which is
      why section 2's redirect-allow-list check matters.
- [ ] Record the outcome — including any failure — in `docs/notifications-manual-qa.md`, matching
      how the existing WhatsApp/Arkesel live tests were documented.

Then set `phoneLoginEnabled` to on. The Phone tab appears on `/login` only when phone login is
enabled **and** SMS is enabled **and** an Arkesel key is stored — the tab is omitted from the
server-rendered HTML entirely otherwise, not merely hidden.

---

## 6. Rollback

Reverting the code deploy is sufficient. Every schema change is additive, so old code simply
ignores the new columns and tables and nothing depends on their absence. No schema rollback step is
needed.

Note that reverting also restores `.env`-based credentials, since the old code reads them — so a
rollback closes the notification-silence window rather than widening it.
