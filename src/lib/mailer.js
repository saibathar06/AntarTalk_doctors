import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from './logger.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  // Matches the working AntarTalk user/mobile Brevo transport defaults.
  connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS ?? Math.min(env.SMTP_TIMEOUT_MS, 10000),
  greetingTimeout: env.SMTP_GREETING_TIMEOUT_MS ?? Math.min(env.SMTP_TIMEOUT_MS, 10000),
  socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS ?? env.SMTP_TIMEOUT_MS,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
});

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '[invalid-recipient]';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, local.length - 2)))}@${domain}`;
}

export async function sendBookingEmail({ email, text, messageId }) {
  const result = await transport.sendMail({
    from: env.EMAIL_FROM, to: email, subject: 'Your AntarTalk session is confirmed',
    text, messageId, disableFileAccess: true, disableUrlAccess: true
  });
  if (!result.accepted?.length) throw new Error('Booking email recipient not accepted');
  logger.info({ recipient: maskEmail(email), messageId: result.messageId }, 'Booking confirmation accepted by SMTP');
}

function otpTemplate(code, label) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173f7a">
    <h2 style="color:#d36157">AntarTalk verification</h2>
    <p>Use the following one-time password to ${label}:</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#173f7a">${code}</div>
    <p>This code expires in <strong>${env.OTP_TTL_MINUTES} minutes</strong>.</p>
    <p>If you did not make this request, you can safely ignore this email.</p>
  </div>`;
}

export async function sendOtpEmail({ email, code, purpose }) {
  const label = purpose === 'DOCTOR_LOGIN' ? 'sign in to AntarTalk Professionals' : purpose === 'VERIFY_EMAIL' ? 'verify your AntarTalk account' : 'reset your AntarTalk password';
  const recipient = maskEmail(email);
  logger.info({ recipient, purpose }, 'OTP email requested');
  try {
    logger.info({ recipient, purpose, smtpHost: env.SMTP_HOST, smtpPort: env.SMTP_PORT, secure: env.SMTP_SECURE }, 'OTP email sending started');
    const result = await transport.sendMail({
      from: env.EMAIL_FROM,
      to: email,
      subject: 'Your AntarTalk verification code',
      text: `Use ${code} to ${label}. This code expires in ${env.OTP_TTL_MINUTES} minutes. If you did not request it, ignore this email.`,
      html: otpTemplate(code, label),
      disableFileAccess: true,
      disableUrlAccess: true
    });
    if (Array.isArray(result.accepted) && result.accepted.length === 0) {
      const error = Object.assign(new Error('SMTP did not accept the recipient.'), {
        code: 'EENVELOPE', responseCode: result.rejected?.length ? 550 : undefined
      });
      throw error;
    }
    logger.info({ recipient, purpose, messageId: result.messageId ?? undefined, acceptedCount: Array.isArray(result.accepted) ? result.accepted.length : undefined }, 'OTP email accepted by SMTP');
    return result;
  } catch (error) {
    // SMTP responses can include email addresses; log only safe categories.
    const errorCode = ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'EENVELOPE', 'EMESSAGE'].includes(error.code) ? error.code : 'EMAIL_ERROR';
    logger.error({ recipient, purpose, errorCode, responseCode: Number.isInteger(error.responseCode) ? error.responseCode : undefined }, 'OTP email delivery failed');
    throw new AppError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'The verification email could not be sent. Please try resending later or contact support. Registration may already have saved your account.');
  }
}
