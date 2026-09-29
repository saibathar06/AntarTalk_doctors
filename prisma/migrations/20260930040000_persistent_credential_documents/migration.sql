-- Credential documents are private durable data. Store new uploads in
-- PostgreSQL so they survive stateless web-service restarts and redeploys.
CREATE TABLE "DoctorCredentialDocument" (
  "doctorId" UUID NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "DoctorCredentialDocument_pkey" PRIMARY KEY ("doctorId")
);

ALTER TABLE "DoctorCredentialDocument"
  ADD CONSTRAINT "DoctorCredentialDocument_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
