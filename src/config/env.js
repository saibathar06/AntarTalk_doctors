import 'dotenv/config';
import { URL } from 'node:url';
import { z } from 'zod';

const emailFromSchema = z.string().trim().refine((value) => {
  const mailbox = '[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+';
  return new RegExp(`^${mailbox}$`).test(value) || new RegExp(`^[^<>\\r\\n]+<\\s*${mailbox}\\s*>$`).test(value);
}, 'EMAIL_FROM must be an email address or a display name followed by <email@example.com>.');

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
function isAllowedProductionCorsOrigin(origin) {
  if (origin.includes('*')) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname)));
  } catch {
    return false;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  UPLOAD_DIR: z.string().default('./uploads'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  PAYOUT_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  TRUST_PROXY: z.string().default(''),
  JOIN_EARLY_MINUTES: z.coerce.number().int().min(0).max(30).default(10),
  OTP_PEPPER: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().regex(/^(?:[1-9]|[12][0-9]|30)m$/).default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  SESSION_DURATION_MINUTES: z.coerce.number().int().positive().default(40),
  BUFFER_DURATION_MINUTES: z.coerce.number().int().nonnegative().default(20),
  SLOT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4000,http://localhost:3000,http://localhost:8081'),
  LOG_LEVEL: z.string().default('info'),
  SMTP_HOST: z.string().trim().min(1).default('localhost'),
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(15000),
  // Optional granular overrides. The legacy shared timeout remains supported below.
  SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).optional(),
  SMTP_GREETING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).optional(),
  SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.string().default('false').transform((v) => v.trim().toLowerCase() === 'true'),
  SMTP_USER: z.string().trim().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  // Nodemailer accepts both `sender@example.com` and `AntarTalk <sender@example.com>`.
  EMAIL_FROM: emailFromSchema.default('AntarTalk<antartalk.main@gmail.com>')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration: ${fields}`);
}

export const env = Object.freeze({
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
});

if (env.SESSION_DURATION_MINUTES + env.BUFFER_DURATION_MINUTES !== env.SLOT_INTERVAL_MINUTES) {
  throw new Error('Session duration plus buffer must equal the slot interval');
}
if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
  throw new Error('SMTP_USER and SMTP_PASS must either both be configured or both be omitted.');
}
if (env.NODE_ENV === 'production' && (
  !env.PAYOUT_ENCRYPTION_KEY ||
  env.CORS_ORIGINS.length === 0 ||
  env.CORS_ORIGINS.some((origin) => !isAllowedProductionCorsOrigin(origin)) ||
  [env.JWT_ACCESS_SECRET, env.OTP_PEPPER].some((secret) => secret.startsWith('replace-'))
)) throw new Error('Production requires encryption, HTTPS public origins (or explicit HTTP loopback origins), and non-placeholder secrets');
if (env.NODE_ENV === 'production' && (env.SMTP_HOST === 'localhost' || !env.SMTP_USER || !env.SMTP_PASS || !process.env.EMAIL_FROM)) {
  throw new Error('Production OTP email requires SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM.');
}
