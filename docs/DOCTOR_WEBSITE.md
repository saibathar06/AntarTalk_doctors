# Doctor website handoff

## What was reused

The existing JavaScript Express API, Prisma/PostgreSQL connection, Zod validation, AppError responses, JWT middleware, HMAC-protected OTPs, rotating hashed refresh tokens, SMTP transport, audit logging, Redis rate limits, working hours, blocks, shared Booking table, earnings ledger and join-token service remain in use. Roles remain CLIENT / DOCTOR / ADMIN. There was no frontend, design system, file storage or video-provider integration to reuse.

The new website uses React, Vite, strict TypeScript, DM Sans (self-hosted), Phosphor icons and responsive CSS. No second server, ORM, booking table, session table or mobile app was introduced.

## Running

**Hosted API update:** the Vite development proxy now defaults to `https://antartalk-doctors.onrender.com`. For a local website with that hosted API, run only `npm run web:dev`; add the Render API's HTTPS origin to its `CORS_ORIGINS`. See the README for current setup. `DOCTOR_API_TARGET` in `web/.env.local` can override the target. The proxy accepts only loopback connections with matching browser origins, translates the validated origin upstream, and removes Secure only from the doctor refresh cookie for local HTTP. Production cookie settings are unchanged. The fully local commands below additionally require `DOCTOR_API_TARGET=http://127.0.0.1:4000` and that upstream origin in the local API CORS allowlist. Local development against Render writes to the hosted database.

From `AntarTalk_doctors`:

```sh
npm ci
npm --prefix web ci
npm run db:generate
npm run db:migrate
npm run dev
# Separate terminal:
npm run web:dev
```

Open `/doctor/login` on `http://localhost:5173`. Preserve the existing DATABASE_URL when merging the safe `.env.example`; do not overwrite `.env` blindly. Configure:

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | Shared PostgreSQL; never a separate doctor-booking database |
| REDIS_URL | Required holds and rate limiting |
| JWT_ACCESS_SECRET / OTP_PEPPER | Separate cryptographically random secrets, at least 32 characters |
| CORS_ORIGINS | Exact comma-separated website origins; include `http://localhost:5173` in development |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE | Email delivery; default local SMTP port 1025 |
| SMTP_USER / SMTP_PASS / EMAIL_FROM | Provider credentials and verified sender when required |
| UPLOAD_DIR | New; defaults to `./uploads`; private persistent volume required |
| PAYOUT_ENCRYPTION_KEY | 64 random hexadecimal characters; required in production |
| NODE_ENV / PORT / TRUST_PROXY | Production / 4000 / explicitly trusted proxy CIDRs only |

Existing scheduling/OTP settings remain supported. Default appointment: **40 minutes therapy + 20 minutes protected buffer = one 60-minute booking**.

Production: `npm run web:build`, then `npm start`. Express serves `/doctor/*` and `/assets/*`. Deploy API and website under one HTTPS origin (or reverse-proxy `/api` to the API). The browser client deliberately uses relative URLs and same-origin cookies. Production cookies are Secure, HttpOnly and SameSite=Strict; all doctor-auth POSTs require a configured Origin. Access JWTs remain in memory, never localStorage/sessionStorage. Refresh rotates under a cross-tab Web Lock where supported.

For multiple API instances, mount the same private upload volume. Photos are decoded, resized, stripped of metadata and re-encoded. PDFs are served as authenticated attachments with sandbox CSP, never inline public content. Restrict volume access and backups. Add malware scanning/quarantine before expanding document handling beyond this narrow private workflow.

## Website routes

`/doctor/login`, `/doctor/register`, `/doctor/verify`, `/doctor/dashboard`, `/doctor/schedule`, `/doctor/appointments`, `/doctor/clients`, `/doctor/availability`, `/doctor/profile`, `/doctor/settings`, `/doctor/earnings`.

