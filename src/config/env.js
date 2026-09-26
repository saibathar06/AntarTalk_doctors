import 'dotenv/config';
import { z } from 'zod';

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
  SMTP_HOST: z.string().default('localhost'),
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(15000),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.string().default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().default('no-reply@antartalk.com')
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
if (env.NODE_ENV === 'production' && (
  !env.PAYOUT_ENCRYPTION_KEY ||
  env.CORS_ORIGINS.length === 0 ||
  env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://') || origin.includes('*')) ||
  [env.JWT_ACCESS_SECRET, env.OTP_PEPPER].some((secret) => secret.startsWith('replace-'))
)) throw new Error('Production requires encryption, HTTPS origins and non-placeholder secrets');
