# AntarTalk Doctor Backend

One shared Express API serves the Doctor Mobile App, Doctor Website, and Client App/Web. PostgreSQL owns permanent records; Redis holds 180-second reservations and distributed rate-limit counters. Runtime JavaScript is checked by TypeScript checkJs.

## Run locally

1. Copy `.env.example` to `.env` and replace all secrets.
2. Start infrastructure: `docker compose up -d`.
3. Install and prepare: `npm install && npm run db:generate && npm run db:migrate`.
4. Start the API: `npm run dev` (default: `http://localhost:4000`).

Configure SMTP for OTP delivery. Set PAYOUT_ENCRYPTION_KEY to 32 random bytes encoded as 64 hex characters for payout-account storage. No payment, payout, or video provider is connected. A trusted payment integration must supply a successful priced order bound to the client, doctor, exact UTC window, amount, currency, and doctor earning; unbound legacy payments are rejected. Payout requests remain PENDING until a trusted worker processes them. Join tokens are internal authorization, not video-provider meeting URLs.

## Main APIs

- `/api/auth/*` — registration, OTP, login, refresh rotation, logout, password reset
- `/api/doctor/me` — professional profile; credential edits return verification to `PENDING`
- `/api/doctor/availability`, `/blocked-slots` — weekly hours and exceptions
- `/api/bookings/availability`, `/reserve`, `/confirm` — dynamic slots and conflict-safe booking
- `/api/doctor/sessions/*` — upcoming/past/all sessions, GET /:id details, POST /:id/join authorization
- `/api/doctor/earnings`, `/payouts`, `/payout-accounts` — ledger-derived balances and idempotent withdrawals
- `/api/admin/doctors/:id/verification` — admin-only verification state changes

Use `Idempotency-Key` for booking confirmation and payout withdrawal. Appointment duration, buffer, interval, and reservation TTL are environment settings. All appointment timestamps are stored in UTC; weekly working hours retain the doctor's IANA timezone.

## Checks

Run `npm run db:validate`, `npm test`, `npm run lint`, and `npm run typecheck`. PostgreSQL constraints prevent overlapping active doctor AND client bookings.

PUT working hours replaces all windows; an empty array clears them. Input and output use HH:mm, interpreted in the doctor's IANA timezone. Overnight 23:00–03:00 ends the following day. Invalid or ambiguous DST boundaries are skipped. Actual bookings/blocks use UTC; display appointments in the doctor's timezone.

Default appointment model: 60 minutes = 40 therapy + 20 protected buffer, one booking. Session plus buffer must equal interval. Join access starts JOIN_EARLY_MINUTES (default 10) before therapy and ends strictly at therapy end; JWTs expire at that cutoff.

DELETE /api/doctor/account rejects any PENDING/CONFIRMED booking with endTime > now, including in-progress appointments. It revokes access, disables availability and anonymizes PII while retaining financial history.

Canonical booking routes are /api/bookings/*; identically secured singular /api/booking/* aliases remain. Doctor clients must check the shared login response role before entering the app. Each doctor endpoint independently enforces the role.

Production requires HTTPS CORS origins, strong secrets, and payout encryption. TRUST_PROXY is empty by default; set only explicit trusted proxy addresses/CIDRs. Health endpoints: /health/live and /health/ready.

The additive hardening migration uses NOT VALID for new checks that may conflict with legacy data; audit existing rows before validating those constraints. Drain old API instances and let existing Redis holds expire when deploying the changed reservation key. Encrypt or re-enroll legacy plaintext payout tokens before enabling a provider worker.

Four infrastructure tests require a disposable migrated PostgreSQL database and dedicated Redis database supplied through INTEGRATION_DATABASE_URL and INTEGRATION_REDIS_URL. Otherwise they are explicitly skipped.

See [API changes](docs/API_CHANGES.md) and [hardening report](docs/HARDENING_REPORT.md), including the remaining Redis/PostgreSQL commit limit and provider boundaries.
