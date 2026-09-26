import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { consumeOtp, createOtp, issueTokens, registerDoctor } from './auth.service.js';
import { lockUser } from './transaction.service.js';
import { recordAudit } from './audit.service.js';

export async function registerWebsiteDoctor(input, context) {
  // A random, unknowable password preserves the shared schema/password API.
  await registerDoctor({ ...input, firstName: '', lastName: '', professionalStatus: 'LICENSED_PROFESSIONAL', password: crypto.randomBytes(48).toString('base64url') }, context);
  return { message: 'Check your registered email for a verification code.' };
}

async function findDoctor(identifier) {
  return prisma.user.findFirst({ where: {
    role: 'DOCTOR', accountStatus: 'ACTIVE',
    ...(identifier.startsWith('+') ? { doctorProfile: { phoneNumber: identifier } } : { email: identifier.toLowerCase() })
  } });
}

export async function sendDoctorOtp({ identifier, purpose }) {
  const user = await findDoctor(identifier);
  if (user && (purpose === 'VERIFY_EMAIL' ? !user.emailVerifiedAt : Boolean(user.emailVerifiedAt))) await createOtp(user, purpose);
  // Phone is an account lookup, not proof of phone ownership. Delivery is email only.
  return { message: 'If this account is eligible, a code has been sent to its registered email.' };
}

export async function verifyDoctorOtp({ identifier, purpose, otp }, context = {}) {
  const user = await findDoctor(identifier);
  if (!user) throw new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, user.id);
    if (fresh.role !== 'DOCTOR') throw new AppError(403, 'FORBIDDEN', 'A professional account is required.');
    if (fresh.email !== user.email || (purpose === 'VERIFY_EMAIL' ? Boolean(fresh.emailVerifiedAt) : !fresh.emailVerifiedAt)) throw new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
    const error = await consumeOtp(user.id, purpose, otp, tx);
    if (error) return error; // Commit failed attempts rather than rolling them back.
    const verified = purpose === 'VERIFY_EMAIL'
      ? await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }) : fresh;
    await recordAudit({ actorId: user.id, action: 'DOCTOR_OTP_LOGIN', entityType: 'User', entityId: user.id, ipAddress: context.ip }, tx);
    return verified;
  });
  if (outcome instanceof AppError) throw outcome;
  return issueTokens(outcome);
}
