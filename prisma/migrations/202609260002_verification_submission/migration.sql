-- Draft profiles must be explicitly submitted; existing approvals remain intact.
ALTER TABLE "DoctorProfile"
  ADD COLUMN "verificationSubmittedAt" TIMESTAMPTZ(3),
  ADD COLUMN "verificationReason" VARCHAR(500);
