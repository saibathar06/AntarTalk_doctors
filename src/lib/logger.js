import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  serializers: { err: (error) => ({ type: error?.name, code: error?.code }) },
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'password', 'passwordHash',
      'otp', 'token', 'refreshToken', '*.password', '*.otp', '*.token', '*.refreshToken',
      'providerToken', '*.providerToken', 'encryptedProviderDetails', '*.encryptedProviderDetails',
      'req.body', 'req.query', 'req.url'
    ],
    censor: '[REDACTED]'
  }
});
