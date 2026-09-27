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
| CORS_ORIGINS | Exact comma-separated website origins. Production permits HTTPS origins and explicit HTTP loopback origins such as `http://localhost:5173` / `http://127.0.0.1:5173`; arbitrary HTTP origins remain rejected. |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE | Brevo: `smtp-relay.brevo.com`, `587` (or 2525), `false`; default local SMTP port is 1025 |
| SMTP_USER / SMTP_PASS / EMAIL_FROM | Required in production; Brevo SMTP username/key and a Brevo-verified sender |
| SMTP_CONNECTION_TIMEOUT_MS / SMTP_GREETING_TIMEOUT_MS / SMTP_SOCKET_TIMEOUT_MS | Optional SMTP timeouts; defaults match the working user-auth setup: 10000 / 10000 / 15000 ms |
| UPLOAD_DIR | New; defaults to `./uploads`; private persistent volume required |
| PAYOUT_ENCRYPTION_KEY | 64 random hexadecimal characters; required in production |
| NODE_ENV / PORT / TRUST_PROXY | Production / 4000 / explicitly trusted proxy CIDRs only |

Existing scheduling/OTP settings remain supported. Default appointment: **40 minutes therapy + 20 minutes protected buffer = one 60-minute booking**.

Production: `npm run web:build`, then `npm start`. Express serves `/doctor/*` and `/assets/*`. Deploy API and website under one HTTPS origin (or reverse-proxy `/api` to the API). The browser client deliberately uses relative URLs and same-origin cookies. Production cookies are Secure, HttpOnly and SameSite=Strict; all doctor-auth POSTs require a configured Origin. Access JWTs remain in memory, never localStorage/sessionStorage. Refresh rotates under a cross-tab Web Lock where supported.

For multiple API instances, mount the same private upload volume. Photos are decoded, resized, stripped of metadata and re-encoded. PDFs are served as authenticated attachments with sandbox CSP, never inline public content. Restrict volume access and backups. Add malware scanning/quarantine before expanding document handling beyond this narrow private workflow.

## Website routes

`/doctor/login`, `/doctor/register`, `/doctor/verify`, `/doctor/dashboard`, `/doctor/appointments`, `/doctor/clients`, `/doctor/availability`, `/doctor/profile`, `/doctor/settings`, `/doctor/earnings`, `/doctor/admin`. The legacy `/doctor/schedule` URL redirects to Appointments.

Protected pages require a valid doctor session. A server 401 triggers one serialized refresh/retry; session failure returns the user to sign-in. Incomplete profiles can browse their workspace; profile completion is a card/link, not a blocking modal. Appointments has upcoming, today, completed and cancelled filters. Appointment times use the saved doctor timezone.

## New/extended API contract

All JSON results retain `{ "success": true, "data": ... }`. Errors retain `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`; details are optional. Use JSON Content-Type except uploads. Doctor data routes require `Authorization: Bearer <accessToken>` and active, email-verified DOCTOR ownership. No route accepts a doctorId from the browser to select another doctor's data.

### Browser password + OTP authentication

All paths below start `/api/doctor/auth`. All require an allowed `Origin`; missing/untrusted Origin is 403 ORIGIN_REQUIRED. IP/account rate limits, OTP cooldown, expiry and attempt limits reuse existing services. OTPs are never returned or logged.

| Method / path | Body | Result |
| --- | --- | --- |
| POST /register | `firstName`, `lastName`, `email`, `password`, `phoneNumber` (E.164), `dateOfBirth` (YYYY-MM-DD, adult), `licenseNumber`, `professionalCategory`, optional `timezone` | 201 password-step challenge (below); creates PENDING, incomplete, not-accepting doctor and sends verification email |
| POST /login | `email`, `password` | 200 password-step challenge; no access/refresh tokens until OTP succeeds |
| POST /send-otp | `challengeToken` | 200 `{status, message, retryAfterSeconds, otpExpiresInSeconds}`; reports OTP_SENT or OTP_COOLDOWN |
| POST /verify-otp | `challengeToken`, six-digit `otp` | 200 `{accessToken, expiresIn}`; sets refresh cookie; VERIFY_EMAIL also verifies email |
| POST /refresh | Empty JSON, browser refresh cookie | 200 `{accessToken, expiresIn}` and rotated cookie |
| POST /logout | Bearer token + refresh cookie; optional `allDevices: true` | 200 `{loggedOut: true}`; clears cookie and revokes refresh; allDevices also revokes access versions |

