import { scheduling } from '../config/constants.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { prisma } from '../lib/prisma.js';
import { stableHash } from '../utils/crypto.js';
import { assertStructurallyBookable, deleteReservationIfOwned, readOwnedReservation } from './slot.service.js';
import { serialTransaction, lockUser, lockDoctor } from './transaction.service.js';
import { validatePayment } from './payment.service.js';
import { enqueueBookingNotifications } from './notification.service.js';

const bookingSelect = {
  id: true, doctorId: true, clientId: true, startTime: true, endTime: true,
  sessionDurationMinutes: true, bufferDurationMinutes: true, status: true, paymentId: true, createdAt: true,
  clientName: true, clientAge: true
};

export async function confirmBooking(clientId, input, idempotencyKey, context = {}) {
  const requestHash = stableHash({ ...input, startTime: input.startTime.toISOString() });
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { userId_scope_key: { userId: clientId, scope: 'BOOKING_CONFIRM', key: idempotencyKey } }
  });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request.');
    return existing.responseBody;
  }

  let reservation;
  try {
    reservation = await readOwnedReservation(clientId, input);
  } catch (error) {
    if (!context.allowCapturedPaymentRecovery) throw error;
  }
  let booking;
  try {
    booking = await serialTransaction(async (tx) => {
      const user = await lockUser(tx, clientId);
      if (user.role !== 'CLIENT' || !user.emailVerifiedAt) throw new AppError(403, 'FORBIDDEN', 'Verified client account required.');
      const replay = await tx.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId: clientId, scope: 'BOOKING_CONFIRM', key: idempotencyKey } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used for another request.');
        return replay.responseBody;
      }
      await lockDoctor(tx, input.doctorId);
      const doctor = await tx.doctorProfile.findUnique({
        where: { id: input.doctorId },
        select: { userId: true, firstName: true, lastName: true }
      });
      if (!doctor) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
      try {
        reservation = await readOwnedReservation(clientId, input);
      } catch (error) {
        if (!context.allowCapturedPaymentRecovery) throw error;
        reservation = null;
      }
      const slot = await assertStructurallyBookable(input.doctorId, input.startTime, tx);
      if (reservation && reservation.value.endTime !== slot.endTime.toISOString()) throw new AppError(409, 'SLOT_UNAVAILABLE', 'The appointment window changed.');
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.paymentId}::uuid FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { booking: { select: { id: true } } } });
      validatePayment(payment, clientId, slot);
      const created = await tx.booking.create({
        data: {
          doctorId: input.doctorId,
          clientId,
          clientName: input.clientName,
          clientAge: input.clientAge,
          startTime: slot.startTime,
          endTime: slot.endTime,
          sessionDurationMinutes: scheduling.sessionDurationMinutes,
          bufferDurationMinutes: scheduling.bufferDurationMinutes,
          status: 'CONFIRMED',
          paymentId: input.paymentId,
          reservationExpiresAt: reservation ? new Date(reservation.value.expiresAt) : null
        },
        select: bookingSelect
      });
      await tx.idempotencyRecord.create({ data: {
        userId: clientId, scope: 'BOOKING_CONFIRM', key: idempotencyKey, requestHash,
        responseCode: 201, responseBody: JSON.parse(JSON.stringify(created)), resourceId: created.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000)
      } });
      // Durable work is queued in the same transaction as the booking.
      await tx.bookingEmail.createMany({ data: ['CLIENT', 'DOCTOR'].map((audience) => ({ bookingId: created.id, audience })) });
      await enqueueBookingNotifications(tx, created, doctor);
      await tx.videoCall.create({ data: {
        bookingId: created.id,
        opensAt: new Date(created.startTime.getTime() - env.JOIN_EARLY_MINUTES * 60_000),
        closesAt: new Date(created.startTime.getTime() + created.sessionDurationMinutes * 60_000)
      } });
      return created;
    }, { timeout: env.BOOKING_TRANSACTION_TIMEOUT_MS, maxWait: 5000, retryOnTimeout: true });
  } catch (error) {
    if (['P2002', 'P2004', 'P2034'].includes(error.code) || String(error.message).includes('Booking_doctor_no_overlap')) {
      const replay = await prisma.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId: clientId, scope: 'BOOKING_CONFIRM', key: idempotencyKey } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used for another request.');
        return replay.responseBody;
      }
    }
    if (String(error.message).includes('RESERVATION_EXPIRED')) throw new AppError(409, 'RESERVATION_EXPIRED', 'The temporary reservation has expired.');
    if (error.code === 'P2028') throw new AppError(503, 'BOOKING_CONFIRMATION_RETRY_REQUIRED', 'Payment was received, but booking confirmation is still pending. Retry confirmation with the same idempotency key.');
    if (error.code === 'P2002' || error.code === 'P2004' || String(error.message).includes('Booking_doctor_no_overlap') || String(error.message).includes('Booking_client_no_overlap')) {
      throw new AppError(409, 'SLOT_ALREADY_BOOKED', 'This appointment window has already been booked.');
    }
    throw error;
  }
  // Committed booking remains a success if cleanup fails; Redis TTL cleans up the hold.
  if (reservation) await deleteReservationIfOwned(reservation.key, reservation.raw).catch(() => {});
  return booking;
}
