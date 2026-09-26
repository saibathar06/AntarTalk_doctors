import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redis.js';
import { sha256 } from '../utils/crypto.js';

const response = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } };

const store = (prefix) => new RedisStore({
  sendCommand: async (command, ...args) => /** @type {import('rate-limit-redis').RedisReply} */ (await redis.call(command, ...args)),
  prefix
});

export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, store: store('rl:api:'), standardHeaders: 'draft-8', legacyHeaders: false, message: response });
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, store: store('rl:auth:'), standardHeaders: 'draft-8', legacyHeaders: false, message: response });
export const otpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, store: store('rl:otp:'), standardHeaders: 'draft-8', legacyHeaders: false, message: response });
export const accountAuthLimiter = rateLimit({
  windowMs: 15 * 60000, limit: 20, store: store('rl:account:'),
  keyGenerator: (req) => sha256(String(req.body?.email ?? req.body?.refreshToken ?? '').trim().toLowerCase()),
  skip: (req) => !req.body?.email && !req.body?.refreshToken,
  standardHeaders: 'draft-8', legacyHeaders: false, message: response
});
export const sensitiveLimiter = rateLimit({
  windowMs: 60000, limit: 10, store: store('rl:sensitive:'),
  keyGenerator: (req) => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false, message: response,
  skip: (req) => req.method === 'GET'
});
