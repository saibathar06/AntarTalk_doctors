# Hardening implementation report

## Scope and result

One existing shared backend was modified. No mobile/web frontend or second API service was created. The original repository uses JavaScript; TypeScript now checks the runtime source with checkJs, without a rewrite.

This is not a production certification: live migrations/concurrency tests could not be executed against a database service here, and independent Redis/PostgreSQL stores cannot provide the absolute atomic-commit guarantee requested.

## Critical changes

- Persist failed OTP attempt counters instead of rolling them back; serialize challenge use/resend under a user row lock. Enforce cooldown for forgot-password too, reject consumed challenges, invalidate old challenges on email change.
- Recheck active account state when issuing/rotating/revoking tokens, constrain JWT algorithm, remove unused refresh JWT secret, require meaningful logout input, perform dummy password verification for unknown users.
- Recheck profile state inside transactions; explicit profile allowlist; compare dates by value; disable bookings on email change; synchronize recurring timezone fields.
- Account deletion checks appointment end, serializes against booking, clears DOB/graduation data and block reasons, revokes OTPs/tokens, and fixes the oversized phone placeholder.
- Serializable transaction helper with bounded retries; idempotency replay checked again inside booking/payout transactions. Payouts serialize balance consumption and recheck doctor ownership/verification.
- Payment records bind client, doctor, exact window, expected price/currency and doctor earning. Reject mismatches, failed/refunded payments, and previously consumed payments. No public payment success setter.
- Redis uses atomic NX/expiry with Redis-time-derived expiration and atomic read/TTL checks. Confirmation checks full ownership/end and revalidates before returning from its transaction. Deferred PostgreSQL deadline guard executes at commit. Redis cleanup failure cannot turn an already committed booking into a false failure.
- Preserved doctor/client active-booking exclusion constraints. Blocking, schedule edits, verification and account deletion use compatible doctor locks/transactions.
- Session detail endpoint preserves privacy. Join authorization and JWT expiry end at therapy cutoff, excluding buffer.
- HH:mm working-hour responses, future bounded blocks, duplicate-block rejection, calendar/DST regression tests.
- Provider token AES-GCM encryption for new accounts. Trusted internal settlement derives earnings from payment; unique compensating full-refund reversal records reduce available balance. No client financial/status mutation endpoint.
- Payout state transition and immutable financial-history database guards; money precision/currency validation; pagination bounds.
- Explicit proxy trust, safe request IDs, no request bodies/query URLs or raw provider/Prisma errors in logs, bounded body size, safe JSON errors, account-level sensitive-operation limits, independent liveness/readiness.

## API changes

See API_CHANGES.md for routes, types, response changes and frontend behavior. Major changes: GET session detail, HH:mm hours, therapy-limited join tokens, meaningful logout input, stronger payment binding, block/amount validation, and active-session deletion protection. Existing plural/singular booking aliases share all middleware.

No payout-account update/delete or reservation-release endpoint was added; no provider lifecycle policy exists, and reservation cleanup remains TTL-based.

## Database changes

The original migrations are preserved. New migration: 20260925000000_hardening.

- Nullable priced-order fields on Payment; legacy records preserved but unbound payments cannot fund new bookings.
- Booking.reservationExpiresAt and deferred insertion-time deadline trigger.
- EarningReversal with one compensating full reversal per earning; immutable financial data guards.
- Payout transition guard and price/window/verified-bookability checks.
- NOT VALID checks enforce new writes while allowing a separate legacy-data audit before full validation.

Migration deployment was attempted against the explicit local test database, including outside the sandbox. Prisma returned a schema-engine error; no reachable PostgreSQL service was configured. Do not consider this migration exercised or applied.

## Redis changes

Key identity is doctor + exact UTC start, independent of configurable duration. Atomic Lua acquisition uses NX+EX and Redis TIME, and ownership validation checks TTL. All errors fail closed; no Redis-error-as-empty fallback. Shared rate-limit counters remain in Redis.

