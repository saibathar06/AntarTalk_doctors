import argon2 from 'argon2';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { sendOtpEmail } from '../lib/mailer.js';
import { logger } from '../lib/logger.js';
import { hashOtp, randomOtp, randomToken, safeEqual, sha256 } from '../utils/crypto.js';
import { signAccessToken } from '../utils/tokens.js';
import { serializeUser, doctorProfileSelect } from '../utils/serializers.js';
import { assertTimezone } from '../utils/time.js';
import { recordAudit } from './audit.service.js';
import { lockUser } from './transaction.service.js';
import { profileData } from '../utils/profileInput.js';

const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
let dummyPasswordHash;

export async function createOtp(user, purpose) {
  const code = randomOtp();
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, user.id);
    if (fresh.email !== user.email) return { sent: false, reason: 'ACCOUNT_CHANGED', retryAfterSeconds: 0 };
    const latest = await tx.otpChallenge.findFirst({ where: { userId: user.id, purpose }, orderBy: { createdAt: 'desc' } });
    if (latest && now.getTime() - latest.lastSentAt.getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000) return { sent: false, reason: 'COOLDOWN', retryAfterSeconds: Math.ceil((env.OTP_RESEND_COOLDOWN_SECONDS * 1000 - (now.getTime() - latest.lastSentAt.getTime())) / 1000) };
    await tx.otpChallenge.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } });
    const challenge = await tx.otpChallenge.create({
    data: {
      userId: user.id,
      purpose,
      otpHash: hashOtp(user.id, purpose, code),
      expiresAt: new Date(now.getTime() + env.OTP_TTL_MINUTES * 60_000),
      lastSentAt: now
    }
  });
    return {
      sent: true,
      reason: 'SENT',
      retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
      challengeId: challenge.id,
      challengeCreatedAt: challenge.createdAt,
      expiresAt: challenge.expiresAt
    };
  });
  if (!created.sent) return created;
  logger.info({
    otpChallengeId: created.challengeId,
    purpose,
    challengeCreatedAt: created.challengeCreatedAt?.toISOString(),
    expiresAt: created.expiresAt?.toISOString()
  }, 'OTP challenge persisted');
  try {
    await sendOtpEmail({ email: user.email, code, purpose });
  } catch (error) {
    // Do not leave a cooldown-causing OTP behind when SMTP rejected the send.
    // The id is specific to this request, so a concurrent successful resend is unaffected.
    if (created.challengeId) {
      await prisma.otpChallenge.deleteMany({ where: { id: created.challengeId, userId: user.id, purpose, consumedAt: null } }).catch(() => {});
    }
    throw error;
  }
  return { sent: true, reason: 'SENT', retryAfterSeconds: created.retryAfterSeconds };
}

/** @param {string} userId
 * @param {import('@prisma/client').OtpPurpose} purpose
 * @param {string} otp
 * @param {import('@prisma/client').Prisma.TransactionClient} tx */
export async function consumeOtp(userId, purpose, otp, tx = prisma) {
  const challenge = await tx.otpChallenge.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' }
  });
  const now = new Date();
  if (!challenge) {
    logger.info({ purpose, challengeFound: false, validationBranch: 'CHALLENGE_NOT_FOUND' }, 'OTP verification evaluated');
    throw new AppError(400, 'OTP_EXPIRED', 'The verification code is invalid or expired.');
  }
  const diagnostic = {
    otpChallengeId: challenge.id,
    purpose,
    challengeFound: true,
    attempts: challenge.attempts,
    challengeCreatedAt: challenge.createdAt?.toISOString(),
    expiresAt: challenge.expiresAt.toISOString(),
    serverTime: now.toISOString()
  };
  if (challenge.expiresAt <= now) {
    logger.info({ ...diagnostic, validationBranch: 'CHALLENGE_EXPIRED' }, 'OTP verification evaluated');
    throw new AppError(400, 'OTP_EXPIRED', 'The verification code is invalid or expired.');
  }
  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    logger.info({ ...diagnostic, validationBranch: 'ATTEMPT_LIMIT' }, 'OTP verification evaluated');
    throw new AppError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many verification attempts. Request a new code.');
  }

  const expected = hashOtp(userId, purpose, otp);
  const otpComparisonMatched = safeEqual(expected, challenge.otpHash);
  logger.info({ ...diagnostic, otpComparisonMatched, validationBranch: otpComparisonMatched ? 'MATCHED' : 'MISMATCHED' }, 'OTP verification evaluated');
  if (!otpComparisonMatched) {
    await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
  }
  await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
}

export async function issueTokens(user, familyId = crypto.randomUUID()) {
  const refreshToken = randomToken();
  await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, user.id);
    if (fresh.tokenVersion !== user.tokenVersion || !fresh.emailVerifiedAt) throw new AppError(401, 'SESSION_REVOKED', 'Sign in again.');
    await tx.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)
    }
  });
  });
  return { accessToken: signAccessToken(user), refreshToken, expiresIn: env.ACCESS_TOKEN_TTL };
}

