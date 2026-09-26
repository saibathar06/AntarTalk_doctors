CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE UNIQUE INDEX "User_email_case_insensitive_key" ON "User" (lower("email"));
CREATE UNIQUE INDEX "PayoutAccount_one_default_per_doctor" ON "PayoutAccount" ("doctorId") WHERE "isDefault" = true;

ALTER TABLE "DoctorWorkingHour"
  ADD CONSTRAINT "DoctorWorkingHour_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  ADD CONSTRAINT "DoctorWorkingHour_nonzero_check" CHECK ("startTime" <> "endTime");

ALTER TABLE "DoctorBlockedSlot"
  ADD CONSTRAINT "DoctorBlockedSlot_range_check" CHECK ("startTime" < "endTime");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_range_check" CHECK ("startTime" < "endTime"),
  ADD CONSTRAINT "Booking_duration_check" CHECK ("sessionDurationMinutes" > 0 AND "bufferDurationMinutes" >= 0);

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_doctor_no_overlap"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_client_no_overlap"
  EXCLUDE USING gist (
    "clientId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "Earning"
  ADD CONSTRAINT "Earning_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "PayoutTransaction"
  ADD CONSTRAINT "PayoutTransaction_amount_positive" CHECK ("amount" > 0);
