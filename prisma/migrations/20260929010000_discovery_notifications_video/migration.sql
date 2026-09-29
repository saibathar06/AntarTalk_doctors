CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID');
CREATE TYPE "NotificationType" AS ENUM ('SESSION_BOOKED', 'SESSION_CANCELLED', 'SESSION_REMINDER');
CREATE TYPE "VideoCallState" AS ENUM ('PENDING', 'SCHEDULED', 'ENDED', 'CANCELLED', 'FAILED');

CREATE TABLE "PushDevice" (
  "id" UUID PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "token" VARCHAR(300) NOT NULL UNIQUE,
  "platform" "PushPlatform" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "PushDevice_userId_isActive_idx" ON "PushDevice"("userId", "isActive");

CREATE TABLE "Notification" (
  "id" UUID PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "type" "NotificationType" NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(300) NOT NULL,
  "data" JSONB NOT NULL,
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

CREATE TABLE "PushDelivery" (
  "id" UUID PRIMARY KEY,
  "notificationId" UUID NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE,
  "deviceId" UUID NOT NULL REFERENCES "PushDevice"("id") ON DELETE CASCADE,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(3),
  UNIQUE ("notificationId", "deviceId")
);
CREATE INDEX "PushDelivery_sentAt_nextAttemptAt_idx" ON "PushDelivery"("sentAt", "nextAttemptAt");

CREATE TABLE "VideoCall" (
  "id" UUID PRIMARY KEY,
  "bookingId" UUID NOT NULL UNIQUE REFERENCES "Booking"("id") ON DELETE CASCADE,
  "serviceSessionId" VARCHAR(128) UNIQUE,
  "opensAt" TIMESTAMPTZ(3) NOT NULL,
  "closesAt" TIMESTAMPTZ(3) NOT NULL,
  "state" "VideoCallState" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "VideoCall_state_nextAttemptAt_idx" ON "VideoCall"("state", "nextAttemptAt");
CREATE INDEX "DoctorWorkingHour_availableDate_isActive_doctorId_idx" ON "DoctorWorkingHour"("availableDate", "isActive", "doctorId");
