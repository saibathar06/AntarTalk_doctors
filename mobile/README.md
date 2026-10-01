# AntarTalk Doctor Mobile

Expo Router mobile app for the shared AntarTalk backend. It is intentionally a separate workspace from the Doctor website, so Android and iOS builds do not affect the existing web deployment.

## Run locally

```sh
cd mobile
cp .env.example .env
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL` to the HTTPS origin of the shared Doctors API. Never place JWT, SMTP, Razorpay, database, Redis, or video-service secrets in this app.

For a physical phone running Expo Go on the same network, use a reachable HTTPS development tunnel or a backend LAN URL that the phone can access. A phone cannot call `127.0.0.1` on your development computer.

## API use

- Doctor/Admin password + OTP flow: `/api/doctor/auth/*`
- Doctor workspace: `/api/doctor/*`
- Admin verification: `/api/admin/*`
- Device push registration: `/api/notifications/devices`

The app sends `X-Client-Surface: MOBILE`. This is the only surface that receives a rotated refresh token from the shared Doctor-auth API, which is then held in Expo SecureStore. Browser callers retain the existing HttpOnly-cookie flow.

## Native permissions

- Notifications: requested only from Settings, then the Expo device token is registered with the backend.
- Camera/microphone: requested only immediately before joining a session.
- Photo library/documents: requested only when the doctor chooses an upload.

## Notes

The backend remains authoritative for eligibility, availability, booking state, financial records, verification, session authorization and video attendance. The mobile client renders server data and never calculates earnings, slot availability, or session completion locally.

Credential documents are shown in an authenticated in-app WebView. The access token is passed only as a request header—never embedded in a URL—so the existing private download endpoint remains private.
