-- Private psychiatrist signatures and issued prescriptions are durable clinical
-- records. PDFs are stored with the textual medicine instructions so a retryable
-- email does not recreate a different document.
CREATE TABLE "DoctorSignature" (
  "doctorId" UUID NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DoctorSignature_pkey" PRIMARY KEY ("doctorId")
);

ALTER TABLE "DoctorSignature"
  ADD CONSTRAINT "DoctorSignature_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Prescription" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "doctorId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "medicines" TEXT NOT NULL,
  "instructions" TEXT,
  "pdfData" BYTEA NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Prescription_bookingId_key" ON "Prescription"("bookingId");
CREATE INDEX "Prescription_doctorId_issuedAt_idx" ON "Prescription"("doctorId", "issuedAt");
CREATE INDEX "Prescription_clientId_issuedAt_idx" ON "Prescription"("clientId", "issuedAt");

ALTER TABLE "Prescription"
  ADD CONSTRAINT "Prescription_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prescription"
  ADD CONSTRAINT "Prescription_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prescription"
  ADD CONSTRAINT "Prescription_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PrescriptionEmail" (
  "id" UUID NOT NULL,
  "prescriptionId" UUID NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(3),
  CONSTRAINT "PrescriptionEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrescriptionEmail_prescriptionId_key" ON "PrescriptionEmail"("prescriptionId");
CREATE INDEX "PrescriptionEmail_sentAt_nextAttemptAt_idx" ON "PrescriptionEmail"("sentAt", "nextAttemptAt");

ALTER TABLE "PrescriptionEmail"
  ADD CONSTRAINT "PrescriptionEmail_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
