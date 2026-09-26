import { DateTime, IANAZone } from 'luxon';
import { AppError } from '../errors/AppError.js';

export function assertTimezone(zone) {
  if (!IANAZone.isValidZone(zone)) throw new AppError(422, 'INVALID_TIMEZONE', 'Use a valid IANA timezone.');
}

export function parseTimeToDate(time) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);
  if (!match) throw new AppError(422, 'INVALID_TIME', 'Time must use HH:mm format.');
  return new Date(`1970-01-01T${time}:00.000Z`);
}

export function timeParts(value) {
  const date = new Date(value);
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

export function localDateRange(from, to, timezone) {
  const start = DateTime.fromJSDate(from, { zone: 'utc' }).setZone(timezone).startOf('day').minus({ days: 1 });
  const end = DateTime.fromJSDate(to, { zone: 'utc' }).setZone(timezone).endOf('day');
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) dates.push(cursor);
  return dates;
}
