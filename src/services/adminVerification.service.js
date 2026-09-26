import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { recordAudit } from './audit.service.js';
import { lockDoctor, lockUser, serialTransaction } from './transaction.service.js';

const reviewSelect = {
  id: true, firstName: true, lastName: true, phoneNumber: true,
  professionalCategory: true, professionalStatus: true, licenseNumber: true,
  licenseAuthority: true, university: true, course: true, specialization: true,
  expectedGraduationDate: true, enrollmentNumber: true, qualification: true,
  institution: true, graduationYear: true, experienceYears: true, bio: true,
  languages: true, expertise: true, licenseDocumentUrl: true, profileImageUrl: true,
  timezone: true, verificationStatus: true, verificationSubmittedAt: true,
  verificationReason: true, isAcceptingBookings: true, updatedAt: true,
  user: { select: { email: true } }
};

function serialize(profile) {
  const { user, ...doctor } = profile;
  return { ...doctor, email: user.email, hasLicenseDocument: Boolean(doctor.licenseDocumentUrl) };
}

const submittedWhere = { verificationStatus: /** @type {const} */ ('PENDING'), verificationSubmittedAt: { not: null } };

export async function listVerificationQueue({ page, limit }) {
  const [items, total] = await Promise.all([
    prisma.doctorProfile.findMany({ where: submittedWhere, select: reviewSelect, orderBy: { verificationSubmittedAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
    prisma.doctorProfile.count({ where: submittedWhere })
  ]);
  return { items: items.map(serialize), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getVerificationReview(id) {
  const profile = await prisma.doctorProfile.findFirst({ where: { id, ...submittedWhere }, select: reviewSelect });
  if (!profile) throw new AppError(404, 'VERIFICATION_REQUEST_NOT_FOUND', 'This verification request is no longer awaiting review.');
  return serialize(profile);
}

export async function decideVerification(adminId, id, input, context = {}) {
  const updated = await serialTransaction(async (tx) => {
    const actor = await lockUser(tx, adminId);
    if (actor.role !== 'ADMIN') throw new AppError(403, 'FORBIDDEN', 'Administrator access is required.');
    await lockDoctor(tx, id);
    const profile = await tx.doctorProfile.findFirst({ where: { id, ...submittedWhere }, select: reviewSelect });
    if (!profile) throw new AppError(409, 'VERIFICATION_REQUEST_CHANGED', 'This verification request is no longer awaiting review. Reload the queue.');
    if (profile.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new AppError(409, 'VERIFICATION_REQUEST_CHANGED', 'The doctor updated this profile. Reload before deciding.');
    const decision = await tx.doctorProfile.update({
      where: { id },
      data: { verificationStatus: input.status, verificationReason: input.status === 'REJECTED' ? input.reason : null, isAcceptingBookings: false },
      select: reviewSelect
    });
    await recordAudit({ actorId: adminId, action: input.status === 'VERIFIED' ? 'DOCTOR_VERIFICATION_APPROVED' : 'DOCTOR_VERIFICATION_REJECTED', entityType: 'DoctorProfile', entityId: id, metadata: input.status === 'REJECTED' ? { reason: input.reason } : undefined, ipAddress: context.ip }, tx);
    return decision;
  });
  return serialize(updated);
}
