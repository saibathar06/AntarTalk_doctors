ALTER TABLE "User"
  ADD COLUMN "firstName" VARCHAR(100),
  ADD COLUMN "lastName" VARCHAR(100),
  ADD COLUMN "dateOfBirth" DATE;

-- This preserves the current test accounts that were converted from a doctor
-- account to CLIENT. Future client registration/profile flows should write
-- these fields directly on User.
UPDATE "User" AS u
SET
  "firstName" = d."firstName",
  "lastName" = d."lastName",
  "dateOfBirth" = d."dateOfBirth"
FROM "DoctorProfile" AS d
WHERE d."userId" = u.id
  AND (u."firstName" IS NULL OR u."lastName" IS NULL OR u."dateOfBirth" IS NULL);
