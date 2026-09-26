import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { authLimiter, otpLimiter, accountAuthLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import * as auth from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  forgotPasswordSchema, loginSchema, logoutSchema, registerSchema, resendOtpSchema,
  resetPasswordSchema, tokenSchema, verifyOtpSchema
} from '../validation/auth.schemas.js';

export const authRouter = Router();
authRouter.use(accountAuthLimiter);

authRouter.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const data = await auth.registerDoctor(req.body, { ip: req.ip });
  res.status(201).json({ success: true, data, message: 'Registration received. Verify your email; professional review remains pending.' });
}));

authRouter.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), asyncHandler(async (req, res) => {
  const data = await auth.verifyEmail(req.body, { ip: req.ip });
  res.json({ success: true, data });
}));

authRouter.post('/resend-otp', otpLimiter, validate(resendOtpSchema), asyncHandler(async (req, res) => {
  await auth.resendOtp(req.body);
  res.json({ success: true, data: { sent: true } });
}));

authRouter.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const data = await auth.login(req.body, { ip: req.ip });
  res.json({ success: true, data });
}));

authRouter.post('/refresh', authLimiter, validate(tokenSchema), asyncHandler(async (req, res) => {
  const data = await auth.rotateRefreshToken(req.body.refreshToken);
  res.json({ success: true, data });
}));

authRouter.post('/logout', authenticateUser, validate(logoutSchema), asyncHandler(async (req, res) => {
  await auth.logout(req.user.id, req.body, { ip: req.ip });
  res.json({ success: true, data: { loggedOut: true } });
}));

authRouter.post('/forgot-password', otpLimiter, validate(forgotPasswordSchema), asyncHandler(async (req, res) => {
  await auth.forgotPassword(req.body);
  res.json({ success: true, data: { sent: true } });
}));

authRouter.post('/reset-password', otpLimiter, validate(resetPasswordSchema), asyncHandler(async (req, res) => {
  await auth.resetPassword(req.body, { ip: req.ip });
  res.json({ success: true, data: { reset: true } });
}));
