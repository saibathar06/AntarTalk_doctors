import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/lib/mailer.js', () => ({ sendOtpEmail: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { hashOtp } from '../src/utils/crypto.js';
import { verifyEmail, resetPassword, resendOtp, logout, rotateRefreshToken, login } from '../src/services/auth.service.js';
import { sendOtpEmail } from '../src/lib/mailer.js';
import argon2 from 'argon2';
import { sendDoctorOtp, verifyDoctorOtp } from '../src/services/doctorAuth.service.js';

let user;
let challenge;
beforeEach(() => {
  vi.restoreAllMocks();
  user = { id: 'user', email: 'test@example.com', accountStatus: 'ACTIVE', emailVerifiedAt: null, tokenVersion: 0 };
  challenge = { id: 'otp', otpHash: hashOtp('user', 'VERIFY_EMAIL', '123456'), attempts: 0, expiresAt: new Date(Date.now() + 60000), consumedAt: null, lastSentAt: new Date() };
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(async () => user), update: vi.fn(async ({ data }) => Object.assign(user, data)) },
    otpChallenge: {
      findFirst: vi.fn(async ({ where }) => where.consumedAt === null && challenge.consumedAt ? null : challenge),
      update: vi.fn(async ({ data }) => { if (data.attempts) challenge.attempts += 1; if (data.consumedAt) challenge.consumedAt = data.consumedAt; }),
      updateMany: vi.fn(),
      create: vi.fn()
    },
    refreshToken: { updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() }
  });
  // Model rollback to catch the original failed-attempt transaction bug.
  prisma.$transaction = vi.fn(async (work) => {
    const before = { ...challenge };
    try { return await work(prisma); } catch (error) { challenge = before; throw error; }
  });
  sendOtpEmail.mockClear();
});
describe('OTP and session regressions', () => {
  it('website login uses doctor-scoped phone lookup and email delivery', async () => {
    user.emailVerifiedAt = new Date();
    prisma.user.findFirst = vi.fn(async () => user);
    challenge.lastSentAt = new Date(0);
    await sendDoctorOtp({ identifier: '+919876543210', purpose: 'DOCTOR_LOGIN' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { role: 'DOCTOR', accountStatus: 'ACTIVE', doctorProfile: { phoneNumber: '+919876543210' } } });
    expect(sendOtpEmail).toHaveBeenCalledWith(expect.objectContaining({ email: user.email, purpose: 'DOCTOR_LOGIN' }));
  });
  it('website login preserves failed-attempt limits and consumes the code once', async () => {
    user.emailVerifiedAt = new Date(); user.role = 'DOCTOR';
    prisma.user.findFirst = vi.fn(async () => user);
    challenge.otpHash = hashOtp(user.id, 'DOCTOR_LOGIN', '123456');
    await expect(verifyDoctorOtp({ identifier: user.email, purpose: 'DOCTOR_LOGIN', otp: '000000' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    expect(challenge.attempts).toBe(1);
    const tokens = await verifyDoctorOtp({ identifier: user.email, purpose: 'DOCTOR_LOGIN', otp: '123456' });
    expect(tokens.accessToken).toBeTruthy();
    await expect(verifyDoctorOtp({ identifier: user.email, purpose: 'DOCTOR_LOGIN', otp: '123456' })).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });
  it('website verification marks email verified without granting professional privileges', async () => {
    user.role = 'DOCTOR'; prisma.user.findFirst = vi.fn(async () => user);
    await verifyDoctorOtp({ identifier: user.email, purpose: 'VERIFY_EMAIL', otp: '123456' });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { emailVerifiedAt: expect.any(Date) } });
  });
  it('commits failed attempts and rejects the sixth verification', async () => {
    for (let i = 0; i < 5; i++) await expect(verifyEmail({ email: user.email, otp: '000000' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    expect(challenge.attempts).toBe(5);
    await expect(verifyEmail({ email: user.email, otp: '123456' })).rejects.toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED' });
  });
  it('rejects expired OTP', async () => {
    challenge.expiresAt = new Date(0);
    await expect(verifyEmail({ email: user.email, otp: '123456' })).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });
  it('consumes OTP and rejects reuse', async () => {
    await verifyEmail({ email: user.email, otp: '123456' });
    expect(challenge.consumedAt).toBeInstanceOf(Date);
    await expect(verifyEmail({ email: user.email, otp: '123456' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });
  it('applies resend cooldown inside the account transaction', async () => {
    await resendOtp({ email: user.email, purpose: 'VERIFY_EMAIL' });
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
  });
  it.each(['LOCKED', 'DELETED'])('rejects OTP and refresh on %s account', async (status) => {
    user.accountStatus = status;
    await expect(verifyEmail({ email: user.email, otp: '123456' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    prisma.refreshToken.findUnique.mockResolvedValue({ user, expiresAt: new Date(Date.now() + 60000) });
    await expect(rotateRefreshToken('token')).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });
  it('revokes reused refresh family', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({ user, familyId: 'family', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
    await expect(rotateRefreshToken('token')).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSE' });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: 'family', revokedAt: null } }));
  });
  it('rotates a refresh token atomically', async () => {
    user.emailVerifiedAt = new Date();
    prisma.refreshToken.findUnique.mockResolvedValue({ id: 'refresh', userId: user.id, user, familyId: 'family', revokedAt: null, expiresAt: new Date(Date.now() + 60000) });
    const tokens = await rotateRefreshToken('token');
    expect(tokens.refreshToken).not.toBe('token');
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });
  it('logout all invalidates access and refresh tokens', async () => {
    await logout(user.id, { allDevices: true });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });
  it('reset password revokes sessions', async () => {
    challenge.otpHash = hashOtp(user.id, 'RESET_PASSWORD', '123456');
    vi.spyOn(argon2, 'hash').mockResolvedValue('hash');
    await resetPassword({ email: user.email, otp: '123456', newPassword: 'NewPassword123' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { passwordHash: 'hash', tokenVersion: { increment: 1 } } }));
  });
  it('rejects incorrect password', async () => {
    vi.spyOn(argon2, 'verify').mockResolvedValue(false);
    await expect(login({ email: user.email, password: 'bad' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('rejects login before email verification', async () => {
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    await expect(login({ email: user.email, password: 'valid' })).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });
});
