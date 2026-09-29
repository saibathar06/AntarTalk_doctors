# AntarTalk Professionals

Responsive doctor website (`web/`, React + Vite + TypeScript) backed by the existing shared Express API (`src/`, JavaScript/checkJs), Prisma/PostgreSQL and Redis. No separate booking system or mobile app was added.

## Local website with the hosted Render API

The development proxy now targets `https://antartalk-doctors.onrender.com`. No local API or Redis is needed for this mode.

1. In the Render backend's Environment settings, add `https://antartalk-doctors.onrender.com` to `CORS_ORIGINS` (preserve other allowed HTTPS origins), then redeploy. For direct local-browser API calls, explicit loopback origins such as `http://127.0.0.1:5173` and `http://localhost:5173` are also allowed in production; arbitrary HTTP origins remain rejected.
2. Run `npm run web:dev` from `AntarTalk_doctors` and open `http://127.0.0.1:5173/doctor/login`.

The loopback-only development proxy validates local browser origins before translating them to the upstream origin. It adapts only the refresh cookie for local HTTP, retaining HttpOnly/SameSite/Path. Production Secure cookies and backend origin checks are unchanged. To override the API target, set `DOCTOR_API_TARGET` in `web/.env.local`; do not put backend secrets there. Requests from this website affect the hosted database.

Signup troubleshooting: the UI now displays a request reference for HTTP failures and offers email verification when registration's outcome is uncertain; it never automatically retries registration. `X-AntarTalk-Gateway` distinguishes `local-proxy` connection errors from `upstream-response`. SMTP failures return `503 EMAIL_DELIVERY_UNAVAILABLE` after deploying the backend changes. Successful SMTP acceptance logs a safe recipient mask and message ID, never an OTP or credential. These changes do not replace valid Brevo credentials or confirm inbox delivery.

## Fully local backend (optional)

Run from **AntarTalk_doctors**, not its parent folder:

1. Merge `.env.example` into `.env`, preserving your database URL. Configure Redis, strong JWT/OTP secrets and SMTP. Never commit credentials.
2. Install: `npm ci` and `npm --prefix web ci`.
3. Prepare database: `npm run db:generate` and `npm run db:migrate`. Migrations are additive; do not reset shared data.
4. Set `DOCTOR_API_TARGET=http://127.0.0.1:4000` in `web/.env.local`. Include `http://127.0.0.1:4000` in the local API's `CORS_ORIGINS` for the proxy's upstream Origin.
5. Start API: `npm run dev`. In another terminal: `npm run web:dev`. Open **http://127.0.0.1:5173/doctor/login**.

Optional local PostgreSQL/Redis: `docker compose up -d`. SMTP must be configured separately.

