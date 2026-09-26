import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from './logger.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  connectionTimeout: env.SMTP_TIMEOUT_MS,
  greetingTimeout: env.SMTP_TIMEOUT_MS,
  socketTimeout: env.SMTP_TIMEOUT_MS,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
});

export async function sendOtpEmail({ email, code, purpose }) {
  const label = purpose === 'DOCTOR_LOGIN' ? 'sign in to AntarTalk Professionals' : purpose === 'VERIFY_EMAIL' ? 'verify your AntarTalk account' : 'reset your AntarTalk password';
  try { await transport.sendMail({
    from: env.EMAIL_FROM,
    to: email,
    subject: `Your AntarTalk verification code`,
    text: `Use ${code} to ${label}. This code expires shortly. If you did not request it, ignore this email.`,
    disableFileAccess: true,
    disableUrlAccess: true
  }); } catch (error) {
    // SMTP responses can include email addresses; log only safe categories.
    const errorCode = ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'EENVELOPE', 'EMESSAGE'].includes(error.code) ? error.code : 'EMAIL_ERROR';
    logger.error({ errorCode, responseCode: Number.isInteger(error.responseCode) ? error.responseCode : undefined }, 'OTP email delivery failed');
    throw new AppError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'The verification email could not be sent. Please try resending later or contact support. Registration may already have saved your account.');
  }
}
