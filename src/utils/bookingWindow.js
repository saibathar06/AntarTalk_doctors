import { DateTime } from 'luxon';

export function bookingWindow(now = new Date()) {
  const today = DateTime.fromJSDate(now, { zone: 'Asia/Kolkata' }).startOf('day');
  return { today, end: today.plus({ days: 7 }).toJSDate() };
}
