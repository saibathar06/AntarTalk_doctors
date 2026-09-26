# Shared API changes — 2026-09-25

The previously audited contract applies except for the changes below. Response envelopes, roles, shared mobile/web routes and privacy selections remain unchanged.

| Operation | Updated contract |
|---|---|
| GET /api/doctor/sessions/:id | New; Bearer + DOCTOR + VERIFIED. UUID path, no body/query. 200 returns the same DoctorSession object as list items. Missing or foreign sessions: 404 SESSION_NOT_FOUND. |
| GET/PUT /api/doctor/availability | startTime/endTime now return HH:mm. PUT still replaces all windows and regenerates IDs. |
| POST /api/doctor/sessions/:id/join | Join interval is [start minus JOIN_EARLY_MINUTES, therapy end). 403 OUTSIDE_JOIN_WINDOW at therapy end and during buffer. expiresIn is remaining seconds. JWT exp equals therapy cutoff. |
| POST /api/auth/logout | Empty body: 422 VALIDATION_ERROR. Supply refreshToken or allDevices:true. Single-token logout is idempotent; existing access token remains valid until expiry. All-devices logout revokes access tokens too. |
| POST /api/auth/verify-otp | Already-verified/reused OTP: 400 INVALID_OTP. Failed attempts now persist. |
| POST /api/auth/resend-otp | Atomic cooldown returns generic 200 sent:true, also for unknown accounts. This acknowledges a request, not guaranteed delivery. |
| POST /api/auth/forgot-password | Shares the atomic resend cooldown and invalidation path. |
| PATCH /api/doctor/me | DOB validation applies to edits. Concurrent edits: 409 PROFILE_CHANGED. Email changes disable bookings and invalidate prior OTPs as well as sessions. |
| POST /api/doctor/blocked-slots | Future starts only; maximum 366 days. 422 INVALID_BLOCK_RANGE; duplicate/overlapping blocks: 409 BLOCK_OVERLAP. |
| POST /api/doctor/payout-accounts | providerToken encrypted with AES-256-GCM. Missing key: 503 PAYOUT_CONFIGURATION_REQUIRED. GET never returns provider data. |
| POST /api/doctor/payouts/withdraw | Finite positive amounts, at most two decimals, recognized currencies. 409 PAYOUT_RETRY_REQUIRED means retry the SAME key. |
| POST /api/bookings/confirm | Payment must bind client, doctor, exact UTC window, trusted price/currency. 422 PAYMENT_ORDER_MISMATCH for mismatched/unbound orders; 409 PAYMENT_ALREADY_USED for consumed payments. Final Redis check and deferred PostgreSQL expiry guard added. |
| DELETE /api/doctor/account | In-progress and future active bookings prevent deletion: 409 ACTIVE_BOOKINGS_EXIST. |

Malformed JSON: 400 INVALID_JSON. JSON exceeding 32 KiB: 413 PAYLOAD_TOO_LARGE. Pagination page <=10000; limit <=100. Sensitive writes have a 10/minute account limit, plus IP limits. Auth has an additional hashed account/email limit. Safe X-Request-Id values are returned in response headers; invalid values are replaced.

```ts
type WorkingHour = {
  id: string; doctorId: string; dayOfWeek: 1|2|3|4|5|6|7;
  startTime: string; endTime: string; // HH:mm, local wall clock
  timezone: string; isActive: boolean; createdAt: string; updatedAt: string;
};
type DoctorSession = {
  id: string; startTime: string; endTime: string; sessionDurationMinutes: number;
  status: 'PENDING'|'CONFIRMED'|'CANCELLED'|'COMPLETED'|'NO_SHOW';
  earning: null | { amount: string; currency: string; status: 'PENDING'|'AVAILABLE'|'REVERSED' };
};
type JoinAccess = {
  bookingId: string; roomId: string; sessionAccessToken: string; expiresIn: number;
};
```

## Reservation lifecycle and retry rules

AVAILABLE is derived from PostgreSQL schedules/blocks/bookings and Redis holds. Reserve uses atomic Redis NX+TTL and returns Redis-derived expiresAt. Holds bind reservationId, authenticated clientId, doctorId, exact start/end and expiration. Availability returns available windows only, with no reservation-owner disclosure.

RESERVED → CONFIRMED creates a PostgreSQL booking and idempotency record in one serializable transaction. Ownership/deadline are checked again before commit; a deferred trigger compares expiration to PostgreSQL clock_timestamp(). Same-key concurrent requests serialize and replay the stored result. Idempotency rows are not automatically cleaned up.

RESERVED → EXPIRED → AVAILABLE happens through Redis TTL removal, without a permanent EXPIRED row. The window must still be otherwise bookable. No early-release endpoint was added.

PostgreSQL exclusion constraints apply to PENDING/CONFIRMED bookings for both doctor and client. CANCELLED/COMPLETED/NO_SHOW intentionally do not occupy active windows. Default scheduling remains one 60-minute booking = 40 therapy + 20 buffer.

## Distributed commit limitation

The final Redis read and PostgreSQL COMMIT are separate operations. A Redis failure detected before commit aborts; data loss strictly after the final read cannot be detected atomically at commit. The deferred database guard rejects deadline expiration when it executes, but cannot inspect Redis or guarantee that neither server fails after that check. Keep clocks synchronized. This is NOT an absolute cross-store atomicity guarantee.

No payout-account PATCH/DELETE was added: provider lifecycle/retention semantics are undefined. No public session/financial-status transition endpoints were added. Internal settlement and full-refund reversal helpers require trusted integrations; partial refunds and cancellation policy remain unspecified.