Deployment requires draining old instances and waiting for old 180-second holds to expire before using the changed key format. Redis must be dedicated/secured, clocks synchronized, and eviction/data loss monitored.

## Verification and tests

- npm run db:validate: passed.
- npm run db:generate: passed.
- npm run db:migrate: failed locally with Prisma schema-engine error; migration not verified on a running server.
- npm test: 81 passed; 4 infrastructure tests skipped without explicit integration URLs.
- npm run lint: passed.
- npm run typecheck: passed; TypeScript checkJs over src.

Regression coverage includes OTP rollback/reuse/cooldown, inactive accounts, JWT role boundaries, session IDOR/privacy and therapy cutoff, payment/order mismatch/replay, retry-model booking and withdrawal concurrency, ledger reversal, deletion during active appointments, amount/currency/mass assignment, provider encryption, UTC/Kolkata and DST schedules.

The four opt-in infrastructure tests cover concurrent doctor overlap, concurrent client overlap, deferred expired-deadline rejection, and Redis acquisition plus simultaneous real confirmations. They require INTEGRATION_DATABASE_URL and INTEGRATION_REDIS_URL pointing to disposable migrated services. Mock transaction tests do not prove PostgreSQL locking behavior.

## Remaining integration and assurance limits

- The Redis read and PostgreSQL commit are not atomic together. Redis disappearance strictly after the final read cannot be observed at commit. The deferred expiration guard is the strongest local check implemented, not a distributed transaction. Thus the literal absolute guarantee in the request is not fully met.
- Two bounded Redis calls inside booking transactions are deliberate to perform late validation; no email/payment/video/payout provider calls run inside those transactions. Redis command timeout is 1 second; transaction timeout is 5 seconds.
- No payment webhook/provider, pricing policy, payout worker/provider or video integration exists. Successful trusted priced orders and booking completion remain integration responsibilities.
- Earnings settlement/full-refund helpers are explicit internal integration points. No cancellation policy, partial-refund allocation or automated settlement timing was invented. Provider workflows must invoke reversals after refunds. Legacy REVERSED earnings remain supported.
- Existing plaintext payout tokens need a separate controlled encryption migration or re-enrollment before payout-provider use. New records are encrypted; keys need deployment secret management/rotation.
- Idempotency records are retained; no cleanup job is installed. Shared login intentionally authenticates all roles; Doctor clients must reject non-DOCTOR responses, and backend routes enforce DOCTOR independently.
- Live concurrency/load/failure-injection coverage and production database validation remain release gates. The automated suite is broader but is not exhaustive evidence for every scenario in the request.

## File inventory

Modified:

- .env.example
- package.json
- package-lock.json
- README.md
- prisma/schema.prisma
- src/app.js
- src/config/env.js
- src/lib/logger.js
- src/lib/prisma.js
- src/lib/redis.js
- src/middleware/auth.js
- src/middleware/errorHandler.js
- src/middleware/rateLimits.js
- src/routes/admin.routes.js
- src/routes/auth.routes.js
- src/routes/booking.routes.js
- src/routes/doctor.routes.js
- src/services/audit.service.js
- src/services/auth.service.js
- src/services/availability.service.js
- src/services/booking.service.js
- src/services/doctor.service.js
- src/services/payout.service.js
- src/services/session.service.js
- src/utils/tokens.js
- src/validation/auth.schemas.js
- src/validation/common.js
- src/validation/doctor.schemas.js
- tests/slots.test.js

Created:

- prisma/migrations/20260925000000_hardening/migration.sql
- src/services/transaction.service.js
- src/services/payment.service.js
- src/services/earnings.service.js
- src/utils/encryption.js
- src/utils/profileInput.js
- src/types/express.d.ts
- tsconfig.json
- vitest.config.js
- tests/hardening.test.js
- tests/auth-regressions.test.js
- tests/booking-concurrency.test.js
- tests/authorization-account.test.js
- tests/earnings-regressions.test.js
- tests/database.integration.test.js
- docs/API_CHANGES.md
- docs/HARDENING_REPORT.md