Protected pages require a valid doctor session. A server 401 triggers one serialized refresh/retry; session failure returns the user to sign-in. Incomplete profiles can browse their workspace; profile completion is a card/link, not a blocking modal. Schedule has a native date calendar and upcoming/today/completed/cancelled filters. Appointment times and calendar dates use the saved doctor timezone.

## New/extended API contract

All JSON results retain `{ "success": true, "data": ... }`. Errors retain `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`; details are optional. Use JSON Content-Type except uploads. Doctor data routes require `Authorization: Bearer <accessToken>` and active, email-verified DOCTOR ownership. No route accepts a doctorId from the browser to select another doctor's data.

### Browser OTP authentication

All paths below start `/api/doctor/auth`. All require an allowed `Origin`; missing/untrusted Origin is 403 ORIGIN_REQUIRED. IP/account rate limits, OTP cooldown, expiry and attempt limits reuse existing services. OTPs are never returned or logged.

| Method / path | Body | Result |
| --- | --- | --- |
| POST /register | `email`, `phoneNumber` (E.164), `dateOfBirth` (YYYY-MM-DD, adult), `licenseNumber`, `professionalCategory`, optional `timezone` | 201 `{message}`; creates PENDING, incomplete, not-accepting doctor and sends verification email |
| POST /send-otp | `identifier` (email or E.164 phone), `purpose`: VERIFY_EMAIL or DOCTOR_LOGIN | 200 generic `{message}` regardless of account existence/eligibility |
| POST /verify-otp | Same identifier/purpose plus six-digit `otp` | 200 `{accessToken, expiresIn}`; sets refresh cookie; VERIFY_EMAIL also verifies email |
| POST /refresh | Empty JSON, browser refresh cookie | 200 `{accessToken, expiresIn}` and rotated cookie |
| POST /logout | Bearer token + refresh cookie; optional `allDevices: true` | 200 `{loggedOut: true}`; clears cookie and revokes refresh; allDevices also revokes access versions |

Phone is an **identifier only**. All codes go to registered email; no claim of SMS/phone verification is made. Website signup uses the existing categories PSYCHOLOGIST, PSYCHIATRIST, COUNSELLOR and LICENSED_PROFESSIONAL status. Existing final-year-student registration through `/api/auth/register` remains intact, and existing student accounts can sign in to the website. No unsupported categories were silently mapped.

A cryptographically random, unknowable password hash satisfies the existing shared User schema for passwordless website signup. Existing `/api/auth/*` password/OTP/refresh endpoints are unchanged and still serve existing clients. Website users can establish a password through the existing reset flow if needed.

Relevant errors: 422 VALIDATION_ERROR, 409 RESOURCE_CONFLICT for duplicate registration, 400 INVALID_OTP/OTP_EXPIRED, 429 OTP_ATTEMPTS_EXCEEDED/RATE_LIMITED, 401 INVALID_REFRESH_TOKEN/REFRESH_TOKEN_REUSE/SESSION_REVOKED. If registration's SMTP delivery fails after commit, use the login page's “still need to verify” option to resend; do not create another account.

### Profile and uploads

GET/PATCH `/api/doctor/profile` alias the same service as GET/PATCH `/api/doctor/me`. GET returns existing personal/professional fields plus:

```ts
interface WebsiteProfileFields {
  profileImageUrl: string | null;       // authenticated relative file URL
  licenseDocumentUrl: string | null;    // authenticated relative file URL
  qualification: string | null;
  institution: string | null;
  graduationYear: number | null;
  experienceYears: number | null;
  languages: string[];
  expertise: string[];
  consultationFee: string | null;       // decimal, profile preference only
  emailNotifications: boolean;         // preference; no notification worker yet
  profileCompleted: boolean;
  completionPercentage: number;
  missingFields: string[];
  canTakeSessions: boolean;
}
```

