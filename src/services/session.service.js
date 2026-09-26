import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';

const sessionSelect = {
  id: true,
  startTime: true,
  endTime: true,
  sessionDurationMinutes: true,
  status: true,
  earning: { select: { amount: true, currency: true, status: true } }
};

export async function listSessions(doctorId, { type = 'all', status, page, limit }) {
  const now = new Date();
  const temporal = type === 'upcoming' ? { startTime: { gte: now } } : type === 'past' ? { startTime: { lt: now } } : {};
  const where = { doctorId, ...temporal, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({ where, select: sessionSelect, orderBy: { startTime: type === 'past' ? 'desc' : 'asc' }, skip: (page - 1) * limit, take: limit }),
    prisma.booking.count({ where })
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getSession(doctorId, bookingId) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, doctorId }, select: sessionSelect });
  if (!booking) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  return booking;
}

export function joinExpiry(booking, now = Date.now()) {
  const therapyEnd = Math.min(booking.endTime.getTime(), booking.startTime.getTime() + booking.sessionDurationMinutes * 60000);
  if (now < booking.startTime.getTime() - env.JOIN_EARLY_MINUTES * 60000 || now >= therapyEnd) {
    throw new AppError(403, 'OUTSIDE_JOIN_WINDOW', 'Join access is limited to the configured early window and therapy period.');
  }
  return Math.floor(therapyEnd / 1000);
}

export async function createJoinAccess(doctorId, bookingId) {
  const booking = await getSession(doctorId, bookingId);
  if (booking.status !== 'CONFIRMED') throw new AppError(409, 'SESSION_NOT_JOINABLE', 'Only confirmed sessions can be joined.');
  const now = Date.now();
  const exp = joinExpiry(booking, now);
  const sessionAccessToken = jwt.sign(
    { doctorId, bookingId, role: 'DOCTOR', exp },
    env.JWT_ACCESS_SECRET,
    { subject: doctorId, algorithm: 'HS256', issuer: 'antartalk-api', audience: 'antartalk-session' }
  );
  return { bookingId, roomId: `booking:${bookingId}`, sessionAccessToken, expiresIn: exp - Math.floor(now / 1000) };
}
