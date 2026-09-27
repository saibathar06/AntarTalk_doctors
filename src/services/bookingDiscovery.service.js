import path from 'node:path';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { doctorProfileSelect } from '../utils/serializers.js';
import { canDoctorTakeSessions } from './eligibility.service.js';
import { uploadRoot } from './upload.service.js';

const unavailable = () => {
  throw new AppError(404, 'DOCTOR_NOT_BOOKABLE', 'This professional is not currently accepting bookings.');
};

async function findBookableDoctor(doctorId, db = prisma) {
  const doctor = await db.doctorProfile.findUnique({
    where: { id: doctorId },
    select: {
      ...doctorProfileSelect,
      userId: true,
      user: { select: { role: true, accountStatus: true, emailVerifiedAt: true } }
    }
  });
  if (!canDoctorTakeSessions(doctor)) unavailable();
  return doctor;
}

// This deliberately exposes only information a client needs to choose a professional.
// Credentials, contact details, DOB and private upload paths remain private.
export async function getBookableDoctor(doctorId, db = prisma) {
  const doctor = await findBookableDoctor(doctorId, db);
  return {
    id: doctor.id,
    firstName: doctor.firstName,
    lastName: doctor.lastName,
    gender: doctor.gender === 'PREFER_NOT_TO_SAY' ? null : doctor.gender,
    professionalCategory: doctor.professionalCategory,
    specialization: doctor.specialization,
    qualification: doctor.qualification,
    institution: doctor.institution,
    experienceYears: doctor.experienceYears,
    preferredSessionLanguage: doctor.preferredSessionLanguage,
    languages: doctor.languages,
    bio: doctor.bio,
    timezone: doctor.timezone,
    verificationStatus: 'VERIFIED',
    hasProfileImage: Boolean(doctor.profileImageUrl),
    // A profile fee is informative only. A payment provider/order owns final pricing.
    consultationFee: doctor.consultationFee?.toString() ?? null
  };
}

export async function readBookableDoctorPhoto(doctorId, db = prisma) {
  const doctor = await findBookableDoctor(doctorId, db);
  const filename = doctor.profileImageUrl ? path.basename(doctor.profileImageUrl) : '';
  if (!/^[a-f0-9-]{36}\.jpg$/.test(filename)) {
    throw new AppError(404, 'PROFILE_PHOTO_NOT_FOUND', 'Profile photo not found.');
  }
  return path.join(uploadRoot, doctor.userId, filename);
}
