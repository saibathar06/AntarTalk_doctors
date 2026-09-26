import { Router } from 'express';
import { parseCookie } from 'cookie';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { authenticateUser, requireDoctor } from '../middleware/auth.js';
import { authLimiter, otpLimiter, accountAuthLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import { logout, rotateRefreshToken } from '../services/auth.service.js';
import { registerWebsiteDoctor, sendDoctorOtp, verifyDoctorOtp } from '../services/doctorAuth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { dateOfBirth, email, phone } from '../validation/common.js';

export const doctorAuthRouter = Router();
const cookieName = 'antartalk_doctor_refresh';
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: /** @type {const} */ ('strict'), path: '/api/doctor/auth' };
const identifier = z.union([email, phone]);
const challenge = z.object({ identifier, purpose: z.enum(['VERIFY_EMAIL', 'DOCTOR_LOGIN']) }).strict();
const readCookie = (req) => parseCookie(req.headers.cookie ?? '')[cookieName];
function sendTokens(res, tokens) {
  res.cookie(cookieName, tokens.refreshToken, { ...cookieOptions, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400000 });
  res.json({ success: true, data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn } });
}
doctorAuthRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!env.CORS_ORIGINS.includes(req.get('origin'))) return next(new AppError(403, 'ORIGIN_REQUIRED', 'Use the configured doctor website origin.'));
  next();
}, authLimiter, accountAuthLimiter);
doctorAuthRouter.post('/register', otpLimiter, validate(z.object({ body: z.object({
  email, phoneNumber: phone, dateOfBirth, licenseNumber: z.string().trim().min(2).max(100),
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']),
  timezone: z.string().min(1).max(64).default('UTC')
}).strict() })), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await registerWebsiteDoctor(req.body, { ip: req.ip }) })));
doctorAuthRouter.post('/send-otp', otpLimiter, validate(z.object({ body: challenge })), asyncHandler(async (req, res) => res.json({ success: true, data: await sendDoctorOtp(req.body) })));
doctorAuthRouter.post('/verify-otp', validate(z.object({ body: challenge.extend({ otp: z.string().regex(/^\d{6}$/) }) })), asyncHandler(async (req, res) => sendTokens(res, await verifyDoctorOtp(req.body, { ip: req.ip }))));
doctorAuthRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = readCookie(req);
  if (!token) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Sign in to continue.');
  sendTokens(res, await rotateRefreshToken(token));
}));
doctorAuthRouter.post('/logout', authenticateUser, requireDoctor, asyncHandler(async (req, res) => {
  await logout(req.user.id, { refreshToken: readCookie(req), allDevices: req.body?.allDevices === true }, { ip: req.ip });
  res.clearCookie(cookieName, cookieOptions);
  res.json({ success: true, data: { loggedOut: true } });
}));