For Brevo SMTP, set these backend environment variables (in Render and locally when testing delivery):

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-brevo-smtp-username
SMTP_PASS=your-brevo-smtp-key
EMAIL_FROM=verified-sender@your-domain.com
```

Port `2525` with `SMTP_SECURE=false` is also supported by Brevo. `EMAIL_FROM` must be a Brevo-verified sender. Production refuses to start with missing SMTP credentials; development may use a local SMTP server. Never put these values in `web/.env.local`.

### Razorpay

Booking updates: doctors set one unnamed default start/end time under Availability. It automatically applies every day within the rolling seven-day IST booking horizon. Custom dated hours (including inactive days) override the default and do not repeat. Changing the default preserves custom days; use “Use default timing” to remove a daily override. Old named favorites are not automatically activated: save a default explicitly. Default timing reuses the existing presets JSON storage; no additional migration is needed. Appointment windows remain 60 minutes (up to 40 minutes of therapy).

After deploying, run `npm run db:generate` during build and `npm run db:migrate` before starting the API. The migrations add dated hours, durable private profile assets, booking attendee details and a confirmation-email outbox. New photos and credential documents are stored privately in PostgreSQL; legacy disk credential references remain readable when the configured `UPLOAD_DIR` still contains them.

Confirmed bookings queue separate client and doctor emails transactionally. The API processes the queue every 15 seconds using existing SMTP settings, retrying failures up to 10 times. Branded HTML emails include a plain-text fallback: clients receive the professional, therapy time, booking/payment status and paid amount; doctors receive only the therapy time and the authenticated client's name/derived age. Booking requests no longer accept client name or age—the server snapshots them from the verified `User` profile and rejects checkout before creating a payment order when that profile is incomplete. Monitor exhausted email jobs in logs/`BookingEmail`; no automatic emails are backfilled for existing bookings. SMTP delivery is at-least-once, not guaranteed exactly-once.

Confirmed bookings also create separate client/doctor in-app notifications and push-delivery jobs in the same transaction. Mobile apps register Expo tokens through `/api/notifications/devices`; delivery failures retry without logging tokens. See [client discovery, notifications and video](docs/CLIENT_DISCOVERY_NOTIFICATIONS_VIDEO.md) for the exact shared web/mobile contracts.

Set these **backend-only** values in Render/local API configuration before using the payment screens. Do not add them to `web/.env.local` or commit them.

```env
RAZORPAY_KEY_ID=your-razorpay-test-key-id
RAZORPAY_KEY_SECRET=your-razorpay-test-key-secret
RAZORPAY_WEBHOOK_SECRET=your-razorpay-webhook-secret
RAZORPAY_CURRENCY=INR
PLATFORM_COMMISSION_PERCENT=20
DOCTOR_SAME_DAY_CANCELLATION_PENALTY_PERCENT=5
BOOKING_TRANSACTION_TIMEOUT_MS=20000
```

CAPTCHA is currently removed. Password validation, email OTP, resend cooldowns and authentication rate limits remain enabled. No CAPTCHA environment variables are required.

Razorpay orders are created by the API from the doctor’s stored `consultationFee`; clients never submit an amount or commission. The server verifies the returned checkout signature and captured payment before confirming the booking. Normal confirmation requires the existing Redis hold. If the hold expires after Razorpay captures payment, the trusted provider-confirmation path may recover the booking from the payment's server-bound client, doctor and UTC slot data; PostgreSQL overlap constraints remain authoritative. `BOOKING_TRANSACTION_TIMEOUT_MS` bounds the serializable confirmation transaction and defaults to 20 seconds. Configure a Razorpay webhook at `POST /api/payments/razorpay/webhook` with the same webhook secret and subscribe to `payment.captured` and `refund.processed`. The webhook never creates a booking by itself.

Doctors explicitly complete a session after its scheduled therapy time; only that trusted transition creates an available earning. Client cancellation retains the charge and creates no refund. Doctor cancellation creates a durable full-refund job; a same-day cancellation also records a 5% adjustment against future available earnings. Refunds are retried and reconciled with Razorpay. A client reschedule request leaves the original appointment unchanged until its doctor approves it; doctors may move an appointment directly, and each booking can be successfully rescheduled only once. All lifecycle changes queue email and in-app/mobile push notifications.

## How it works

- Signup collects first name, last name, gender, email, password and core professional details. Login requires email + password, followed by an email OTP. Passwords use Argon2id hashes. Deploy the backend and website together for this updated contract.
- The same login accepts DOCTOR and ADMIN accounts. Doctors open their workspace; administrators open the small verification-review queue. CLIENT accounts cannot use this app.
- A complete doctor profile, including a profile photo and consultation fee, is submitted for review. Admin approval automatically enables accepting bookings; the doctor can subsequently pause or resume bookings in settings. Unverified doctors can use only dashboard, profile and settings; the API also denies their availability, appointment, client, session, earning and payout routes.
- Account verification, profile completion, professional approval and accepting bookings remain separate backend gates. Existing professionals must complete newly required profile fields before new bookings/join access.
- Profile photos accept JPEG, PNG and WebP up to 5 MB. The server decodes, rotates and resizes them to an 800 px maximum JPEG before private storage. Once verified, a doctor can edit personal and client-facing practice information without another review; verified registration credentials and their credential document are locked and must be corrected through support.
- Dashboard, appointments, clients, profile, uploads, availability, settings and earnings use real APIs. No production demo data. Public doctor discovery includes gender when supplied, except `PREFER_NOT_TO_SAY`.
- PostgreSQL owns bookings and financial records; Redis owns temporary 180-second holds. Shared exclusion constraints prevent conflicting bookings.
- Client bookings are listed at `/my-bookings`; cancellation and reschedule actions always use the authenticated client account and real backend slots.
- Clients can search `/api/bookings/doctors/search` by an exact IST date/time and optional professional filters. The backend—not React—applies the real schedule, blocks, bookings and active Redis holds and returns only available doctors within the rolling seven-day horizon.
- Default window: **40 minutes therapy + 20 minutes protected buffer = one 60-minute booking**. Configurable via environment.
- Appointment timestamps remain UTC. New doctor profiles and recurring hours use only `Asia/Kolkata` (IST); overnight `23:00–03:00` ends the next day. Existing appointments retain their UTC timestamps. A legacy non-IST practice must save its profile as IST and recreate its weekly hours; old hours are disabled instead of being silently relabelled.
- Doctors may request INR withdrawals only on Tuesday in IST, with a ₹500 minimum and available earned funds. Requests remain `PENDING` until admin review. Approval moves them to `PROCESSING`; rejection releases the allocation. With no payout provider configured, the admin must make the real transfer outside the app and then record its reference to mark the payout `COMPLETED`. Approval alone never transfers funds.
- UPI/bank destination details are encrypted at rest with the existing backend-only `PAYOUT_ENCRYPTION_KEY` (64 hexadecimal characters); keep this key stable and private. Only admins can read the destination for a specific withdrawal. Older opaque-token payout accounts must be replaced with a UPI or bank destination before requesting a transfer.
- Access JWTs stay in memory; rotating refresh tokens use an HttpOnly cookie. All doctor APIs enforce authentication and ownership.

## Build and verify

Deploy the additive gender/IST migration with `npm run db:migrate`, then run `npm test`, `npm run lint`, `npm run typecheck`, `npm run db:validate`.

Website: `npm --prefix web run lint`, `npm run web:build`, `npm run web:test`. Install the browser first with `npm --prefix web exec -- playwright install chromium`. Browser tests use isolated API fixtures; four backend infrastructure tests require disposable PostgreSQL/Redis URLs.

Production: `npm run web:build`, then `npm start`. Express serves `/doctor/*` and the API under one HTTPS origin. Configure production secrets and explicit trusted proxy settings. `UPLOAD_DIR` is retained only as a read fallback for credential documents uploaded by older deployments; new private profile assets do not depend on Render's ephemeral filesystem.

Provision the first ADMIN account through your controlled database/admin process; there is intentionally no public endpoint that can grant the ADMIN role.

## Boundaries

Razorpay is connected for INR checkout once its environment keys and webhook are configured. Push delivery currently uses Expo and requires the mobile apps to register Expo push tokens. The uploaded video API is integrated through its trusted service contract but must be deployed separately with HTTPS/TURN and matching backend-only service credentials before calls work. No payout-transfer provider, ratings or SMS service is connected. Financial records are retained on account deletion; unresolved active bookings prevent deletion. New uploads are private and ownership-checked.

See [website handoff](docs/DOCTOR_WEBSITE.md) for routes, API contracts, environment variables, migration details, changed files and rollout assumptions. Existing backend details: [API changes](docs/API_CHANGES.md), [hardening report](docs/HARDENING_REPORT.md).

**Security:** `.env.example` was sanitized. Rotate any credentials previously stored there; prior Git history was not rewritten.