PATCH accepts the existing editable fields plus qualification, institution, graduationYear (1900–2200), experienceYears (integer 0–80), languages (max 20, 80 chars each), expertise (max 20, 100 chars each), consultationFee (positive decimal, max 10,000,000), emailNotifications. URLs, completion/eligibility flags and verificationStatus are **not** writable. Credentials, including qualification/institution/graduationYear, trigger PENDING and pause bookings. Clearing required fields also pauses bookings. Existing email change still requires currentPassword and triggers re-verification/token revocation; the website intentionally does not expose an incompatible passwordless email-change form.

POST `/api/doctor/profile/photo` or `/documents`: multipart single `file`, max 5 MB; JPEG/PNG/WebP, plus PDF for documents. 201 `{url}`. Document replacement requires professional re-verification. GET `/api/doctor/files/:filename` is authenticated, ownership-checked binary response, not JSON; 404 on unowned/missing files. Fetch blobs with Bearer and display using object URLs, as the website does. 422 FILE_REQUIRED/INVALID_FILE/INVALID_IMAGE/INVALID_UPLOAD. Uploads do not put binaries in PostgreSQL.

Completion consists of nine checks: first+last name, photo, category, nonnegative experience, qualification, status-appropriate credentials, nonblank bio, languages, expertise. Eligibility centrally additionally requires ACTIVE account, verified email, VERIFIED professional and accepting bookings. Completion does not approve credentials. Admin verification stays at PATCH `/api/admin/doctors/:id/verification` with ADMIN authorization.

### Workspace reads

| Endpoint | Query | Data |
| --- | --- | --- |
| GET /api/doctor/dashboard | None | `todaySessions`, `totalClients`, `monthSessions`, `averageRating: null`, `schedule` page, `timezone` |
| GET /api/doctor/appointments | `filter=upcoming\|today\|past\|completed\|cancelled`, optional `date=YYYY-MM-DD` overriding filter, `page=1`, `limit=20` (max100) | Paginated appointments + timezone/serverTime |
| GET /api/doctor/clients | page/limit | Paginated `{label, appointmentCount, latestAppointmentAt}` |

```ts
interface Appointment {
  id: string;
  clientLabel: string; // practice-specific pseudonym, not name or global user ID
  sessionType: 'Therapy session'; // no clinical consultation reason in this schema
  startTime: string; endTime: string; // UTC ISO timestamps
  sessionDurationMinutes: number; bufferDurationMinutes: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  join: { state: 'UNAVAILABLE' | 'ENDED' | 'INELIGIBLE' | 'NOT_YET' | 'READY'; canJoin: boolean; opensAt: string; closesAt: string };
}
interface Page<T> { items: T[]; pagination: {page: number; limit: number; total: number; pages: number} }
```

Today/month counts include CONFIRMED, COMPLETED and NO_SHOW by start date in the doctor's timezone; total clients counts distinct clients with any assigned booking. Ratings are not implemented, so the UI shows an explicit unavailable state. No fake business data ships to the production bundle. Test fixtures live only under `web/tests`.

### Reused services and behavior changes

- GET/PUT availability and GET/POST/DELETE blocked-slots are reused; PUT replaces all windows. Weekdays 1–7, HH:mm wall-clock times, IANA timezone; end earlier than start means next day. Backend generates slots; frontend never creates slots. Blocks are submitted as UTC after timezone-aware conversion with ambiguous/nonexistent DST input rejected.
- GET earnings and earnings/transactions reuse trusted ledger values. Pending professionals see an approval-required state. Payout APIs remain backend functionality; no bank onboarding is fabricated without a provider.
- Existing GET sessions/:id is retained for details. POST sessions/:id/join now rechecks centralized eligibility in addition to doctor ownership, CONFIRMED status and time window. Join opens 10 minutes before start by default and ends at therapy end, never in the buffer. The frontend only enables Join using server `canJoin`; stale UI cannot bypass the POST checks. Successful authorization returns the existing internal session JWT, not a video URL. UI explains the missing video provider honestly.
- Existing DELETE account retains financial/audit rows, rejects unresolved active bookings, revokes sessions, disables availability and now clears additional profile fields and removes referenced uploads after commit. Failed file deletion is logged without file contents; orphan cleanup can retry.
- `/api/bookings/*` and its singular alias still use shared PostgreSQL and Redis. Dynamic availability/confirmation now apply profile-completion eligibility as well. Holds remain temporary Redis state; bookings remain PostgreSQL source of truth with exclusion constraints.

