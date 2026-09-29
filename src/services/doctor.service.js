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
import { profileCompletion, canDoctorTakeSessions } from './eligibility.service.js';
import { removeStoredUpload } from './upload.service.js';

const credentialFields = new Set([
  'professionalCategory', 'professionalStatus', 'licenseNumber', 'licenseAuthority',
  'university', 'course', 'specialization', 'expectedGraduationDate', 'enrollmentNumber', 'qualification', 'institution', 'graduationYear'
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

export function changedCredentialFields(current, profileInput) {
  return Object.keys(profileInput).filter((key) => credentialFields.has(key) && String(profileInput[key]) !== String(current[key]));
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true, emailVerifiedAt: true, accountStatus: true, doctorProfile: { select: doctorProfileSelect } } });
  if (!user?.doctorProfile) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found.');
  return { ...user.doctorProfile, email: user.email, ...profileCompletion(user.doctorProfile), canTakeSessions: canDoctorTakeSessions(user.doctorProfile, user) };
}

export async function updateProfile(userId, input, context = {}) {
  const { email, currentPassword, ...profileInput } = input;
  if (profileInput.timezone) assertTimezone(profileInput.timezone);
  const current = await getProfile(userId);
  const merged = { ...current, ...profileInput };
  if (profileInput.isAcceptingBookings && !profileCompletion(merged).profileCompleted) throw new AppError(403, 'PROFILE_INCOMPLETE', 'Complete your professional profile before accepting bookings.');
  validateCredentials(merged);
  const changedCredentials = changedCredentialFields(current, profileInput);
  if (current.verificationStatus === 'VERIFIED' && changedCredentials.length) {
    throw new AppError(403, 'VERIFIED_CREDENTIALS_LOCKED', 'Verified professional credentials are locked. Contact AntarTalk support to correct them.');
  }
  // Draft and rejected profiles must be reviewed again when credentials change.
  // A verified doctor's permitted personal/practice edits do not reopen review.
  const credentialsChanged = current.verificationStatus !== 'VERIFIED' && changedCredentials.length > 0;
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
    ...(!profileCompletion(merged).profileCompleted ? { isAcceptingBookings: false } : {}),
    ...(credentialsChanged ? { verificationStatus: 'PENDING', verificationSubmittedAt: null, verificationReason: null, isAcceptingBookings: false } : {})
  };
  const updated = await serialTransaction(async (tx) => {
    const freshUser = await lockUser(tx, userId);
    if (emailChanged && freshUser.passwordHash !== verifiedPasswordHash) throw new AppError(401, 'SESSION_REVOKED', 'Credentials changed. Sign in again.');
    await lockDoctor(tx, current.id);
    const freshProfile = await tx.doctorProfile.findUnique({ where: { id: current.id } });
    if (freshProfile.updatedAt.getTime() !== current.updatedAt.getTime() || freshUser.email !== current.email) throw new AppError(409, 'PROFILE_CHANGED', 'Profile changed concurrently. Reload before retrying.');
    if (emailChanged) await tx.otpChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    const profile = await tx.doctorProfile.update({ where: { userId }, data, select: doctorProfileSelect });
    if (profileInput.timezone && profileInput.timezone !== current.timezone) {
      // Existing wall-clock hours cannot be relabelled as IST without shifting actual appointments.
      await tx.doctorWorkingHour.updateMany({ where: { doctorId: current.id }, data: { timezone: profileInput.timezone, isActive: false } });
    }
    if (emailChanged) {
      updatedUser = await tx.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: null, tokenVersion: { increment: 1 } }, select: { id: true, email: true } });
      await tx.doctorProfile.update({ where: { userId }, data: { isAcceptingBookings: false } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await recordAudit({ actorId: userId, action: credentialsChanged ? 'PROFILE_CREDENTIALS_CHANGED' : emailChanged ? 'EMAIL_CHANGE_REQUESTED' : 'PROFILE_UPDATED', entityType: 'DoctorProfile', entityId: profile.id, ipAddress: context.ip }, tx);
    return profile;
  });
  if (emailChanged) await createOtp(updatedUser, 'VERIFY_EMAIL');
  return { ...updated, ...await getProfile(userId), reVerificationRequired: credentialsChanged, emailVerificationRequired: emailChanged };
}

export async function submitVerification(userId, context = {}) {
  const current = await getProfile(userId);
  if (!current.profileCompleted) throw new AppError(422, 'PROFILE_INCOMPLETE', 'Complete every required professional profile field before submitting for review.', { missingFields: current.missingFields });
  if (current.verificationStatus === 'SUSPENDED') throw new AppError(403, 'VERIFICATION_SUSPENDED', 'This professional account cannot submit for review.');
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, current.id);
    const profile = await tx.doctorProfile.update({ where: { id: current.id }, data: { verificationStatus: 'PENDING', verificationSubmittedAt: new Date(), verificationReason: null, isAcceptingBookings: false }, select: doctorProfileSelect });
    await recordAudit({ actorId: userId, action: 'DOCTOR_VERIFICATION_SUBMITTED', entityType: 'DoctorProfile', entityId: current.id, ipAddress: context.ip }, tx);
    return { ...profile, ...profileCompletion(profile), submitted: true };
  });
}

export async function deleteAccount(userId, context = {}) {
  const now = new Date();
  const profile = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true, profileImageUrl: true, licenseDocumentUrl: true } });
  if (!profile) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found.');
  await serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, profile.id);
    const active = await tx.booking.count({ where: { doctorId: profile.id, endTime: { gt: now }, status: { in: ['PENDING', 'CONFIRMED'] } } });
    if (active) throw new AppError(409, 'ACTIVE_BOOKINGS_EXIST', 'Resolve active or future bookings before deleting the account.');
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.doctorWorkingHour.updateMany({ where: { doctorId: profile.id }, data: { isActive: false } });
    await tx.doctorPhoto.deleteMany({ where: { doctorId: profile.id } });
    await tx.doctorCredentialDocument.deleteMany({ where: { doctorId: profile.id } });
    await tx.doctorProfile.update({
      where: { id: profile.id },
      data: {
        firstName: 'Deleted', lastName: 'User', phoneNumber: crypto.randomBytes(16).toString('hex'),
        dateOfBirth: new Date('1970-01-01T00:00:00Z'), gender: null, expectedGraduationDate: null,
        licenseNumber: null, licenseAuthority: null, university: null, course: null,
        specialization: null, enrollmentNumber: null, bio: null, isAcceptingBookings: false,
        profileImageUrl: null, licenseDocumentUrl: null, qualification: null, institution: null,
        graduationYear: null, experienceYears: null, languages: [], preferredSessionLanguage: null, expertise: [], consultationFee: null,
        verificationStatus: 'SUSPENDED', availabilityPresets: []
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
  await Promise.all([profile.profileImageUrl, profile.licenseDocumentUrl].filter(Boolean).map((url) => removeStoredUpload(userId, url)));
}
