CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY');
ALTER TABLE "DoctorProfile" ADD COLUMN "gender" "Gender";
ALTER TABLE "DoctorProfile" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';