## Database rollout

`202609260001_doctor_website` adds DOCTOR_LOGIN to OtpPurpose and ten DoctorProfile columns with defaults/nullability and checks for experience/year/fee. No data drop, reset, booking duplication or rewrite. profileCompleted/canTakeSessions are derived, not stored booleans. Migration and Prisma generation were successfully run against the configured database.

**Rollout consequence:** existing profiles lack newly required fields; they need profile completion before new booking/join eligibility. Existing bookings are retained. Coordinate completion before scheduled sessions. Credentials cannot be self-approved.

## Checks and operational limits

```sh
npm test
npm run lint
npm run typecheck
npm run db:validate
npm --prefix web run lint
npm run web:build
npm run web:test
```

Browser tests use intercepted, isolated API fixtures to check routing, empty states, OTP requests, responsive pages and availability submission; they do not prove live SMTP/Redis/provider integration. Four database/Redis concurrency tests require disposable INTEGRATION_DATABASE_URL and INTEGRATION_REDIS_URL; never point these at production. The current local `.env` had only DATABASE_URL, so live SMTP/Redis sign-in remains unverified until configured.

Verified during implementation: 118 backend tests passed, 4 infrastructure tests skipped; 12 desktop/mobile Playwright tests passed; backend/frontend lint and TypeScript checks, Prisma validation/generation and production build passed. Both production dependency audits reported zero vulnerabilities. Migration status confirms all four migrations applied. Browser coverage includes profile-save payloads and join authorization; desktop/mobile screenshots were visually inspected.

No live video, payout/payment provider, rating service, appointment-notification delivery, admin review UI or SMS service is connected. Notification preference is persisted and explicitly labeled as future functionality. Consultation fee is not authoritative pricing. Categories were preserved rather than expanding clinical eligibility without policy. Client identities remain private pseudonyms until a scoped client-name model exists.

Local upload cleanup: `npm run uploads:prune` reports orphan counts without deleting. After review, `npm run uploads:prune -- --apply` removes only unreferenced generated files older than 24 hours under UPLOAD_DIR; never directories or referenced files. Schedule this operationally to recover failed deletions. Files removed by cleanup are not recoverable except from your backups.

`.env.example` previously contained apparent credentials; it now contains placeholders. Rotate exposed credentials and address existing repository history separately; this change does not erase prior commits.

## Files

Created:

- `web/`: package/lock, Vite/TypeScript/ESLint/Playwright configs, index.html; `src/main.tsx`, `App.tsx`, `auth.tsx`, `api.ts`, `types.ts`, reusable `components.tsx`, styles/responsive.css; pages AuthPages, WorkspacePages, ProfilePage, AvailabilityPage, SettingsPage; isolated browser tests.
- `src/routes/doctorAuth.routes.js`; services `doctorAuth`, `doctorWorkspace`, `eligibility`, `upload`; `src/scripts/pruneUploads.js`.
- New additive migration; tests `doctor-website.test.js`, `doctor-web-auth-http.test.js`; this handoff.

Modified:

- `prisma/schema.prisma`, package/lock, `.env.example`, `.gitignore`, README, Vitest config.
- `src/app.js`, config/env, mailer, errorHandler/rateLimits, doctor routes, auth/doctor/session/slot services, serializers/profileInput, doctor schemas.
- Existing auth and session regression tests extended for new OTP/eligibility behavior.

Earlier API documentation describes the original backend snapshot. This supplement supersedes it for browser auth, new profile fields and stricter eligibility; legacy request/response contracts otherwise remain supported.