Login uses email, not phone. All codes go to registered email; no claim of SMS/phone verification is made. Website signup uses the existing categories PSYCHOLOGIST, PSYCHIATRIST, COUNSELLOR and LICENSED_PROFESSIONAL status. Existing final-year-student registration through `/api/auth/register` remains intact, and existing student accounts can sign in to the website. No unsupported categories were silently mapped.

Passwords require 10–128 characters with uppercase, lowercase and a digit, and are stored only as Argon2id hashes. Password-step responses contain `{challengeToken, email, purpose, status, message, retryAfterSeconds, otpExpiresInSeconds}`. Purpose is chosen by the server: VERIFY_EMAIL for unverified email, otherwise DOCTOR_LOGIN. The proof expires after 15 minutes, is not an access token, and is kept only in React memory. Reloading verification requires entering credentials again. OTP_SENT means SMTP accepted the send, not guaranteed inbox delivery; OTP_COOLDOWN does not claim a new email was sent and has null otpExpiresInSeconds. Email delivery failures return 503 EMAIL_DELIVERY_UNAVAILABLE.

No database migration is needed for the registration-name fields. Deploy backend and website together. **Compatibility change:** shared POST `/api/auth/login` returns the password-step challenge for DOCTOR accounts too, preventing a password-only bypass; CLIENT/ADMIN flows are unchanged. Existing sessions expire/revoke normally.

