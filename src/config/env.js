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
  BOOKING_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(5000).max(30000).default(20000),
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
  EMAIL_FROM: emailFromSchema.default('AntarTalk<antartalk.main@gmail.com>'),
  RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  RAZORPAY_CURRENCY: z.literal('INR').default('INR'),
  PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(99.99).default(20),
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  PUSH_DELIVERY_ENABLED: z.string().default('true').transform((v) => v.trim().toLowerCase() === 'true'),
  VIDEO_SERVICE_URL: z.string().url().optional(),
  VIDEO_SERVICE_API_KEY: z.string().min(32).optional(),
  VIDEO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  DOCTOR_WEB_ORIGIN: z.string().url().optional(),
  CLIENT_WEB_ORIGIN: z.string().url().optional()
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
if (Boolean(env.RAZORPAY_KEY_ID) !== Boolean(env.RAZORPAY_KEY_SECRET)) {
  throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must either both be configured or both be omitted.');
}
if (Boolean(env.VIDEO_SERVICE_URL) !== Boolean(env.VIDEO_SERVICE_API_KEY)) {
  throw new Error('VIDEO_SERVICE_URL and VIDEO_SERVICE_API_KEY must either both be configured or both be omitted.');
}
const productionRequirements = {
  payoutEncryptionKeyPresent: Boolean(env.PAYOUT_ENCRYPTION_KEY),
  corsOriginsConfigured: env.CORS_ORIGINS.length > 0,
  corsOriginsValid: env.CORS_ORIGINS.every(isAllowedProductionCorsOrigin),
  jwtAccessSecretNonPlaceholder: !env.JWT_ACCESS_SECRET.startsWith('replace-'),
  otpPepperNonPlaceholder: !env.OTP_PEPPER.startsWith('replace-')
};
const productionSmtpRequirements = {
  smtpHostConfigured: env.SMTP_HOST !== 'localhost',
  smtpUserConfigured: Boolean(env.SMTP_USER),
  smtpPassConfigured: Boolean(env.SMTP_PASS),
  emailFromConfigured: Boolean(process.env.EMAIL_FROM)
};
if (env.NODE_ENV === 'production') {
  const failed = Object.entries(productionRequirements).filter(([, valid]) => !valid).map(([name]) => name);
  if (failed.length) throw new Error(`Production configuration requirements not met: ${failed.join(', ')}.`);
  const smtpFailed = Object.entries(productionSmtpRequirements).filter(([, valid]) => !valid).map(([name]) => name);
  if (smtpFailed.length) throw new Error(`Production SMTP configuration requirements not met: ${smtpFailed.join(', ')}.`);
}
