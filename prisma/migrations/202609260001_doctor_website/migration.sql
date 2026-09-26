ALTER TYPE "OtpPurpose" ADD VALUE 'DOCTOR_LOGIN';
ALTER TABLE "DoctorProfile"
  ADD COLUMN "profileImageUrl" VARCHAR(300),
  ADD COLUMN "licenseDocumentUrl" VARCHAR(300),
  ADD COLUMN "qualification" VARCHAR(200),
  ADD COLUMN "institution" VARCHAR(200),
  ADD COLUMN "graduationYear" INTEGER,
  ADD COLUMN "experienceYears" INTEGER,
  ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "expertise" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "consultationFee" DECIMAL(12,2),
  ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "Doctor_experience_valid" CHECK ("experienceYears" BETWEEN 0 AND 80),
  ADD CONSTRAINT "Doctor_graduation_valid" CHECK ("graduationYear" BETWEEN 1900 AND 2200),
  ADD CONSTRAINT "Doctor_fee_valid" CHECK ("consultationFee" > 0 AND "consultationFee" <= 10000000);