Relevant errors: 422 VALIDATION_ERROR, 409 REGISTRATION_CONFLICT for duplicate website registration, 400 INVALID_OTP/OTP_EXPIRED, 429 OTP_ATTEMPTS_EXCEEDED/RATE_LIMITED, 401 INVALID_CREDENTIALS/AUTH_CHALLENGE_EXPIRED/INVALID_REFRESH_TOKEN/REFRESH_TOKEN_REUSE/SESSION_REVOKED. If registration's SMTP delivery fails after commit, sign in with the submitted password to request verification again; do not create a second account.

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
  preferredSessionLanguage: string | null;
  expertise: string[];
  consultationFee: string | null;       // decimal, profile preference only
  emailNotifications: boolean;         // preference; no notification worker yet
  profileCompleted: boolean;
  completionPercentage: number;
  missingFields: string[];
  canTakeSessions: boolean;
}
```

PATCH accepts the existing editable fields plus qualification, institution, graduationYear (1900–2200), experienceYears (integer 0–80), languages (max 20, 80 chars each), preferredSessionLanguage (max 80 chars), expertise (max 20, 100 chars each), consultationFee (positive decimal, max 10,000,000), emailNotifications. URLs, completion/eligibility flags and verificationStatus are **not** writable. Credentials, including qualification/institution/graduationYear, trigger PENDING and pause bookings. Clearing required fields also pauses bookings. Existing email change still requires currentPassword and triggers re-verification/token revocation; the website intentionally does not expose an incompatible passwordless email-change form.

POST `/api/doctor/profile/photo` or `/documents`: multipart single `file`, max 5 MB; JPEG/PNG/WebP, plus PDF for documents. 201 `{url}`. Document replacement requires professional re-verification. GET `/api/doctor/files/:filename` is authenticated, ownership-checked binary response, not JSON; 404 on unowned/missing files. Fetch blobs with Bearer and display using object URLs, as the website does. 422 FILE_REQUIRED/INVALID_FILE/INVALID_IMAGE/INVALID_UPLOAD. Uploads do not put binaries in PostgreSQL.

Completion consists of ten checks: first+last name, photo, category, nonnegative experience, qualification, status-appropriate credentials, nonblank bio, languages, preferred session language, and expertise. Eligibility centrally additionally requires ACTIVE account, verified email, VERIFIED professional and accepting bookings. Completion does not approve credentials.

### Lightweight admin verification

The same website login accepts only DOCTOR and ADMIN accounts. After the password + OTP sequence, the server-derived role routes a doctor to `/doctor/dashboard` and an administrator to `/doctor/admin`; CLIENT accounts are rejected by the doctor-app login. There is no general admin dashboard, analytics, financial reporting or user-management surface.

Doctors explicitly submit a complete profile with `POST /api/doctor/verification/submit`. It sets `verificationStatus` to `PENDING`, records `verificationSubmittedAt`, clears any prior rejection reason, and forces `isAcceptingBookings` to false. A mere registration or incomplete PENDING profile is not visible to reviewers. Credential or license-document changes clear the submission and pause bookings, so the doctor must submit again.

| Endpoint | Authorization | Result |
| --- | --- | --- |
| GET `/api/admin/verification-requests?page=1&limit=25` | ADMIN | Submitted PENDING review queue only |
| GET `/api/admin/verification-requests/:id` | ADMIN | One submitted profile’s review-safe professional details |
| GET `/api/admin/doctors?page=1&limit=25&status?` | ADMIN | Paginated doctor directory; optional verification status filter |
| GET `/api/admin/doctors/:id` | ADMIN | One doctor’s professional profile, never client or clinical data |
| GET `/api/admin/doctors/:id/license-document` | ADMIN | Attached credential document for a doctor profile; authenticated download |
| PATCH `/api/admin/doctors/:id/verification` | ADMIN | Body `{status: "VERIFIED" | "REJECTED", expectedUpdatedAt, reason?}`; rejection requires a reason |

The decision endpoint locks the doctor profile and rejects a stale browser decision with `409 VERIFICATION_REQUEST_CHANGED` if the profile changed after it was opened. Every submit, approval and rejection creates an audit log. Approval sets `VERIFIED` but leaves `isAcceptingBookings: false`; the doctor has to opt in after approval. Rejection stores the reason for the doctor and leaves bookings off. The directory lets an administrator inspect professional information and retrieve an attached credential document, but does not expose client or clinical records.

### Workspace reads

| Endpoint | Query | Data |
| --- | --- | --- |
| GET /api/doctor/dashboard | None | `todaySessions`, `totalClients`, `monthSessions`, trusted ledger-derived `earnings`, `averageRating: null`, `schedule` page, `timezone` |
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

`202609260001_doctor_website` adds DOCTOR_LOGIN to OtpPurpose and ten DoctorProfile columns with defaults/nullability and checks for experience/year/fee. `202609270001_preferred_session_language` adds the nullable preferred session language column. No data drop, reset, booking duplication or rewrite. profileCompleted/canTakeSessions are derived, not stored booleans. Apply migrations before serving the updated website.

**Rollout consequence:** existing profiles lack newly required fields; they need profile completion before new booking/join eligibility. Existing bookings are retained. Coordinate completion before scheduled sessions. Credentials cannot be self-approved.

## Checks and operational limits

Signup reliability update: 132 backend tests and 18 browser tests passed, including the real form payload checked against the shared registration Zod schema, HTML gateway errors, email failures and verification recovery without duplicate registration. Live localhost probes reached Render (401 on unauthenticated refresh, 422 on deliberately empty registration); no real account was created or email sent. SMTP timeout/error handling changes require redeployment of the Render backend; credentials remain provider-managed. Local proxy failures now return structured JSON with a request reference, and received upstream responses are marked separately in `X-AntarTalk-Gateway`. No automatic signup retries were added.

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

No live video, payout/payment provider, rating service, appointment-notification delivery or SMS service is connected. Notification preference is persisted and explicitly labeled as future functionality. Consultation fee is not authoritative pricing. Categories were preserved rather than expanding clinical eligibility without policy. Client identities remain private pseudonyms until a scoped client-name model exists.

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
