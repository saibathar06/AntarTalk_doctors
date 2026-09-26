import crypto from 'node:crypto';
import argon2 from 'argon2';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { doctorProfileSelect } from '../utils/serializers.js';
import { assertTimezone } from '../utils/time.js';
import { recordAudit } from './audit.service.js';
import { createOtp } from './auth.service.js';
import { lockUser, lockDoctor, serialTransaction } from './transaction.service.js';
import { profileData } from '../utils/profileInput.js';

const credentialFields = new Set([
  'professionalCategory', 'professionalStatus', 'licenseNumber', 'licenseAuthority',
  'university', 'course', 'specialization', 'expectedGraduationDate', 'enrollmentNumber'
]);

function validateCredentials(profile) {
  if (profile.professionalStatus === 'LICENSED_PROFESSIONAL' && !profile.licenseNumber) {
    throw new AppError(422, 'LICENSE_REQUIRED', 'License number is required for licensed professionals.');
  }
  if (profile.professionalStatus === 'FINAL_YEAR_STUDENT') {
    if (!profile.university || !profile.course || !profile.expectedGraduationDate || !profile.enrollmentNumber) {
      throw new AppError(422, 'STUDENT_DETAILS_REQUIRED', 'University, course, graduation date, and enrollment number are required for students.');
    }
    if (profile.licenseNumber) throw new AppError(422, 'STUDENT_LICENSE_CONFLICT', 'Final-year students cannot be represented as licensed professionals.');
  }
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, doctorProfile: { select: doctorProfileSelect } } });
  if (!user?.doctorProfile) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found.');
  return { ...user.doctorProfile, email: user.email };
}

export async function updateProfile(userId, input, context = {}) {
  const { email, currentPassword, ...profileInput } = input;
  if (profileInput.timezone) assertTimezone(profileInput.timezone);
  const current = await getProfile(userId);
  const merged = { ...current, ...profileInput };
  validateCredentials(merged);
  const credentialsChanged = Object.keys(profileInput).some((key) => credentialFields.has(key) && String(profileInput[key]) !== String(current[key]));
  if (profileInput.isAcceptingBookings && (credentialsChanged || current.verificationStatus !== 'VERIFIED')) {
    throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'Only verified professionals may accept bookings.');
  }
  const emailChanged = Boolean(email && email !== current.email);
  let updatedUser;
  let verifiedPasswordHash;
  if (emailChanged) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !await argon2.verify(user.passwordHash, currentPassword).catch(() => false)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    verifiedPasswordHash = user.passwordHash;
  }
  const data = {
    ...profileData(profileInput),
    ...(typeof profileInput.isAcceptingBookings === 'boolean' ? { isAcceptingBookings: profileInput.isAcceptingBookings } : {}),
    ...(credentialsChanged ? { verificationStatus: 'PENDING', isAcceptingBookings: false } : {})
  };
  const updated = await serialTransaction(async (tx) => {
    const freshUser = await lockUser(tx, userId);
    if (emailChanged && freshUser.passwordHash !== verifiedPasswordHash) throw new AppError(401, 'SESSION_REVOKED', 'Credentials changed. Sign in again.');
    await lockDoctor(tx, current.id);
    const freshProfile = await tx.doctorProfile.findUnique({ where: { id: current.id } });
    if (freshProfile.updatedAt.getTime() !== current.updatedAt.getTime() || freshUser.email !== current.email) throw new AppError(409, 'PROFILE_CHANGED', 'Profile changed concurrently. Reload before retrying.');
    if (emailChanged) await tx.otpChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    const profile = await tx.doctorProfile.update({ where: { userId }, data, select: doctorProfileSelect });
    if (profileInput.timezone) await tx.doctorWorkingHour.updateMany({ where: { doctorId: current.id }, data: { timezone: profileInput.timezone } });
    if (emailChanged) {
      updatedUser = await tx.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: null, tokenVersion: { increment: 1 } }, select: { id: true, email: true } });
      await tx.doctorProfile.update({ where: { userId }, data: { isAcceptingBookings: false } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await recordAudit({ actorId: userId, action: credentialsChanged ? 'PROFILE_CREDENTIALS_CHANGED' : emailChanged ? 'EMAIL_CHANGE_REQUESTED' : 'PROFILE_UPDATED', entityType: 'DoctorProfile', entityId: profile.id, ipAddress: context.ip }, tx);
    return profile;
  });
  if (emailChanged) await createOtp(updatedUser, 'VERIFY_EMAIL');
  return { ...updated, ...(emailChanged ? { isAcceptingBookings: false } : {}), email: emailChanged ? email : current.email, reVerificationRequired: credentialsChanged, emailVerificationRequired: emailChanged };
}

export async function deleteAccount(userId, context = {}) {
  const now = new Date();
  const profile = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found.');
  await serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, profile.id);
    const active = await tx.booking.count({ where: { doctorId: profile.id, endTime: { gt: now }, status: { in: ['PENDING', 'CONFIRMED'] } } });
    if (active) throw new AppError(409, 'ACTIVE_BOOKINGS_EXIST', 'Resolve active or future bookings before deleting the account.');
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.doctorWorkingHour.updateMany({ where: { doctorId: profile.id }, data: { isActive: false } });
    await tx.doctorProfile.update({
      where: { id: profile.id },
      data: {
        firstName: 'Deleted', lastName: 'User', phoneNumber: crypto.randomBytes(16).toString('hex'),
        dateOfBirth: new Date('1970-01-01T00:00:00Z'), expectedGraduationDate: null,
        licenseNumber: null, licenseAuthority: null, university: null, course: null,
        specialization: null, enrollmentNumber: null, bio: null, isAcceptingBookings: false,
        verificationStatus: 'SUSPENDED'
      }
    });
    await tx.user.update({
      where: { id: userId },
      data: { email: `deleted-${userId}@deleted.invalid`, passwordHash: crypto.randomBytes(48).toString('hex'), accountStatus: 'DELETED', deletedAt: now, tokenVersion: { increment: 1 } }
    });
    await tx.otpChallenge.deleteMany({ where: { userId } });
    await tx.doctorBlockedSlot.updateMany({ where: { doctorId: profile.id }, data: { reason: null } });
    await recordAudit({ actorId: userId, action: 'ACCOUNT_ANONYMIZED', entityType: 'User', entityId: userId, ipAddress: context.ip }, tx);
  });
}
