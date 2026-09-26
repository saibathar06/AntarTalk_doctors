import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: true
  ,commandTimeout: 5000
});

redis.on('error', () => {
  // Connection failures are surfaced by operations and the readiness endpoint.
});
