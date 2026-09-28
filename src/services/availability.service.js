import { AppError } from '../errors/AppError.js';
import { DateTime } from 'luxon';
import { bookingWindow } from '../utils/bookingWindow.js';
import { effectiveWorkingHours, getDefaultTiming } from '../utils/defaultTiming.js';
import { prisma } from '../lib/prisma.js';
import { assertTimezone, parseTimeToDate } from '../utils/time.js';
import { recordAudit } from './audit.service.js';
import { lockUser, lockDoctor, serialTransaction } from './transaction.service.js';

export const serializeWorkingHour = (row) => ({
  ...row, availableDate: row.availableDate?.toISOString().slice(0, 10), startTime: row.startTime.toISOString().slice(11, 16), endTime: row.endTime.toISOString().slice(11, 16)
});

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function assertNoWeeklyOverlap(windows) {
  const intervals = [];
  for (const window of windows.filter((item) => item.isActive)) {
    const day = DateTime.fromISO(window.availableDate, { zone: 'Asia/Kolkata' }).toMillis() / 60000;
    const start = day + minutes(window.startTime);
    let end = day + minutes(window.endTime);
    if (end <= start) end += 1440;
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i][0] < intervals[i - 1][1]) throw new AppError(422, 'OVERLAPPING_WORKING_HOURS', 'Working-hour windows cannot overlap.');
  }
}

export async function getWorkingHours(doctorId) {
  const rows = await prisma.doctorWorkingHour.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] });
  const profile = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { availabilityPresets: true } });
  const { today } = bookingWindow();
  return effectiveWorkingHours(rows, profile.availabilityPresets)
    .filter((row) => row.availableDate && row.availableDate.toISOString().slice(0, 10) >= today.toISODate())
    .map(serializeWorkingHour);
}

export async function readDefaultTiming(doctorId) {
  return getDefaultTiming(await getPresets(doctorId));
}

export async function saveDefaultTiming(userId, doctorId, timing) {
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId } });
    if (doctor?.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'Professional verification required.');
    const presets = timing ? [{ ...timing, isDefault: true }] : [];
    const rows = await tx.doctorWorkingHour.findMany({ where: { doctorId } });
    assertNoWeeklyOverlap(effectiveWorkingHours(rows, presets).map(serializeWorkingHour));
    await tx.doctorProfile.update({ where: { id: doctorId }, data: { availabilityPresets: presets } });
    return timing;
  });
}

export async function getPresets(doctorId) {
  const row = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { availabilityPresets: true } });
  return row.availabilityPresets;
}

export async function savePresets(userId, doctorId, presets) {
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId } });
    if (doctor?.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'Professional verification required.');
    await tx.doctorProfile.update({ where: { id: doctorId }, data: { availabilityPresets: presets } });
    return presets;
  });
}

export async function replaceWorkingHours(userId, doctorId, { timezone, windows }, context = {}) {
  assertTimezone(timezone);
  const { today, end: horizon } = bookingWindow();
  windows = windows.filter((window) => !window.useDefault).map((window) => {
    const date = window.availableDate
      ? DateTime.fromISO(window.availableDate, { zone: 'Asia/Kolkata' })
      : today.plus({ days: (window.dayOfWeek - today.weekday + 7) % 7 });
    let end = date.plus({ minutes: minutes(window.endTime) });
    if (window.endTime <= window.startTime) end = end.plus({ days: 1 });
    if (!date.isValid || date < today || date.toJSDate() >= horizon || end.toJSDate() > horizon || date.weekday !== window.dayOfWeek) {
      throw new AppError(422, 'OUTSIDE_BOOKING_WINDOW', 'Choose availability within today and the next six days in IST.');
    }
    return { ...window, availableDate: date.toISODate() };
  });
  assertNoWeeklyOverlap(windows);
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { verificationStatus: true, availabilityPresets: true } });
    if (doctor?.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'Professional verification is required to manage availability.');
    assertNoWeeklyOverlap(effectiveWorkingHours(windows.map((window) => ({
      ...window, availableDate: new Date(window.availableDate), startTime: parseTimeToDate(window.startTime), endTime: parseTimeToDate(window.endTime)
    })), doctor.availabilityPresets).map(serializeWorkingHour));
    await tx.doctorWorkingHour.deleteMany({ where: { doctorId } });
    if (windows.length) {
      await tx.doctorWorkingHour.createMany({ data: windows.map((window) => ({
        doctorId, dayOfWeek: window.dayOfWeek, availableDate: new Date(window.availableDate), startTime: parseTimeToDate(window.startTime),
        endTime: parseTimeToDate(window.endTime), timezone, isActive: window.isActive
      })) });
    }
    await tx.doctorProfile.update({ where: { id: doctorId }, data: { timezone } });
    await recordAudit({ actorId: userId, action: 'WORKING_HOURS_REPLACED', entityType: 'DoctorProfile', entityId: doctorId, metadata: { windowCount: windows.length }, ipAddress: context.ip }, tx);
    return (await tx.doctorWorkingHour.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] })).map(serializeWorkingHour);
  });
}

export async function listBlockedSlots(doctorId) {
  return prisma.doctorBlockedSlot.findMany({ where: { doctorId, endTime: { gt: new Date() } }, orderBy: { startTime: 'asc' } });
}

export async function createBlockedSlot(userId, doctorId, input, context = {}) {
  if (input.startTime <= new Date() || input.endTime - input.startTime > 366 * 86400000) throw new AppError(422, 'INVALID_BLOCK_RANGE', 'Blocked periods must start in the future and span at most 366 days.');
  return serialTransaction(async (tx) => {
  await lockUser(tx, userId);
  await lockDoctor(tx, doctorId);
  const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { verificationStatus: true } });
  if (doctor?.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'Professional verification is required to block time.');
  const conflict = await tx.booking.findFirst({ where: {
    doctorId, status: { in: ['PENDING', 'CONFIRMED'] }, startTime: { lt: input.endTime }, endTime: { gt: input.startTime }
  } });
  if (conflict) throw new AppError(409, 'BLOCK_CONFLICTS_WITH_BOOKING', 'This period overlaps an active booking.');
    const overlap = await tx.doctorBlockedSlot.findFirst({ where: { doctorId, startTime: { lt: input.endTime }, endTime: { gt: input.startTime } } });
    if (overlap) throw new AppError(409, 'BLOCK_OVERLAP', 'This period overlaps an existing blocked period.');
    const blocked = await tx.doctorBlockedSlot.create({ data: { doctorId, startTime: input.startTime, endTime: input.endTime, reason: input.reason } });
    await recordAudit({ actorId: userId, action: 'TIME_BLOCKED', entityType: 'DoctorBlockedSlot', entityId: blocked.id, ipAddress: context.ip }, tx);
    return blocked;
  });
}

export async function deleteBlockedSlot(userId, doctorId, blockedId, context = {}) {
  const existing = await prisma.doctorBlockedSlot.findFirst({ where: { id: blockedId, doctorId } });
  if (!existing) throw new AppError(404, 'BLOCKED_SLOT_NOT_FOUND', 'Blocked period not found.');
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { verificationStatus: true } });
    if (doctor?.verificationStatus !== 'VERIFIED') throw new AppError(403, 'DOCTOR_NOT_VERIFIED', 'Professional verification is required to manage blocked time.');
    await tx.doctorBlockedSlot.delete({ where: { id: blockedId } });
    await recordAudit({ actorId: userId, action: 'TIME_UNBLOCKED', entityType: 'DoctorBlockedSlot', entityId: blockedId, ipAddress: context.ip }, tx);
  });
}
