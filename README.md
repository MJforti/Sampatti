# Sampatti — family financial reminders

Sampatti is a mobile-first PWA that tracks a family's payments, renewals, EMIs, SIPs, insurance, vehicle documents and tax deadlines, and sends reminders before each one is due. It runs on Next.js 15 + TypeScript + Tailwind on the frontend, with Supabase (Postgres, Auth, Storage, RLS, pg_cron and an Edge Function) as the only data store.

## What works (Phase 1)

| Area | Status |
|---|---|
| Six initial profiles (seeded by a migration; add, edit and deactivate more in the app) | ✅ |
| Email/password and magic-link sign-in; admin invites users | ✅ |
| Admin Mode with a 4-digit PIN: server-verified bcrypt hash, lockout, auto-lock on inactivity, audit log | ✅ |
| Role and per-profile/per-section permissions enforced by **RLS** | ✅ |
| Investments, insurance (incl. health fields), loans (estimated amortisation), vehicles, bank accounts, tax/compliance, custom recurring payments | ✅ |
| Obligation engine: each date field on a record becomes a scheduled item; mark paid / renewed / cancelled; the next cycle is created automatically | ✅ |
| Auto-debits are never assumed paid: after the due date they show **Confirm debit** | ✅ |
| Reminder engine: 30/15/7/3/1/0 days (configurable), daily overdue repeats, catch-up, no duplicates | ✅ |
| In-app notifications (realtime badge) | ✅ |
| Email and web-push delivery (Edge Function) | ✅ code; needs your Resend and VAPID keys |
| Calendar (month/week/list, filters), bank-wise deductions, search | ✅ |
| Documents: camera/file upload, private bucket, signed links, versions, expiry reminders | ✅ |
| Reports with CSV export (opens in Excel) and print-to-PDF | ✅ (no native .xlsx yet) |
| WhatsApp, mutual-fund sync, bank integrations, OCR (Phase 2) | ⏳ not built; the delivery log already has a `whatsapp` channel |

## Architecture

```
Next.js PWA (client components) ──supabase-js──► PostgREST + RLS ──► Postgres
                                                     │
  pg_cron hourly ─► generate_reminders() ─► reminders / notifications / delivery_logs
  pg_cron 10 min ─► Edge Function dispatch-notifications ─► Resend email, Web Push
```

* **Every write is checked by the database.** Write policies require `admin_unlocked()`, which is true only for an active `admin` user with an unexpired row in `user_sessions`. That row is created only by `verify_admin_pin()`. Hiding buttons in the UI is cosmetic.
* **Money** is stored as `bigint` paise and parsed and formatted with BigInt (`src/lib/money.ts`). Floats are never used.
* **Dates**: calendar dates are `date`. "Today" is computed in the configured timezone (default `Asia/Kolkata`) by `app_today()`.
* **Idempotency**: `reminders` is unique on (item, due date, offset). Notifications are unique on (reminder, user). Deliveries are unique on (notification, channel). The dispatcher claims rows with `FOR UPDATE SKIP LOCKED`.
* `financial_calendar_events` is a security-invoker view, so the calendar, the dashboard and the reports all obey RLS.

## Setup

1. **Create a Supabase project**, then link and push the migrations:

   ```bash
   npx supabase link --project-ref <ref>
   ```

   ```bash
   npx supabase db push
   ```

   Enable the `pg_cron` and `pg_net` extensions first (Dashboard → Database → Extensions) so the schedules are created. If you enable them later, re-run the `do $outer$` block from migration `0004`.
2. **Environment**: copy `.env.example` to `.env.local` and fill it in. `SUPABASE_SERVICE_ROLE_KEY` is used only by `/api/admin/users`, on the server.
3. **First administrator** (secure bootstrap):
   * Dashboard → Authentication → Users → *Add user* with the admin's email and a password.
   * In the SQL editor, run:

     ```sql
     update admin_settings set bootstrap_admin_email = 'you@example.com';
     ```

   * Sign in as that user and tap **Set up administrator**. Choose the PIN and confirm it. That user becomes admin and the bootstrap email is cleared. No PIN exists in the source code.
   * Turn off public sign-ups (Auth → Providers → Email → "Allow new users to sign up").
4. **Notifications**:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Put the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Then deploy the function and set its secrets:

   ```bash
   npx supabase functions deploy dispatch-notifications --no-verify-jwt
   ```

   ```bash
   npx supabase secrets set DISPATCH_SECRET=<random> RESEND_API_KEY=<key> EMAIL_FROM="Sampatti <reminders@yourdomain>" VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv> VAPID_SUBJECT=mailto:you@example.com APP_URL=https://your-app
   ```

   Then, in SQL:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<same DISPATCH_SECRET>', 'dispatch_secret');
   ```

   Without these keys, in-app reminders still work. Email and push rows are marked `failed` with a clear error under *More → Audit & delivery*.
5. **Deploy** the Next.js app (e.g. on Vercel) with the three public variables and the service-role key. Set Auth → URL configuration → Site URL to the app's URL, and add `/auth/callback` to the redirect URLs.
6. **iPhone push** works only after *Share → Add to Home Screen* (iOS 16.4+). If push is unavailable, email and in-app reminders are the fallback.

## Using it

* Family members open the app to see what needs attention, what's due, how much is needed, and from which account.
* The administrator taps **Admin Mode**, enters the PIN, and gets Add/Edit/Archive/Delete, *Mark as paid*, user permissions and settings. Admin Mode locks after 10 idle minutes (configurable).
* Grant users access under *More → Users & permissions*: choose profiles, optionally limit the sections, and set document visibility and whether they get reminders.

## Development & tests

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test          # money/date/loan unit tests
```

```bash
npm run db:test   # applies all migrations to a throwaway Postgres 16 and runs tests/db/*.test.sql
```

```bash
npx supabase start   # full local stack (Docker); migrations apply automatically
```

`tests/db/01_engine.test.sql` covers bootstrap, PIN verification and lockout, RLS isolation, members being unable to edit or self-promote, reminder intervals, duplicate prevention, recipients, overdue auto-debit confirmation, paid items stopping reminders, recurrence, renewals and archiving.

## Security notes

* Banking passwords, PINs, OTPs and full account numbers are never stored. Accounts keep only the last 4 digits.
* Documents live in a private bucket. The storage policies mirror the table permissions, and download links expire after 5 minutes.
* All admin unlocks, failed PIN attempts, PIN changes and data changes go to `administrator_audit_logs`.
* *Settings* offers sign-out on other devices and *Revoke all Admin Mode sessions*.
* Enable MFA (TOTP) in Supabase Auth for extra protection. Supabase handles backups on paid plans (PITR recommended).
* The admin PIN is an extra gate on top of the account login, not a replacement for it.

## Future integrations (Phase 2/3)

* **WhatsApp**: add a `whatsapp` branch in `dispatch-notifications` using the WhatsApp Business Cloud API. It needs a Meta-approved template and a phone-number preference column.
* **MF/portfolio sync** (CAS / MF Central / an account aggregator): write `current_value_paise`, `value_as_of` and `value_is_verified = true`.
* **Bank confirmation**: an account-aggregator feed (read-only, with consent) could move `awaiting_confirmation` to `paid`.
* **OCR**: extract fields into a draft that an admin must confirm before saving.
