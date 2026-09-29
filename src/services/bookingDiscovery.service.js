import path from 'node:path';
import { DateTime } from 'luxon';
import { AppError } from '../errors/AppError.js';
import { scheduling } from '../config/constants.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { doctorProfileSelect } from '../utils/serializers.js';
import { canDoctorTakeSessions } from './eligibility.service.js';
import { uploadRoot } from './upload.service.js';
import { bookingWindow } from '../utils/bookingWindow.js';
import { effectiveWorkingHours } from '../utils/defaultTiming.js';
import { generateCandidateWindows, reservationKey } from './slot.service.js';

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
export function publicDoctor(doctor) {
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

export async function getBookableDoctor(doctorId, db = prisma) {
  return publicDoctor(await findBookableDoctor(doctorId, db));
}

export async function searchBookableDoctors(input, db = prisma, cache = redis, now = new Date()) {
  const start = DateTime.fromISO(`${input.date}T${input.startTime}`, { zone: 'Asia/Kolkata' });
  if (!start.isValid || start.toFormat("yyyy-MM-dd'T'HH:mm") !== `${input.date}T${input.startTime}`) {
    throw new AppError(422, 'INVALID_SLOT_TIME', 'Choose a valid date and time in India Standard Time.');
  }
  const slotStart = start.toUTC().toJSDate();
  const slotEnd = start.plus({ minutes: scheduling.slotIntervalMinutes }).toUTC().toJSDate();
  const { today, end: horizon } = bookingWindow(now);
  if (start < today || slotStart <= now || slotEnd > horizon) {
    throw new AppError(422, 'OUTSIDE_BOOKING_WINDOW', 'Choose a future time within today and the next six days.');
  }
  const fee = {
    ...(input.minimumFee !== undefined ? { gte: input.minimumFee } : {}),
    ...(input.maximumFee !== undefined ? { lte: input.maximumFee } : {})
  };
  const profiles = await db.doctorProfile.findMany({
    where: {
      verificationStatus: 'VERIFIED', isAcceptingBookings: true,
      user: { role: 'DOCTOR', accountStatus: 'ACTIVE', emailVerifiedAt: { not: null } },
      ...(input.professionalCategory ? { professionalCategory: input.professionalCategory } : {}),
      ...(input.gender ? { gender: input.gender } : {}),
      ...(input.language ? { OR: [{ preferredSessionLanguage: { equals: input.language, mode: 'insensitive' } }, { languages: { has: input.language } }] } : {}),
      ...(Object.keys(fee).length ? { consultationFee: fee } : {})
    },
    select: {
      ...doctorProfileSelect, availabilityPresets: true,
      user: { select: { role: true, accountStatus: true, emailVerifiedAt: true } },
      workingHours: true
    },
    orderBy: [{ consultationFee: 'asc' }, { id: 'asc' }]
  });
  const candidates = profiles.filter((profile) => {
    if (!canDoctorTakeSessions(profile)) return false;
    profile.workingHours = effectiveWorkingHours(profile.workingHours, profile.availabilityPresets).filter((row) => row.isActive !== false);
    return generateCandidateWindows(profile, slotStart, slotEnd).some((slot) => slot.startTime.getTime() === slotStart.getTime());
  });
  if (!candidates.length) return { items: [], pagination: { page: input.page, limit: input.limit, total: 0, pages: 0 }, timezone: 'Asia/Kolkata' };
  const doctorIds = candidates.map((profile) => profile.id);
  const [blocked, booked, held] = await Promise.all([
    db.doctorBlockedSlot.findMany({ where: { doctorId: { in: doctorIds }, startTime: { lt: slotEnd }, endTime: { gt: slotStart } }, select: { doctorId: true } }),
    db.booking.findMany({ where: { doctorId: { in: doctorIds }, status: { in: ['PENDING', 'CONFIRMED'] }, startTime: { lt: slotEnd }, endTime: { gt: slotStart } }, select: { doctorId: true } }),
    cache.mget(doctorIds.map((doctorId) => reservationKey(doctorId, slotStart)))
  ]);
  const unavailable = new Set([...blocked, ...booked].map((row) => row.doctorId));
  const available = candidates.filter((profile, index) => !unavailable.has(profile.id) && held[index] === null);
  const total = available.length;
  const items = available.slice((input.page - 1) * input.limit, input.page * input.limit).map((doctor) => ({
    doctor: publicDoctor(doctor),
    slot: { doctorId: doctor.id, startTime: slotStart, endTime: slotEnd, sessionDurationMinutes: scheduling.sessionDurationMinutes }
  }));
  return { items, pagination: { page: input.page, limit: input.limit, total, pages: Math.ceil(total / input.limit) }, timezone: 'Asia/Kolkata' };
}

export async function readBookableDoctorPhoto(doctorId, db = prisma) {
  const doctor = await findBookableDoctor(doctorId, db);
  const photo = await db.doctorPhoto.findUnique({ where: { doctorId } });
  if (photo) return Buffer.from(photo.data);
  const filename = doctor.profileImageUrl ? path.basename(doctor.profileImageUrl) : '';
  if (!/^[a-f0-9-]{36}\.jpg$/.test(filename)) {
    throw new AppError(404, 'PROFILE_PHOTO_NOT_FOUND', 'Profile photo not found.');
  }
  return path.join(uploadRoot, doctor.userId, filename);
}
