import argon2 from 'argon2';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../errors/AppError.js';
import { consumeOtp, createOtp, issueTokens, registerDoctor, forgotPassword, resetPassword } from './auth.service.js';
import { lockUser } from './transaction.service.js';
import { recordAudit } from './audit.service.js';

const audience = 'antartalk-doctor-password-step';
const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
let dummyHash;

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '[invalid-recipient]';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, local.length - 2)))}@${domain}`;
}

function deliveryStatus(result) {
  if (result.reason === 'ACCOUNT_CHANGED') throw new AppError(401, 'AUTH_CHALLENGE_EXPIRED', 'Your account changed. Sign in again.');
  return {
    status: result.sent ? 'OTP_SENT' : 'OTP_COOLDOWN',
    message: result.sent
      ? `Your verification email was sent. Check your inbox and spam folder. The code expires in ${env.OTP_TTL_MINUTES} minutes.`
      : `A code was requested recently. Wait ${result.retryAfterSeconds} seconds before requesting another. If the last email failed, resend after this countdown.`,
    retryAfterSeconds: result.retryAfterSeconds,
    otpExpiresInSeconds: result.sent ? env.OTP_TTL_MINUTES * 60 : null
  };
}

async function passwordStep({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!dummyHash) dummyHash = argon2.hash(crypto.randomBytes(32).toString('hex'), passwordOptions);
  const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, password).catch(() => false);
  if (!user || !valid || !['DOCTOR', 'ADMIN'].includes(user.role) || user.accountStatus !== 'ACTIVE') throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect, or this account cannot use the Doctors app.');
  return user;
}

function challengeFor(user, purpose) {
  return jwt.sign({ email: user.email, role: user.role, purpose, tokenVersion: user.tokenVersion }, env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', issuer: 'antartalk-api', audience, subject: user.id, expiresIn: '15m', jwtid: crypto.randomUUID() });
}

function readChallenge(token) {
  try {
    const value = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'antartalk-api', audience });
    if (typeof value === 'string' || !value.sub || !value.email || !['DOCTOR', 'ADMIN'].includes(value.role) || !['VERIFY_EMAIL', 'DOCTOR_LOGIN'].includes(value.purpose) || !Number.isInteger(value.tokenVersion)) throw new Error('Invalid challenge');
    return value;
  } catch { throw new AppError(401, 'AUTH_CHALLENGE_EXPIRED', 'Your sign-in step expired. Enter your email and password again.'); }
}

function assertChallengeUser(user, challenge) {
  if (!user || user.accountStatus !== 'ACTIVE' || !['DOCTOR', 'ADMIN'].includes(user.role) || user.role !== challenge.role || user.email !== challenge.email || user.tokenVersion !== challenge.tokenVersion ||
      (challenge.purpose === 'VERIFY_EMAIL' ? Boolean(user.emailVerifiedAt) : !user.emailVerifiedAt)) {
    throw new AppError(401, 'AUTH_CHALLENGE_EXPIRED', 'Your account or sign-in step changed. Enter your email and password again.');
  }
}

export async function registerWebsiteDoctor(input, context) {
  try {
    // Shared registration hashes the supplied password with Argon2id before persistence.
    await registerDoctor({ ...input, professionalStatus: 'LICENSED_PROFESSIONAL' }, context);
  } catch (error) {
    if (error.code === 'P2002') throw new AppError(409, 'REGISTRATION_CONFLICT', 'An account already uses this email, phone number, or license. Sign in instead.');
    throw error;
  }
  const user = await passwordStep(input);
  return { ...deliveryStatus({ sent: true, retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS }), email: user.email,
    purpose: 'VERIFY_EMAIL', challengeToken: challengeFor(user, 'VERIFY_EMAIL') };
}

export async function beginDoctorLogin(input) {
  const user = await passwordStep(input);
  const purpose = user.emailVerifiedAt ? 'DOCTOR_LOGIN' : 'VERIFY_EMAIL';
  const delivery = await createOtp(user, purpose);
  return { ...deliveryStatus(delivery), email: user.email, purpose, challengeToken: challengeFor(user, purpose) };
}

export async function sendDoctorOtp({ challengeToken }) {
  const challenge = readChallenge(challengeToken);
  const user = await prisma.user.findUnique({ where: { id: challenge.sub } });
  assertChallengeUser(user, challenge);
  return deliveryStatus(await createOtp(user, challenge.purpose));
}

export async function verifyDoctorOtp({ challengeToken, otp }, context = {}) {
  const challenge = readChallenge(challengeToken);
  logger.info({ challengeJti: challenge.jti, recipient: maskEmail(challenge.email), purpose: challenge.purpose }, 'Doctor OTP verification requested');
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await lockUser(tx, challenge.sub);
    assertChallengeUser(fresh, challenge);
    const error = await consumeOtp(fresh.id, challenge.purpose, otp, tx);
    if (error) return error; // Commit failed attempts instead of rolling them back.
    const verified = challenge.purpose === 'VERIFY_EMAIL'
      ? await tx.user.update({ where: { id: fresh.id }, data: { emailVerifiedAt: new Date() } }) : fresh;
    await recordAudit({ actorId: fresh.id, action: 'DOCTOR_PASSWORD_OTP_LOGIN', entityType: 'User', entityId: fresh.id, ipAddress: context.ip }, tx);
    return verified;
  });
  if (outcome instanceof AppError) throw outcome;
  return issueTokens(outcome);
}

// Generic responses prevent password-reset email enumeration. The existing
// RESET_PASSWORD OTP purpose supplies hashing, expiry, cooldown and replay protection.
export async function requestDoctorPasswordReset({ email }) {
  await forgotPassword({ email }, ['DOCTOR', 'ADMIN']);
  return { sent: true, message: 'If an eligible account exists for that email, a password-reset code has been sent.' };
}

export async function resetDoctorPassword({ email, otp, newPassword }, context = {}) {
  await resetPassword({ email, otp, newPassword }, context, ['DOCTOR', 'ADMIN']);
  return { reset: true, message: 'Password changed successfully. Sign in with your new password.' };
}
