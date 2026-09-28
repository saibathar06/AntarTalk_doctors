ALTER TABLE "DoctorProfile" ADD COLUMN "availabilityPresets" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "DoctorWorkingHour" ADD COLUMN "availableDate" DATE;
ALTER TABLE "DoctorWorkingHour" ADD CONSTRAINT "DoctorWorkingHour_date_weekday_check" CHECK ("availableDate" IS NULL OR EXTRACT(ISODOW FROM "availableDate") = "dayOfWeek");
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_presets_array_check" CHECK (jsonb_typeof("availabilityPresets") = 'array');
-- Preserve existing hours for the next occurrence only, rather than repeating forever.
UPDATE "DoctorWorkingHour" SET "availableDate" =
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date +
  (("dayOfWeek" - EXTRACT(ISODOW FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::int + 7) % 7);
ALTER TABLE "Booking" ADD COLUMN "clientName" VARCHAR(200), ADD COLUMN "clientAge" INTEGER;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientAge_check" CHECK ("clientAge" IS NULL OR "clientAge" BETWEEN 1 AND 120);
CREATE TABLE "DoctorPhoto" (
  "doctorId" UUID PRIMARY KEY REFERENCES "DoctorProfile"("id") ON DELETE CASCADE,
  "data" BYTEA NOT NULL
);
CREATE TABLE "BookingEmail" (
  "id" UUID PRIMARY KEY,
  "bookingId" UUID NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE,
  "audience" VARCHAR(10) NOT NULL CHECK ("audience" IN ('CLIENT', 'DOCTOR')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(3),
  UNIQUE ("bookingId", "audience")
);
CREATE INDEX "BookingEmail_sentAt_nextAttemptAt_idx" ON "BookingEmail"("sentAt", "nextAttemptAt");
