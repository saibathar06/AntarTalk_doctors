import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { canDoctorTakeSessions } from './eligibility.service.js';
import { earningsSummary } from './payout.service.js';

// Stable only within this practice; never disclose client email or phone.
const clientLabel = (doctorId, clientId) => `Client ${crypto.createHmac('sha256', env.OTP_PEPPER).update(`${doctorId}:${clientId}`).digest('hex').slice(0, 10).toUpperCase()}`;
const select = { id: true, clientId: true, startTime: true, endTime: true, sessionDurationMinutes: true, bufferDurationMinutes: true, status: true };
export function joinState(booking, eligible, now = Date.now()) {
  const therapyEnd = Math.min(booking.endTime.getTime(), booking.startTime.getTime() + booking.sessionDurationMinutes * 60000);
  const opensAt = new Date(booking.startTime.getTime() - env.JOIN_EARLY_MINUTES * 60000);
  const state = booking.status !== 'CONFIRMED' ? 'UNAVAILABLE' : now >= therapyEnd ? 'ENDED' : !eligible ? 'INELIGIBLE' : now < opensAt.getTime() ? 'NOT_YET' : 'READY';
  return { state, canJoin: state === 'READY', opensAt, closesAt: new Date(therapyEnd) };
}
const serialize = (booking, doctor) => {
  const { clientId, ...safe } = booking;
  return { ...safe, clientLabel: clientLabel(doctor.id, clientId), sessionType: 'Therapy session', join: joinState(booking, canDoctorTakeSessions(doctor)) };
};
async function profile(doctorId) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, include: { user: { select: { role: true, accountStatus: true, emailVerifiedAt: true } } } });
  if (!doctor) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found.');
  return doctor;
}
export async function appointments(doctorId, { filter = 'upcoming', date, page = 1, limit = 20 }) {
  const doctor = await profile(doctorId);
  const today = DateTime.now().setZone(doctor.timezone).startOf('day');
  const selectedDay = date ? DateTime.fromISO(date, { zone: doctor.timezone }).startOf('day') : today;
  /** @type {import('@prisma/client').Prisma.BookingWhereInput} */
  const where = { doctorId, ...(date || filter === 'today'
    ? { startTime: { gte: selectedDay.toJSDate(), lt: selectedDay.plus({ days: 1 }).toJSDate() } }
    : filter === 'upcoming' ? { endTime: { gt: new Date() }, status: { in: ['CONFIRMED', 'PENDING'] } }
      : filter === 'past' ? { endTime: { lte: new Date() } }
        : { status: filter === 'completed' ? 'COMPLETED' : 'CANCELLED' }) };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({ where, select, orderBy: { startTime: ['past', 'completed', 'cancelled'].includes(filter) ? 'desc' : 'asc' }, skip: (page - 1) * limit, take: limit }),
    prisma.booking.count({ where })
  ]);
  return { items: items.map((item) => serialize(item, doctor)), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, timezone: doctor.timezone, serverTime: new Date() };
}
export async function dashboard(doctorId) {
  const doctor = await profile(doctorId);
  const today = DateTime.now().setZone(doctor.timezone).startOf('day');
  const month = today.startOf('month');
  const [todaySessions, monthSessions, clients, schedule, earnings] = await Promise.all([
    prisma.booking.count({ where: { doctorId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] }, startTime: { gte: today.toJSDate(), lt: today.plus({ days: 1 }).toJSDate() } } }),
    prisma.booking.count({ where: { doctorId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] }, startTime: { gte: month.toJSDate(), lt: month.plus({ months: 1 }).toJSDate() } } }),
    prisma.$queryRaw`SELECT COUNT(DISTINCT "clientId")::int AS count FROM "Booking" WHERE "doctorId" = ${doctorId}::uuid`,
    appointments(doctorId, { filter: 'today', date: undefined, limit: 100 }),
    earningsSummary(doctorId)
  ]);
  return { todaySessions, totalClients: clients[0].count, monthSessions, earnings, averageRating: null, schedule, timezone: doctor.timezone };
}
export async function clients(doctorId, { page = 1, limit = 20 }) {
  const rows = await prisma.booking.groupBy({ by: ['clientId'], where: { doctorId }, _count: { id: true }, _max: { startTime: true }, orderBy: { _max: { startTime: 'desc' } }, skip: (page - 1) * limit, take: limit });
  const total = await prisma.$queryRaw`SELECT COUNT(DISTINCT "clientId")::int AS count FROM "Booking" WHERE "doctorId" = ${doctorId}::uuid`;
  return { items: rows.map((row) => ({ label: clientLabel(doctorId, row.clientId), appointmentCount: row._count.id, latestAppointmentAt: row._max.startTime })), pagination: { page, limit, total: total[0].count, pages: Math.ceil(total[0].count / limit) } };
}
