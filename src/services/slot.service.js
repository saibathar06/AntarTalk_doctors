import crypto from 'node:crypto';
import { scheduling } from '../config/constants.js';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { localDateRange, timeParts } from '../utils/time.js';

export const reservationKey = (doctorId, startTime) =>
  `reservation:doctor:${doctorId}:slot:${startTime.toISOString()}`;

export function generateCandidateWindows(profile, from, to) {
  const windows = [];
  for (const date of localDateRange(from, to, profile.timezone)) {
    for (const hours of profile.workingHours.filter((item) => item.dayOfWeek === date.weekday)) {
      const startParts = timeParts(hours.startTime);
      const endParts = timeParts(hours.endTime);
      let start = date.set({ ...startParts, second: 0, millisecond: 0 });
      let end = date.set({ ...endParts, second: 0, millisecond: 0 });
      if (end <= start) end = end.plus({ days: 1 });
      // Skip nonexistent or ambiguous boundaries rather than guessing a UTC instant.
      if (start.hour !== startParts.hour || start.minute !== startParts.minute || end.hour !== endParts.hour || end.minute !== endParts.minute ||
          start.getPossibleOffsets().length !== 1 || end.getPossibleOffsets().length !== 1) continue;
      for (let cursor = start; cursor.plus({ minutes: scheduling.slotIntervalMinutes }) <= end; cursor = cursor.plus({ minutes: scheduling.slotIntervalMinutes })) {
        const slotStart = cursor.toUTC().toJSDate();
        const slotEnd = cursor.plus({ minutes: scheduling.slotIntervalMinutes }).toUTC().toJSDate();
        if (slotStart >= from && slotStart < to) windows.push({ startTime: slotStart, endTime: slotEnd });
      }
    }
  }
  return [...new Map(windows.map((slot) => [slot.startTime.toISOString(), slot])).values()]
    .sort((a, b) => a.startTime - b.startTime);
}

export async function getAvailableSlots({ doctorId, from, to, includeReservations = true }, db = prisma) {
  if (to.getTime() - from.getTime() > 31 * 86_400_000) throw new AppError(422, 'DATE_RANGE_TOO_LARGE', 'Availability can be requested for at most 31 days.');
  const profile = await db.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { id: true, timezone: true, verificationStatus: true, isAcceptingBookings: true, user: { select: { accountStatus: true, emailVerifiedAt: true } }, workingHours: { where: { isActive: true } } }
  });
  if (!profile || profile.verificationStatus !== 'VERIFIED' || !profile.isAcceptingBookings || profile.user.accountStatus !== 'ACTIVE' || !profile.user.emailVerifiedAt) {
    throw new AppError(404, 'DOCTOR_NOT_BOOKABLE', 'This professional is not currently accepting bookings.');
  }

  const candidates = generateCandidateWindows(profile, from, to).filter((slot) => slot.startTime > new Date());
  if (!candidates.length) return [];
  const rangeStart = candidates[0].startTime;
  const rangeEnd = candidates.at(-1).endTime;
  const [blocked, bookings] = await Promise.all([
    db.doctorBlockedSlot.findMany({ where: { doctorId, startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } }, select: { startTime: true, endTime: true } }),
    db.booking.findMany({ where: { doctorId, status: { in: ['PENDING', 'CONFIRMED'] }, startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } }, select: { startTime: true, endTime: true } })
  ]);
  const unavailable = [...blocked, ...bookings];
  let available = candidates.filter((slot) => !unavailable.some((busy) => busy.startTime < slot.endTime && busy.endTime > slot.startTime));
  if (includeReservations && available.length) {
    const held = await redis.mget(available.map((slot) => reservationKey(doctorId, slot.startTime)));
    available = available.filter((_slot, index) => held[index] === null);
  }
  return available.map((slot) => ({
    doctorId,
    startTime: slot.startTime,
    endTime: slot.endTime,
    sessionDurationMinutes: scheduling.sessionDurationMinutes,
    bufferDurationMinutes: scheduling.bufferDurationMinutes
  }));
}

export async function assertStructurallyBookable(doctorId, startTime, db = prisma) {
  const slots = await getAvailableSlots({
    doctorId,
    from: new Date(startTime.getTime() - 1),
    to: new Date(startTime.getTime() + scheduling.slotIntervalMinutes * 60_000),
    includeReservations: false
  }, db);
  const slot = slots.find((item) => item.startTime.getTime() === startTime.getTime());
  if (!slot) throw new AppError(409, 'SLOT_UNAVAILABLE', 'This appointment window is no longer available.');
  return slot;
}

export async function reserveSlot(clientId, doctorId, startTime) {
  const slot = await assertStructurallyBookable(doctorId, startTime);
  const reservationId = crypto.randomUUID();
  let value = JSON.stringify({ reservationId, clientId, doctorId, startTime: slot.startTime.toISOString(), endTime: slot.endTime.toISOString() });
  const key = reservationKey(doctorId, startTime);
  const result = await redis.eval(`
    local t = redis.call('TIME')
    local expiry = tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000) + tonumber(ARGV[2])*1000
    local v = cjson.decode(ARGV[1])
    v.expiresAt = expiry
    local raw = cjson.encode(v)
    if not redis.call('SET', KEYS[1], raw, 'EX', ARGV[2], 'NX') then return nil end
    return raw
  `, 1, key, value, scheduling.reservationTtlSeconds);
  if (!result) throw new AppError(409, 'SLOT_ALREADY_RESERVED', 'This slot is currently reserved. Please try again shortly.');
  value = String(result);
  try {
    await assertStructurallyBookable(doctorId, startTime);
  } catch (error) {
    await deleteReservationIfOwned(key, value);
    throw error;
  }
  return { reservationId, expiresAt: new Date(JSON.parse(value).expiresAt), slot };
}

export async function readOwnedReservation(clientId, { reservationId, doctorId, startTime }) {
  const key = reservationKey(doctorId, startTime);
  const raw = await redis.eval(`
    local raw = redis.call('GET', KEYS[1])
    if not raw or redis.call('PTTL', KEYS[1]) <= 0 then return nil end
    return raw
  `, 1, key);
  if (!raw) throw new AppError(409, 'RESERVATION_EXPIRED', 'The temporary reservation has expired.');
  let value;
  try { value = JSON.parse(String(raw)); } catch { throw new AppError(409, 'INVALID_RESERVATION', 'The reservation is invalid.'); }
  if (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) throw new AppError(409, 'RESERVATION_EXPIRED', 'The temporary reservation has expired.');
  if (value.reservationId !== reservationId || value.clientId !== clientId || value.doctorId !== doctorId || value.startTime !== startTime.toISOString()) {
    throw new AppError(403, 'RESERVATION_OWNERSHIP_MISMATCH', 'This reservation does not belong to the authenticated user.');
  }
  return { key, raw, value };
}

export async function deleteReservationIfOwned(key, expectedValue) {
  return redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, expectedValue);
}
