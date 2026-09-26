-- Additive migration. Legacy payments remain readable but cannot fund new bookings
-- until a trusted order/pricing process supplies the missing binding fields.
ALTER TABLE "Payment"
 ADD COLUMN "doctorId" UUID,
 ADD COLUMN "slotStart" TIMESTAMPTZ(3),
 ADD COLUMN "slotEnd" TIMESTAMPTZ(3),
 ADD COLUMN "expectedAmount" DECIMAL(12,2),
 ADD COLUMN "expectedCurrency" CHAR(3),
 ADD COLUMN "doctorEarning" DECIMAL(12,2);
ALTER TABLE "Booking" ADD COLUMN "reservationExpiresAt" TIMESTAMPTZ(3);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_doctor_fk"
 FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_amount_check"
 CHECK ("expectedAmount" IS NULL OR ("expectedAmount" > 0 AND "doctorEarning" >= 0 AND "doctorEarning" <= "expectedAmount")) NOT VALID;
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_accept_verified"
 CHECK (NOT "isAcceptingBookings" OR "verificationStatus" = 'VERIFIED') NOT VALID;

-- Deferred guard executes during COMMIT, not at transaction start. clock_timestamp()
-- is essential: CURRENT_TIMESTAMP is frozen at the start of the transaction.
CREATE FUNCTION guard_booking_reservation_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."reservationExpiresAt" IS NOT NULL AND NEW."reservationExpiresAt" <= clock_timestamp() THEN
   RAISE EXCEPTION 'RESERVATION_EXPIRED' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "Booking_reservation_deadline"
AFTER INSERT ON "Booking" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_booking_reservation_deadline();

CREATE FUNCTION guard_payout_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."amount" <> OLD."amount" OR NEW."currency" <> OLD."currency" OR NEW."doctorId" <> OLD."doctorId" OR NEW."payoutAccountId" <> OLD."payoutAccountId" THEN
   RAISE EXCEPTION 'Immutable payout financial fields';
 END IF;
 IF NEW."status" <> OLD."status" AND NOT (
   (OLD."status" = 'PENDING' AND NEW."status" IN ('PROCESSING','CANCELLED','FAILED')) OR
   (OLD."status" = 'PROCESSING' AND NEW."status" IN ('COMPLETED','FAILED'))
 ) THEN RAISE EXCEPTION 'Invalid payout transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Payout_state_guard" BEFORE UPDATE ON "PayoutTransaction"
FOR EACH ROW EXECUTE FUNCTION guard_payout_transition();

CREATE TABLE "EarningReversal" (
 "id" UUID PRIMARY KEY,
 "earningId" UUID NOT NULL UNIQUE REFERENCES "Earning"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION immutable_financial_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Financial record is immutable; use a compensating entry';
END $$;
CREATE TRIGGER "EarningReversal_immutable" BEFORE UPDATE OR DELETE ON "EarningReversal"
FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_currency_valid"
 CHECK ("amount" > 0 AND "currency" ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_window_matches_duration"
 CHECK ("endTime" - "startTime" = make_interval(mins => "sessionDurationMinutes" + "bufferDurationMinutes")) NOT VALID;
CREATE FUNCTION guard_earning_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain financial history'; END IF;
 IF NEW."amount" <> OLD."amount" OR NEW."currency" <> OLD."currency" OR
    NEW."bookingId" <> OLD."bookingId" OR NEW."doctorId" <> OLD."doctorId" OR
    (NEW."status" = 'REVERSED' AND OLD."status" <> 'REVERSED') THEN
   RAISE EXCEPTION 'Use a compensating earning reversal';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Earning_history_guard" BEFORE UPDATE OR DELETE ON "Earning"
FOR EACH ROW EXECUTE FUNCTION guard_earning_history();