export async function registerDoctor(input, context = {}) {
  assertTimezone(input.timezone);
  const { password, ...profile } = input;
  const passwordHash = await argon2.hash(password, passwordOptions);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: profile.email, passwordHash, role: 'DOCTOR' },
      select: { id: true, email: true, role: true, accountStatus: true, emailVerifiedAt: true, tokenVersion: true }
    });
    const doctorData = profileData(profile);
    const doctorProfile = await tx.doctorProfile.create({ data: {
      ...doctorData, userId: created.id, firstName: profile.firstName, lastName: profile.lastName,
      dateOfBirth: profile.dateOfBirth, phoneNumber: profile.phoneNumber,
      professionalCategory: profile.professionalCategory, professionalStatus: profile.professionalStatus
    }, select: doctorProfileSelect });
    await recordAudit({ actorId: created.id, action: 'DOCTOR_REGISTERED', entityType: 'DoctorProfile', entityId: doctorProfile.id, ipAddress: context.ip }, tx);
    return { ...created, doctorProfile };
  });
  await createOtp(user, 'VERIFY_EMAIL');
  return serializeUser(user);
}

export async function verifyEmail({ email, otp }, context = {}) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.accountStatus !== 'ACTIVE' || user.emailVerifiedAt) throw new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, user.id);
    if (fresh.email !== email || fresh.emailVerifiedAt) throw new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
    const error = await consumeOtp(user.id, 'VERIFY_EMAIL', otp, tx);
    if (error) return error;
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await recordAudit({ actorId: user.id, action: 'EMAIL_VERIFIED', entityType: 'User', entityId: user.id, ipAddress: context.ip }, tx);
  });
  if (outcome instanceof AppError) throw outcome;
  return { verified: true };
}

export async function resendOtp({ email, purpose }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.accountStatus !== 'ACTIVE') return;
  await createOtp(user, purpose);
}

export async function login({ email, password }, context = {}) {
  const user = await prisma.user.findUnique({ where: { email }, include: { doctorProfile: { select: doctorProfileSelect } } });
  if (!dummyPasswordHash) dummyPasswordHash = argon2.hash(randomToken(), passwordOptions);
  const valid = await argon2.verify(user?.passwordHash ?? await dummyPasswordHash, password).catch(() => false);
  if (!user || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (user.accountStatus !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not active.');
  // A legacy endpoint must not bypass the doctor's password + OTP requirement.
  if (user.role === 'DOCTOR') {
    const { beginDoctorLogin } = await import('./doctorAuth.service.js');
    return beginDoctorLogin({ email, password });
  }
  if (!user.emailVerifiedAt) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in.');
  const tokens = await issueTokens(user);
  await recordAudit({ actorId: user.id, action: 'LOGIN_SUCCEEDED', entityType: 'User', entityId: user.id, ipAddress: context.ip });
  return { user: serializeUser(user), tokens };
}

export async function rotateRefreshToken(rawToken, allowedRoles = null) {
  const tokenHash = sha256(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!stored || stored.expiresAt <= new Date() || stored.user.accountStatus !== 'ACTIVE') throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired.');
  if (stored.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await lockUser(tx, stored.userId);
      await tx.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    throw new AppError(401, 'REFRESH_TOKEN_REUSE', 'Refresh token reuse was detected. Sign in again.');
  }
  const next = randomToken();
  const nextHash = sha256(next);
  const rotated = await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, stored.userId);
    if (allowedRoles && !allowedRoles.includes(fresh.role)) throw new AppError(403, 'FORBIDDEN', 'This account cannot use the Doctors app.');
    if (fresh.tokenVersion !== stored.user.tokenVersion || !fresh.emailVerifiedAt) return false;
    const result = await tx.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: new Date(), replacedByHash: nextHash } });
    if (result.count !== 1) return false;
    await tx.refreshToken.create({ data: { userId: stored.userId, familyId: stored.familyId, tokenHash: nextHash, expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000) } });
    return true;
  });
  if (!rotated) {
    await prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new AppError(401, 'REFRESH_TOKEN_REUSE', 'Refresh token reuse was detected. Sign in again.');
  }
  return { accessToken: signAccessToken(stored.user), refreshToken: next, expiresIn: env.ACCESS_TOKEN_TTL };
}

export async function logout(userId, { refreshToken, allDevices }, context = {}) {
  if (!allDevices && !refreshToken) throw new AppError(422, 'VALIDATION_ERROR', 'Supply refreshToken or allDevices: true.');
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    if (allDevices) {
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    } else if (refreshToken) {
      await tx.refreshToken.updateMany({ where: { userId, tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await recordAudit({ actorId: userId, action: allDevices ? 'LOGOUT_ALL' : 'LOGOUT', entityType: 'User', entityId: userId, ipAddress: context.ip }, tx);
  });
}

export async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.accountStatus === 'ACTIVE') {
    await createOtp(user, 'RESET_PASSWORD');
  }
}

export async function resetPassword({ email, otp, newPassword }, context = {}) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.accountStatus !== 'ACTIVE') throw new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
  const passwordHash = await argon2.hash(newPassword, passwordOptions);
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, user.id);
    if (fresh.email !== email) throw new AppError(400, 'INVALID_OTP', 'The verification code is invalid or expired.');
    const error = await consumeOtp(user.id, 'RESET_PASSWORD', otp, tx);
    if (error) return error;
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ actorId: user.id, action: 'PASSWORD_RESET', entityType: 'User', entityId: user.id, ipAddress: context.ip }, tx);
  });
  if (outcome instanceof AppError) throw outcome;
}
