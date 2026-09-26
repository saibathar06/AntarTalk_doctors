import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const randomOtp = () => crypto.randomInt(100000, 1000000).toString();
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const hashOtp = (userId, purpose, otp) => crypto
  .createHmac('sha256', env.OTP_PEPPER)
  .update(`${userId}:${purpose}:${otp}`)
  .digest('hex');
export const safeEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export const stableHash = (value) => sha256(JSON.stringify(value, Object.keys(value).sort()));
