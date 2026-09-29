import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';
import { enqueueBookingEvent } from './bookingEvent.service.js';
import { assertStructurallyBookable } from './slot.service.js';
import { lockDoctor, lockUser, serialTransaction } from './transaction.service.js';
import { endVideoCall } from './video.service.js';

const doctorSelect = { id: true, userId: true, firstName: true, lastName: true, timezone: true };
/** @type {import('@prisma/client').Prisma.BookingInclude} */
const lifecycleInclude = {
  payment: true,
  refund: true,
  penalty: true,
  videoCall: true,
  doctor: { select: doctorSelect },
  rescheduleRequests: { orderBy: { createdAt: 'desc' }, take: 5 }
};
const contextNow = (context) => /** @type {{now?: Date}} */ (context).now ?? new Date();
const contextIp = (context) => /** @type {{ip?: string}} */ (context).ip;

function assertConfirmedFuture(booking, now) {
  if (booking.status !== 'CONFIRMED') throw new AppError(409, 'SESSION_NOT_CHANGEABLE', 'Only a confirmed session can be changed.');
  if (now >= booking.startTime) throw new AppError(409, 'SESSION_ALREADY_STARTED', 'This session has already started and can no longer be changed.');
}

async function lockBooking(tx, bookingId) {
  await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId}::uuid FOR UPDATE`;
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: lifecycleInclude });
  if (!booking) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  return booking;
}

function rescheduleWindow(booking, now) {
  assertConfirmedFuture(booking, now);
  if (booking.rescheduleCount >= 1) throw new AppError(409, 'RESCHEDULE_LIMIT_REACHED', 'This appointment has already been rescheduled once.');
  if (booking.videoCall && now >= booking.videoCall.opensAt) {
    throw new AppError(409, 'RESCHEDULE_WINDOW_CLOSED', 'This appointment is too close to its joining time to reschedule.');
  }
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function completeDoctorSession(userId, doctorId, bookingId, context = {}) {
  const now = contextNow(context);
  const result = await serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const booking = await lockBooking(tx, bookingId);
    if (booking.doctorId !== doctorId) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    if (booking.status === 'COMPLETED') return tx.booking.findUnique({ where: { id: booking.id }, include: { earning: true } });
    if (booking.status !== 'CONFIRMED') throw new AppError(409, 'SESSION_NOT_COMPLETABLE', 'Only a confirmed session can be completed.');
    const therapyEnd = new Date(booking.startTime.getTime() + booking.sessionDurationMinutes * 60_000);
    if (now < therapyEnd) throw new AppError(409, 'SESSION_STILL_IN_PROGRESS', 'Complete the session after its scheduled therapy time ends.');
    if (booking.payment?.status !== 'SUCCEEDED' || !booking.payment.doctorEarning?.greaterThan(0)) {
      throw new AppError(409, 'EARNING_NOT_SETTLEABLE', 'A verified successful payment is required before this session can be completed.');
    }
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED', completedAt: now } });
    const earning = await tx.earning.upsert({
      where: { bookingId: booking.id },
      create: { doctorId, bookingId: booking.id, amount: booking.payment.doctorEarning, currency: booking.payment.currency, status: 'AVAILABLE' },
      update: {}
    });
    await recordAudit({ actorId: userId, action: 'SESSION_COMPLETED', entityType: 'Booking', entityId: booking.id, metadata: { earningId: earning.id }, ipAddress: contextIp(context) }, tx);
    return tx.booking.findUnique({ where: { id: booking.id }, include: { earning: true } });
  });
  await endVideoCall(bookingId, 'ended').catch(() => {});
  return jsonSafe(result);
}

async function cancelSession({ actor, userId, doctorId, bookingId, reason, context = {} }) {
  const now = contextNow(context);
  const result = await serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.booking.findUnique({ where: { id: bookingId }, select: { doctorId: true, clientId: true } });
    if (!existing || actor === 'CLIENT' && existing.clientId !== userId || actor === 'DOCTOR' && existing.doctorId !== doctorId) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    }
    await lockDoctor(tx, existing.doctorId);
    const booking = await lockBooking(tx, bookingId);
    if (booking.status === 'CANCELLED') return booking;
    assertConfirmedFuture(booking, now);
    if (actor === 'DOCTOR' && (!booking.payment || booking.payment.status !== 'SUCCEEDED' || booking.payment.provider !== 'RAZORPAY' || !booking.payment.providerPaymentId)) {
      throw new AppError(409, 'REFUND_NOT_AVAILABLE', 'This payment cannot be refunded automatically. Contact support before cancelling.');
    }
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: actor, cancellationReason: reason || null } });
    await tx.rescheduleRequest.updateMany({ where: { bookingId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: now } });
    if (booking.videoCall) await tx.videoCall.update({ where: { bookingId }, data: { state: 'CANCELLED', nextAttemptAt: now } });

    let refund = booking.refund;
    let penalty = booking.penalty;
    if (actor === 'DOCTOR') {
      refund = await tx.refundTransaction.upsert({
        where: { bookingId },
        create: { bookingId, paymentId: booking.payment.id, amount: booking.payment.amount, currency: booking.payment.currency },
        update: {}
      });
      const zone = booking.doctor.timezone || 'Asia/Kolkata';
      const sameDay = DateTime.fromJSDate(now, { zone }).hasSame(DateTime.fromJSDate(booking.startTime, { zone }), 'day');
      if (sameDay && env.DOCTOR_SAME_DAY_CANCELLATION_PENALTY_PERCENT > 0) {
        const amount = booking.payment.amount.mul(env.DOCTOR_SAME_DAY_CANCELLATION_PENALTY_PERCENT).div(100).toDecimalPlaces(2);
        if (amount.greaterThan(0)) penalty = await tx.doctorPenalty.upsert({
          where: { bookingId },
          create: { doctorId: booking.doctorId, bookingId, amount, currency: booking.payment.currency, reason: 'SAME_DAY_DOCTOR_CANCELLATION' },
          update: {}
        });
      }
    }
    const cancelled = await tx.booking.findUnique({ where: { id: booking.id }, include: lifecycleInclude });
    await enqueueBookingEvent(tx, cancelled, booking.doctor, 'CANCELLATION', {
      cancelledBy: actor,
      refundAmount: refund?.amount?.toString() ?? null,
      penaltyAmount: penalty?.amount?.toString() ?? null
    });
    await recordAudit({ actorId: userId, action: `${actor}_SESSION_CANCELLED`, entityType: 'Booking', entityId: booking.id, metadata: { refundId: refund?.id ?? null, penaltyId: penalty?.id ?? null }, ipAddress: contextIp(context) }, tx);
    return cancelled;
  });
  await endVideoCall(bookingId, 'cancelled').catch(() => {});
  return jsonSafe(result);
}

export function cancelClientSession(userId, bookingId, reason, context) {
  return cancelSession({ actor: 'CLIENT', userId, doctorId: undefined, bookingId, reason, context });
}

export function cancelDoctorSession(userId, doctorId, bookingId, reason, context) {
  return cancelSession({ actor: 'DOCTOR', userId, doctorId, bookingId, reason, context });
}

export async function requestClientReschedule(userId, bookingId, input, context = {}) {
  const now = contextNow(context);
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    const initial = await tx.booking.findUnique({ where: { id: bookingId }, select: { doctorId: true, clientId: true } });
    if (!initial || initial.clientId !== userId) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    await lockDoctor(tx, initial.doctorId);
    const booking = await lockBooking(tx, bookingId);
    rescheduleWindow(booking, now);
    if (booking.startTime.getTime() === input.startTime.getTime()) throw new AppError(422, 'SAME_APPOINTMENT_TIME', 'Choose a different appointment time.');
    const slot = await assertStructurallyBookable(booking.doctorId, input.startTime, tx, booking.id);
    const pending = booking.rescheduleRequests.find((item) => item.status === 'PENDING');
    if (pending) throw new AppError(409, 'RESCHEDULE_ALREADY_PENDING', 'A reschedule request is already awaiting a response.');
    const request = await tx.rescheduleRequest.create({ data: {
      bookingId, requesterId: userId, proposedStartTime: slot.startTime, proposedEndTime: slot.endTime, reason: input.reason || null
    } });
    await enqueueBookingEvent(tx, booking, booking.doctor, 'RESCHEDULE_REQUESTED', { proposedStartTime: slot.startTime.toISOString() }, ['CLIENT', 'DOCTOR'], request.id);
    await recordAudit({ actorId: userId, action: 'RESCHEDULE_REQUESTED', entityType: 'RescheduleRequest', entityId: request.id, ipAddress: contextIp(context) }, tx);
    return request;
  });
}

export async function cancelClientReschedule(userId, bookingId, requestId, context = {}) {
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    const request = await tx.rescheduleRequest.findFirst({ where: { id: requestId, bookingId, requesterId: userId }, include: { booking: true } });
    if (!request) throw new AppError(404, 'RESCHEDULE_REQUEST_NOT_FOUND', 'Reschedule request not found.');
    if (request.status !== 'PENDING') throw new AppError(409, 'RESCHEDULE_REQUEST_CHANGED', 'This request is no longer pending.');
    const updated = await tx.rescheduleRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    await recordAudit({ actorId: userId, action: 'RESCHEDULE_REQUEST_CANCELLED', entityType: 'RescheduleRequest', entityId: requestId, ipAddress: contextIp(context) }, tx);
    return updated;
  });
}

async function applyReschedule(tx, booking, startTime, actorId, action, context, requestId) {
  const now = contextNow(context);
  rescheduleWindow(booking, now);
  if (booking.startTime.getTime() === startTime.getTime()) throw new AppError(422, 'SAME_APPOINTMENT_TIME', 'Choose a different appointment time.');
  const slot = await assertStructurallyBookable(booking.doctorId, startTime, tx, booking.id);
  const oldStartTime = booking.startTime.toISOString();
  const updated = await tx.booking.update({ where: { id: booking.id }, data: {
    startTime: slot.startTime, endTime: slot.endTime, rescheduleCount: { increment: 1 }
  }, include: lifecycleInclude });
  await tx.rescheduleRequest.updateMany({ where: { bookingId: booking.id, status: 'PENDING', ...(requestId ? { id: { not: requestId } } : {}) }, data: { status: 'CANCELLED', respondedAt: now } });
  if (booking.videoCall) await tx.videoCall.update({ where: { bookingId: booking.id }, data: {
    serviceSessionId: null, state: 'PENDING', attempts: 0, lastErrorCode: null, nextAttemptAt: now,
    opensAt: new Date(slot.startTime.getTime() - env.JOIN_EARLY_MINUTES * 60_000),
    closesAt: new Date(slot.startTime.getTime() + booking.sessionDurationMinutes * 60_000)
  } });
  await enqueueBookingEvent(tx, updated, booking.doctor, 'RESCHEDULED', { oldStartTime, rescheduledBy: action }, ['CLIENT', 'DOCTOR'], requestId ?? `direct-${updated.rescheduleCount}`);
  await recordAudit({ actorId, action, entityType: 'Booking', entityId: booking.id, metadata: { oldStartTime, newStartTime: slot.startTime.toISOString() }, ipAddress: contextIp(context) }, tx);
  return updated;
}

export async function listDoctorRescheduleRequests(doctorId, { page, limit, status }) {
  const where = { booking: { doctorId }, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.rescheduleRequest.findMany({ where, include: { booking: { select: { id: true, clientName: true, startTime: true, sessionDurationMinutes: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.rescheduleRequest.count({ where })
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function respondToReschedule(userId, doctorId, requestId, decision, context = {}) {
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const request = await tx.rescheduleRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError(404, 'RESCHEDULE_REQUEST_NOT_FOUND', 'Reschedule request not found.');
    const booking = await lockBooking(tx, request.bookingId);
    if (booking.doctorId !== doctorId) throw new AppError(404, 'RESCHEDULE_REQUEST_NOT_FOUND', 'Reschedule request not found.');
    if (request.status !== 'PENDING') throw new AppError(409, 'RESCHEDULE_REQUEST_CHANGED', 'This request is no longer pending.');
    if (decision === 'REJECT') {
      const rejected = await tx.rescheduleRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', respondedAt: new Date() } });
      await enqueueBookingEvent(tx, booking, booking.doctor, 'RESCHEDULE_REJECTED', {}, ['CLIENT'], request.id);
      await recordAudit({ actorId: userId, action: 'RESCHEDULE_REJECTED', entityType: 'RescheduleRequest', entityId: request.id, ipAddress: contextIp(context) }, tx);
      return { request: rejected, booking };
    }
    const updated = await applyReschedule(tx, booking, request.proposedStartTime, userId, 'RESCHEDULE_APPROVED', context, request.id);
    const approved = await tx.rescheduleRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', respondedAt: new Date() } });
    return { request: approved, booking: updated };
  }, { timeout: env.BOOKING_TRANSACTION_TIMEOUT_MS, maxWait: 5000, retryOnTimeout: true });
}

export async function rescheduleDoctorSession(userId, doctorId, bookingId, input, context = {}) {
  return serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const booking = await lockBooking(tx, bookingId);
    if (booking.doctorId !== doctorId) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    return applyReschedule(tx, booking, input.startTime, userId, 'DOCTOR_RESCHEDULED', context);
  }, { timeout: env.BOOKING_TRANSACTION_TIMEOUT_MS, maxWait: 5000, retryOnTimeout: true });
}

export async function listClientBookings(userId, { page, limit, status }) {
  const where = { clientId: userId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: {
        id: true, doctorId: true, startTime: true, endTime: true, sessionDurationMinutes: true, status: true,
        cancelledAt: true, cancelledBy: true, cancellationReason: true, rescheduleCount: true,
        doctor: { select: { firstName: true, lastName: true, professionalCategory: true, preferredSessionLanguage: true } },
        payment: { select: { amount: true, currency: true, status: true } },
        refund: { select: { amount: true, currency: true, status: true, completedAt: true } },
        rescheduleRequests: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { startTime: 'desc' }, skip: (page - 1) * limit, take: limit
    }),
    prisma.booking.count({ where })
  ]);
  return { items: jsonSafe(items), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getClientBooking(userId, bookingId) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, clientId: userId }, include: lifecycleInclude });
  if (!booking) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  return jsonSafe(booking);
}
