# AntarTalk Professionals

Responsive doctor website (`web/`, React + Vite + TypeScript) backed by the existing shared Express API (`src/`, JavaScript/checkJs), Prisma/PostgreSQL and Redis. No separate booking system or mobile app was added.

## Start locally

Run from **AntarTalk_doctors**, not its parent folder:

1. Merge `.env.example` into `.env`, preserving your database URL. Configure Redis, strong JWT/OTP secrets and SMTP. Never commit credentials.
2. Install: `npm ci` and `npm --prefix web ci`.
3. Prepare database: `npm run db:generate` and `npm run db:migrate`. Migrations are additive; do not reset shared data.
4. Start API: `npm run dev`. In another terminal: `npm run web:dev`.
5. Open **http://localhost:5173/doctor/login**. Include this exact origin in `CORS_ORIGINS`.

Optional local PostgreSQL/Redis: `docker compose up -d`. SMTP must be configured separately.

## How it works

- Email OTP signup/login; phone can identify an account, but codes are **email-only**. Existing password APIs remain supported.
- Account verification, profile completion, professional approval and accepting bookings are separate gates. Existing professionals must complete new profile fields before new bookings/join access.
- Dashboard, schedule, appointments, clients, profile, uploads, availability, settings and earnings use real APIs. No production demo data.
- PostgreSQL owns bookings and financial records; Redis owns temporary 180-second holds. Shared exclusion constraints prevent conflicting bookings.
- Default window: **40 minutes therapy + 20 minutes protected buffer = one 60-minute booking**. Configurable via environment.
- Appointment timestamps are UTC; recurring hours use the doctor's IANA timezone. Overnight `23:00–03:00` ends the next day.
- Access JWTs stay in memory; rotating refresh tokens use an HttpOnly cookie. All doctor APIs enforce authentication and ownership.

## Build and verify

`npm test`, `npm run lint`, `npm run typecheck`, `npm run db:validate`.

Website: `npm --prefix web run lint`, `npm run web:build`, `npm run web:test`. Install the browser first with `npm --prefix web exec -- playwright install chromium`. Browser tests use isolated API fixtures; four backend infrastructure tests require disposable PostgreSQL/Redis URLs.

Production: `npm run web:build`, then `npm start`. Express serves `/doctor/*` and the API under one HTTPS origin. Configure persistent private `UPLOAD_DIR` storage, production secrets and explicit trusted proxy settings.

## Boundaries

No real video/payment/payout provider, ratings, SMS or appointment-notification worker is connected. Join returns backend authorization, not a video meeting URL. Financial records are retained on account deletion; unresolved active bookings prevent deletion. New uploads are private and ownership-checked.

See [website handoff](docs/DOCTOR_WEBSITE.md) for routes, API contracts, environment variables, migration details, changed files and rollout assumptions. Existing backend details: [API changes](docs/API_CHANGES.md), [hardening report](docs/HARDENING_REPORT.md).

**Security:** `.env.example` was sanitized. Rotate any credentials previously stored there; prior Git history was not rewritten.
