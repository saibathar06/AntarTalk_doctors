import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

export function encryptProviderToken(value) {
  if (!env.PAYOUT_ENCRYPTION_KEY) throw new AppError(503, 'PAYOUT_CONFIGURATION_REQUIRED', 'Payout account storage is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(env.PAYOUT_ENCRYPTION_KEY, 'hex'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}
