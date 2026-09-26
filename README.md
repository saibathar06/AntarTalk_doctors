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

## How it works

- Signup collects first name, last name, email, password and core professional details. Login requires email + password, followed by an email OTP. Passwords use Argon2id hashes. Deploy the backend and website together for this updated contract.
- The same login accepts DOCTOR and ADMIN accounts. Doctors open their workspace; administrators open the small verification-review queue. CLIENT accounts cannot use this app.
- A complete doctor profile is explicitly submitted for review. Admins can approve or reject it with an audit trail; approval keeps bookings disabled until the doctor opts in.
- Account verification, profile completion, professional approval and accepting bookings are separate gates. Existing professionals must complete new profile fields before new bookings/join access.
- Dashboard, appointments, clients, profile, uploads, availability, settings and earnings use real APIs. No production demo data.
- PostgreSQL owns bookings and financial records; Redis owns temporary 180-second holds. Shared exclusion constraints prevent conflicting bookings.
- Default window: **40 minutes therapy + 20 minutes protected buffer = one 60-minute booking**. Configurable via environment.
- Appointment timestamps are UTC; recurring hours use the doctor's IANA timezone. Overnight `23:00–03:00` ends the next day.
- Access JWTs stay in memory; rotating refresh tokens use an HttpOnly cookie. All doctor APIs enforce authentication and ownership.

## Build and verify

`npm run db:migrate`, then `npm test`, `npm run lint`, `npm run typecheck`, `npm run db:validate`.

Website: `npm --prefix web run lint`, `npm run web:build`, `npm run web:test`. Install the browser first with `npm --prefix web exec -- playwright install chromium`. Browser tests use isolated API fixtures; four backend infrastructure tests require disposable PostgreSQL/Redis URLs.

Production: `npm run web:build`, then `npm start`. Express serves `/doctor/*` and the API under one HTTPS origin. Configure persistent private `UPLOAD_DIR` storage, production secrets and explicit trusted proxy settings.

Provision the first ADMIN account through your controlled database/admin process; there is intentionally no public endpoint that can grant the ADMIN role.

## Boundaries

No real video/payment/payout provider, ratings, SMS or appointment-notification worker is connected. Join returns backend authorization, not a video meeting URL. Financial records are retained on account deletion; unresolved active bookings prevent deletion. New uploads are private and ownership-checked.

See [website handoff](docs/DOCTOR_WEBSITE.md) for routes, API contracts, environment variables, migration details, changed files and rollout assumptions. Existing backend details: [API changes](docs/API_CHANGES.md), [hardening report](docs/HARDENING_REPORT.md).

**Security:** `.env.example` was sanitized. Rotate any credentials previously stored there; prior Git history was not rewritten.
