import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { assertTimezone, parseTimeToDate } from '../utils/time.js';
import { recordAudit } from './audit.service.js';
import { lockUser, lockDoctor, serialTransaction } from './transaction.service.js';

export const serializeWorkingHour = (row) => ({
  ...row, startTime: row.startTime.toISOString().slice(11, 16), endTime: row.endTime.toISOString().slice(11, 16)
});

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function assertNoWeeklyOverlap(windows) {
  const intervals = [];
  for (const window of windows.filter((item) => item.isActive)) {
    const start = (window.dayOfWeek - 1) * 1440 + minutes(window.startTime);
    let end = (window.dayOfWeek - 1) * 1440 + minutes(window.endTime);
    if (end <= start) end += 1440;
    intervals.push([start, end]);
    // Sunday windows crossing into Monday must also be compared at the start of the week.
    if (end > 7 * 1440) intervals.push([start - 7 * 1440, end - 7 * 1440]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i][0] < intervals[i - 1][1]) throw new AppError(422, 'OVERLAPPING_WORKING_HOURS', 'Working-hour windows cannot overlap.');
  }
}

export async function getWorkingHours(doctorId) {
  return (await prisma.doctorWorkingHour.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] })).map(serializeWorkingHour);
}

export async function replaceWorkingHours(userId, doctorId, { timezone, windows }, context = {}) {
  assertTimezone(timezone);
  assertNoWeeklyOverlap(windows);
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    await tx.doctorWorkingHour.deleteMany({ where: { doctorId } });
    if (windows.length) {
      await tx.doctorWorkingHour.createMany({ data: windows.map((window) => ({
        doctorId, dayOfWeek: window.dayOfWeek, startTime: parseTimeToDate(window.startTime),
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
    await tx.doctorBlockedSlot.delete({ where: { id: blockedId } });
    await recordAudit({ actorId: userId, action: 'TIME_UNBLOCKED', entityType: 'DoctorBlockedSlot', entityId: blockedId, ipAddress: context.ip }, tx);
  });
}
