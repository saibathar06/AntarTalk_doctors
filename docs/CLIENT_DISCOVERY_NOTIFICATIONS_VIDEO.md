# Client discovery, notifications and video

This Express service remains the shared source for the doctor website, client website and both mobile apps. PostgreSQL owns working hours, bookings, notifications and video-session metadata. Redis owns only temporary 180-second slot holds.

## Find a doctor for an exact time

`GET /api/bookings/doctors/search?date=2030-01-02&startTime=10:00&page=1&limit=20`

Optional filters: `professionalCategory`, `language`, `gender`, `minimumFee`, `maximumFee`. Date and time are interpreted in `Asia/Kolkata`; results are limited to today plus six days. The API uses the same working-hour/default-time, dated override, blocked-period, confirmed/pending booking and Redis-reservation logic as ordinary availability. It returns only currently available doctors and the exact UTC booking window. The frontend must not generate slots or infer availability.

Continue through the existing flow:

1. `POST /api/bookings/reserve` with a CLIENT access token.
2. `POST /api/bookings/razorpay/order` and complete Razorpay checkout.
3. `POST /api/bookings/razorpay/verify` with an `Idempotency-Key`; verification confirms the booking.

## Booking lifecycle after confirmation

| Actor | Method and route | Result |
| --- | --- | --- |
| Client | `GET /api/bookings/mine` | Lists only that client's bookings, payments, refunds and latest reschedule state |
| Client | `POST /api/bookings/:bookingId/cancel` | Cancels a future confirmed booking; the consultation charge is retained |
| Client | `POST /api/bookings/:bookingId/reschedule-requests` | Proposes a real backend-generated UTC `startTime`; the original booking stays confirmed |
| Doctor | `POST /api/doctor/reschedule-requests/:id/respond` | Approves or rejects a pending client proposal; approval rechecks availability transactionally |
| Doctor | `POST /api/doctor/sessions/:bookingId/reschedule` | Directly moves the appointment after the same availability checks |
| Doctor | `POST /api/doctor/sessions/:bookingId/cancel` | Cancels and queues a full Razorpay refund; same-day cancellation records the configured adjustment |
| System | Trusted video attendance finalizer | After the therapy period, records server-observed attendance and credits the earning only when both assigned participants joined the call concurrently |

A booking can be successfully rescheduled once. Cancellation and rescheduling are unavailable after the session starts; rescheduling also closes when the video join window opens. Lifecycle emails are always queued. In-app notifications are always stored, and mobile push deliveries are queued only for active registered devices.

## App notification API

All routes require an access token. CLIENT and DOCTOR accounts use the same endpoints.

| Method | Route | Body/result |
| --- | --- | --- |
| POST | `/api/notifications/devices` | `{token, platform: "IOS" | "ANDROID"}`; currently accepts Expo push tokens |
| DELETE | `/api/notifications/devices/:id` | Disables only a device owned by the authenticated user |
| GET | `/api/notifications?page=1&limit=20&unreadOnly=false` | Notification inbox and unread count |
| PATCH | `/api/notifications/:id/read` | Marks only the authenticated user's notification read |

Booking confirmation creates separate client and doctor notification records in the same PostgreSQL transaction as the booking. Delivery jobs are queued for every active device and retried by the API worker. The client receives “Session booked”; the doctor receives “New session booked.” Existing SMTP outbox jobs send the more detailed confirmation email to both sides independently. Never put Expo tokens in logs or analytics.

Mobile apps should obtain the device token after notification permission is granted, register it after login, unregister it on logout, and use the notification `data.route`/`bookingId` for navigation. Expo is the configured transport in this revision; native FCM/APNs would require another provider adapter and credentials, not changes to booking logic.

## Video service integration

The uploaded video service is intentionally deployed separately. Do not copy its MiroTalk/AGPL process into this API. Configure this API with `VIDEO_SERVICE_URL` and the same backend-only `VIDEO_SERVICE_API_KEY` used by the video service. Configure exact `DOCTOR_WEB_ORIGIN` and `CLIENT_WEB_ORIGIN` values for browser embedding. The video service itself still needs its documented `PUBLIC_ORIGIN`, `APP_ORIGINS`, TURN and TLS configuration.

On booking confirmation, the API creates a durable `VideoCall` row. A worker provisions the video service through `POST /v1/sessions`. Launch links are generated only when a participant joins, are short-lived/one-use, are never persisted, and are validated against the configured video origin and `/call` path.

| Participant | Route | Body |
| --- | --- | --- |
| Doctor | POST `/api/doctor/sessions/:bookingId/join` | `{surface: "WEB" | "MOBILE"}` |
| Client | POST `/api/bookings/:bookingId/join` | `{surface: "WEB" | "MOBILE"}` |

Only the booking's doctor or client can request a ticket. The booking must be `CONFIRMED`, and requests are allowed from `JOIN_EARLY_MINUTES` before start until the therapy period ends. For `WEB`, the trusted parent origin is selected server-side; callers cannot inject it. For `MOBILE`, the React Native WebView receives the returned `launchUrl` and should restrict navigation to the returned `videoOrigin` and `/call`.

The video service persistently records trusted doctor/client signaling joins and concurrent connection time. After the call window closes, the API retrieves that record using service authentication. A booking becomes `COMPLETED` and its earning becomes available only when both assigned participants have joined and overlapped for at least `MIN_SESSION_ATTENDANCE_MINUTES` (five minutes by default). Doctors cannot manually mark sessions completed.

Required production rollout: apply migrations through `20260930030000_trusted_video_attendance`, deploy the updated video service as a separate HTTPS service, set its private API key on both services, then set the exact web origins. Without video configuration booking still works; join returns `503 VIDEO_NOT_CONFIGURED` and the provisioning worker remains idle.

For a deployed call service, the following values must agree exactly:

- Video service `SERVICE_API_KEY` = API `VIDEO_SERVICE_API_KEY`.
- Video service `PUBLIC_ORIGIN` = API `VIDEO_SERVICE_URL`, both as the exact HTTPS origin without a trailing path.
- Video service `APP_ORIGINS` includes the exact API-provided `DOCTOR_WEB_ORIGIN` and `CLIENT_WEB_ORIGIN` values.

Production video startup also requires valid `TURN_URLS` and a `TURN_SECRET` of at least 32 characters. A healthy `GET /healthz` only proves the service/database process is running; real public calling still requires TURN. The API safely logs only the provider HTTP status/code and request path when provisioning or ticket issuance fails.
