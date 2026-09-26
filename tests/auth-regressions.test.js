import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/lib/mailer.js', () => ({ sendOtpEmail: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { hashOtp } from '../src/utils/crypto.js';
import { registerDoctor, verifyEmail, resetPassword, resendOtp, logout, rotateRefreshToken, login } from '../src/services/auth.service.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { sendOtpEmail } from '../src/lib/mailer.js';
import argon2 from 'argon2';
import { beginDoctorLogin, sendDoctorOtp, verifyDoctorOtp } from '../src/services/doctorAuth.service.js';

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
  it('website login requires a password and reports email delivery', async () => {
    user.role = 'DOCTOR'; user.passwordHash = 'hash';
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    user.emailVerifiedAt = new Date();
    prisma.user.findFirst = vi.fn(async () => user);
    challenge.lastSentAt = new Date(0);
    const result = await beginDoctorLogin({ email: user.email, password: 'Password123' });
    expect(result.status).toBe('OTP_SENT');
    expect(result.challengeToken).toBeTruthy();
    expect(() => verifyAccessToken(result.challengeToken)).toThrow();
    expect(result.accessToken).toBeUndefined();
    expect(sendOtpEmail).toHaveBeenCalledWith(expect.objectContaining({ email: user.email, purpose: 'DOCTOR_LOGIN' }));
  });
  it('website login preserves failed-attempt limits and consumes the code once', async () => {
    user.emailVerifiedAt = new Date(); user.role = 'DOCTOR';
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    const { challengeToken } = await beginDoctorLogin({ email: user.email, password: 'Password123' });
    prisma.user.findFirst = vi.fn(async () => user);
    challenge.otpHash = hashOtp(user.id, 'DOCTOR_LOGIN', '123456');
    await expect(verifyDoctorOtp({ challengeToken, otp: '000000' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    expect(challenge.attempts).toBe(1);
    const tokens = await verifyDoctorOtp({ challengeToken, otp: '123456' });
    expect(tokens.accessToken).toBeTruthy();
    await expect(verifyDoctorOtp({ challengeToken, otp: '123456' })).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });
  it('website verification marks email verified without granting professional privileges', async () => {
    user.role = 'DOCTOR'; prisma.user.findFirst = vi.fn(async () => user);
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    const { challengeToken } = await beginDoctorLogin({ email: user.email, password: 'Password123' });
    await verifyDoctorOtp({ challengeToken, otp: '123456' });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { emailVerifiedAt: expect.any(Date) } });
  });
  it('rejects passwordless OTP verification and resend', async () => {
    await expect(verifyDoctorOtp({ otp: '123456' })).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_EXPIRED' });
    await expect(sendDoctorOtp({})).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_EXPIRED' });
  });
  it('reports cooldown honestly and invalidates proof after password reset', async () => {
    user.role = 'DOCTOR';
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    const result = await beginDoctorLogin({ email: user.email, password: 'Password123' });
    expect(result.status).toBe('OTP_COOLDOWN');
    expect((await sendDoctorOtp(result)).status).toBe('OTP_COOLDOWN');
    expect(sendOtpEmail).not.toHaveBeenCalled();
    user.tokenVersion++;
    await expect(verifyDoctorOtp({ ...result, otp: '123456' })).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_EXPIRED' });
  });
  it('does not send email for an incorrect password', async () => {
    vi.spyOn(argon2, 'verify').mockResolvedValue(false);
    await expect(beginDoctorLogin({ email: user.email, password: 'wrong' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });
  it('allows administrators but rejects clients from the Doctors app login', async () => {
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    user.role = 'CLIENT';
    await expect(beginDoctorLogin({ email: user.email, password: 'Password123' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    user.role = 'ADMIN';
    user.emailVerifiedAt = new Date();
    const result = await beginDoctorLogin({ email: user.email, password: 'Password123' });
    expect(result.challengeToken).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
  });
  it('propagates email failures instead of claiming a code was sent', async () => {
    user.role = 'DOCTOR';
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    challenge.lastSentAt = new Date(0);
    sendOtpEmail.mockRejectedValueOnce(new Error('Delivery failed'));
    await expect(beginDoctorLogin({ email: user.email, password: 'Password123' })).rejects.toThrow('Delivery failed');
  });
  it('stores a real Argon2id hash instead of the registration password', async () => {
    prisma.user.create = vi.fn(async () => user);
    prisma.doctorProfile = { create: vi.fn(async () => ({ id: 'profile' })) };
    const password = 'RegistrationPassword123!';
    const result = await registerDoctor({ email: user.email, password, timezone: 'UTC', professionalStatus: 'LICENSED_PROFESSIONAL' });
    const stored = prisma.user.create.mock.calls[0][0].data;
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(stored.passwordHash, password)).toBe(true);
    expect(stored.password).toBeUndefined();
    expect(result.passwordHash).toBeUndefined();
  });
  it('shared doctor login cannot bypass OTP', async () => {
    user.role = 'DOCTOR'; user.emailVerifiedAt = new Date();
    vi.spyOn(argon2, 'verify').mockResolvedValue(true);
    const result = await login({ email: user.email, password: 'Password123' });
    expect(result.challengeToken).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
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
