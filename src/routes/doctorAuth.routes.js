import { Router } from 'express';
import { parseCookie } from 'cookie';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { authenticateUser, requireWebsiteUser } from '../middleware/auth.js';
import { authLimiter, otpLimiter, accountAuthLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import { logout, rotateRefreshToken } from '../services/auth.service.js';
import { beginDoctorLogin, registerWebsiteDoctor, requestDoctorPasswordReset, resetDoctorPassword, sendDoctorOtp, verifyDoctorOtp } from '../services/doctorAuth.service.js';
import { recaptchaConfiguration, verifyRecaptcha } from '../services/recaptcha.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { websiteForgotPasswordSchema, websiteLoginWithRecaptchaSchema, websiteRegisterWithRecaptchaSchema, websiteResendSchema, websiteResetPasswordSchema, websiteVerifySchema } from '../validation/doctorAuth.schemas.js';

export const doctorAuthRouter = Router();
const cookieName = 'antartalk_doctor_refresh';
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: /** @type {const} */ ('strict'), path: '/api/doctor/auth' };
const readCookie = (req) => parseCookie(req.headers.cookie ?? '')[cookieName];
function sendTokens(res, tokens) {
  res.cookie(cookieName, tokens.refreshToken, { ...cookieOptions, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400000 });
  res.json({ success: true, data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn } });
}
doctorAuthRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // The global CORS middleware already rejects a supplied, disallowed browser
  // origin. Some same-origin development proxies omit Origin altogether; do not
  // reject those requests solely for its absence.
  const origin = req.get('origin');
  if (origin && !env.CORS_ORIGINS.includes(origin)) return next(new AppError(403, 'ORIGIN_REQUIRED', 'Use the configured doctor website origin.'));
  next();
}, authLimiter, accountAuthLimiter);
doctorAuthRouter.get('/recaptcha-config', (_req, res) => res.json({ success: true, data: recaptchaConfiguration() }));
doctorAuthRouter.post('/register', otpLimiter, validate(websiteRegisterWithRecaptchaSchema), asyncHandler(async (req, res) => {
  await verifyRecaptcha(req.body.recaptchaToken, 'doctor_register');
  res.status(201).json({ success: true, data: await registerWebsiteDoctor(req.body, { ip: req.ip }) });
}));

doctorAuthRouter.get('/me', authenticateUser, requireWebsiteUser, asyncHandler(async (req, res) => res.json({ success: true, data: { id: req.user.id, role: req.user.role } })));
doctorAuthRouter.post('/login', otpLimiter, validate(websiteLoginWithRecaptchaSchema), asyncHandler(async (req, res) => {
  await verifyRecaptcha(req.body.recaptchaToken, 'doctor_login');
  res.json({ success: true, data: await beginDoctorLogin(req.body) });
}));
doctorAuthRouter.post('/send-otp', otpLimiter, validate(websiteResendSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sendDoctorOtp(req.body) })));
doctorAuthRouter.post('/verify-otp', validate(websiteVerifySchema), asyncHandler(async (req, res) => sendTokens(res, await verifyDoctorOtp(req.body, { ip: req.ip }))));
doctorAuthRouter.post('/forgot-password', otpLimiter, validate(websiteForgotPasswordSchema), asyncHandler(async (req, res) => {
  await verifyRecaptcha(req.body.recaptchaToken, 'doctor_forgot_password');
  res.json({ success: true, data: await requestDoctorPasswordReset(req.body) });
}));
doctorAuthRouter.post('/reset-password', otpLimiter, validate(websiteResetPasswordSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await resetDoctorPassword(req.body, { ip: req.ip }) });
}));
doctorAuthRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = readCookie(req);
  if (!token) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Sign in to continue.');
  sendTokens(res, await rotateRefreshToken(token, ['DOCTOR', 'ADMIN']));
}));
doctorAuthRouter.post('/logout', authenticateUser, requireWebsiteUser, asyncHandler(async (req, res) => {
  await logout(req.user.id, { refreshToken: readCookie(req), allDevices: req.body?.allDevices === true }, { ip: req.ip });
  res.clearCookie(cookieName, cookieOptions);
  res.json({ success: true, data: { loggedOut: true } });
}));
