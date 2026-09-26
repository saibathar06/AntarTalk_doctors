import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
});

export async function sendOtpEmail({ email, code, purpose }) {
  const label = purpose === 'VERIFY_EMAIL' ? 'verify your AntarTalk account' : 'reset your AntarTalk password';
  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: email,
    subject: `Your AntarTalk verification code`,
    text: `Use ${code} to ${label}. This code expires shortly. If you did not request it, ignore this email.`,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}
