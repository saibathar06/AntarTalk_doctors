import { env } from './env.js';

export const scheduling = Object.freeze({
  sessionDurationMinutes: env.SESSION_DURATION_MINUTES,
  bufferDurationMinutes: env.BUFFER_DURATION_MINUTES,
  slotIntervalMinutes: env.SLOT_INTERVAL_MINUTES,
  reservationTtlSeconds: env.RESERVATION_TTL_SECONDS
});

export const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'];
