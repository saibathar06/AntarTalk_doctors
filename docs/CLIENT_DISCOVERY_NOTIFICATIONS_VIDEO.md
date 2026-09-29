# Client discovery, notifications and video

This Express service remains the shared source for the doctor website, client website and both mobile apps. PostgreSQL owns working hours, bookings, notifications and video-session metadata. Redis owns only temporary 180-second slot holds.

## Find a doctor for an exact time

`GET /api/bookings/doctors/search?date=2030-01-02&startTime=10:00&page=1&limit=20`

Optional filters: `professionalCategory`, `language`, `gender`, `minimumFee`, `maximumFee`. Date and time are interpreted in `Asia/Kolkata`; results are limited to today plus six days. The API uses the same working-hour/default-time, dated override, blocked-period, confirmed/pending booking and Redis-reservation logic as ordinary availability. It returns only currently available doctors and the exact UTC booking window. The frontend must not generate slots or infer availability.

Continue through the existing flow:

1. `POST /api/bookings/reserve` with a CLIENT access token.
2. `POST /api/bookings/razorpay/order` and complete Razorpay checkout.
3. `POST /api/bookings/razorpay/verify` with an `Idempotency-Key`; verification confirms the booking.

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

Only the booking's doctor or client can request a ticket. The booking must be `CONFIRMED`, and requests are allowed from `JOIN_EARLY_MINUTES` before start until the 40-minute therapy period ends. The 20-minute buffer is never joinable. For `WEB`, the trusted parent origin is selected server-side; callers cannot inject it. For `MOBILE`, the React Native WebView receives the returned `launchUrl` and should restrict navigation to the returned `videoOrigin` and `/call`.

Required production rollout: apply migration `20260929010000_discovery_notifications_video`, deploy the video ZIP as a separate HTTPS service, set its private API key on both services, then set the exact web origins. Without video configuration booking still works; join returns `503 VIDEO_NOT_CONFIGURED` and the provisioning worker remains idle.
