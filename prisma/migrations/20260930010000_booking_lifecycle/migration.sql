CREATE TYPE "CancellationActor" AS ENUM ('CLIENT', 'DOCTOR');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESCHEDULE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_PROCESSED';

ALTER TABLE "Booking"
  ADD COLUMN "cancelledBy" "CancellationActor",
  ADD COLUMN "cancellationReason" VARCHAR(500),
  ADD COLUMN "rescheduleCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_reschedule_count_check" CHECK ("rescheduleCount" BETWEEN 0 AND 1);

ALTER TABLE "BookingEmail"
  ADD COLUMN "kind" VARCHAR(40) NOT NULL DEFAULT 'CONFIRMATION',
  ADD COLUMN "eventKey" VARCHAR(80) NOT NULL DEFAULT 'initial',
  ADD COLUMN "eventData" JSONB;
DROP INDEX "BookingEmail_bookingId_audience_key";
CREATE UNIQUE INDEX "BookingEmail_bookingId_audience_kind_eventKey_key"
  ON "BookingEmail"("bookingId", "audience", "kind", "eventKey");

CREATE TABLE "RefundTransaction" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "providerReference" VARCHAR(200),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" VARCHAR(100),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RefundTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefundTransaction_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "RefundTransaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "RefundTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefundTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefundTransaction_bookingId_key" ON "RefundTransaction"("bookingId");
CREATE UNIQUE INDEX "RefundTransaction_paymentId_key" ON "RefundTransaction"("paymentId");
CREATE UNIQUE INDEX "RefundTransaction_providerReference_key" ON "RefundTransaction"("providerReference");
CREATE INDEX "RefundTransaction_status_nextAttemptAt_idx" ON "RefundTransaction"("status", "nextAttemptAt");
CREATE FUNCTION guard_refund_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bookingId" <> OLD."bookingId" OR NEW."paymentId" <> OLD."paymentId" OR NEW."amount" <> OLD."amount" OR NEW."currency" <> OLD."currency" THEN
    RAISE EXCEPTION 'Immutable refund financial fields';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('PROCESSING','FAILED','COMPLETED')) OR
    (OLD."status" = 'PROCESSING' AND NEW."status" IN ('COMPLETED','FAILED')) OR
    (OLD."status" = 'FAILED' AND NEW."status" IN ('PROCESSING','COMPLETED'))
  ) THEN RAISE EXCEPTION 'Invalid refund transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Refund_state_guard" BEFORE UPDATE ON "RefundTransaction"
FOR EACH ROW EXECUTE FUNCTION guard_refund_transition();

CREATE TABLE "DoctorPenalty" (
  "id" UUID NOT NULL,
  "doctorId" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoctorPenalty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorPenalty_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "DoctorPenalty_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "DoctorPenalty_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DoctorPenalty_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DoctorPenalty_bookingId_key" ON "DoctorPenalty"("bookingId");
CREATE INDEX "DoctorPenalty_doctorId_currency_createdAt_idx" ON "DoctorPenalty"("doctorId", "currency", "createdAt");
CREATE TRIGGER "DoctorPenalty_immutable" BEFORE UPDATE OR DELETE ON "DoctorPenalty"
FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();

CREATE TABLE "RescheduleRequest" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "requesterId" UUID NOT NULL,
  "proposedStartTime" TIMESTAMPTZ(3) NOT NULL,
  "proposedEndTime" TIMESTAMPTZ(3) NOT NULL,
  "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(500),
  "respondedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RescheduleRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RescheduleRequest_range_check" CHECK ("proposedStartTime" < "proposedEndTime"),
  CONSTRAINT "RescheduleRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RescheduleRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RescheduleRequest_bookingId_status_createdAt_idx" ON "RescheduleRequest"("bookingId", "status", "createdAt");
CREATE INDEX "RescheduleRequest_requesterId_status_createdAt_idx" ON "RescheduleRequest"("requesterId", "status", "createdAt");
CREATE UNIQUE INDEX "RescheduleRequest_one_pending_per_booking"
  ON "RescheduleRequest"("bookingId") WHERE "status" = 'PENDING';
