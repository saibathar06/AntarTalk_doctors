import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { serialTransaction, lockDoctor } from './transaction.service.js';

// Internal integration boundary only. No public route can complete a booking,
// invoke this workflow, or choose the earning amount.
export async function settleCompletedBooking(bookingId) {
  return serialTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
    if (!booking) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    await lockDoctor(tx, booking.doctorId);
    if (booking.status !== 'COMPLETED' || booking.payment?.status !== 'SUCCEEDED' || !booking.payment.doctorEarning?.greaterThan(0)) {
      throw new AppError(409, 'EARNING_NOT_SETTLEABLE', 'A completed booking and trusted earning amount are required.');
    }
    return tx.earning.upsert({
      where: { bookingId },
      create: { doctorId: booking.doctorId, bookingId, amount: booking.payment.doctorEarning, currency: booking.payment.currency, status: 'AVAILABLE' },
      update: {}
    });
  });
}

// Full reversals only. Partial-refund allocation is intentionally not invented.
export async function reverseRefundedEarning(earningId) {
  return serialTransaction(async (tx) => {
    const earning = await tx.earning.findUnique({ where: { id: earningId }, include: { booking: { include: { payment: true } } } });
    if (!earning) throw new AppError(404, 'EARNING_NOT_FOUND', 'Earning not found.');
    await lockDoctor(tx, earning.doctorId);
    if (earning.booking.payment?.status !== 'REFUNDED' || earning.status !== 'AVAILABLE') {
      throw new AppError(409, 'EARNING_NOT_REVERSIBLE', 'A refunded payment and available earning are required.');
    }
    return tx.earningReversal.upsert({ where: { earningId }, create: { earningId, amount: earning.amount }, update: {} });
  });
}

/** @param {string} doctorId
 * @param {string} currency
 * @param {import('@prisma/client').Prisma.TransactionClient} tx */
export async function reversedAmount(doctorId, currency, tx = prisma) {
  return tx.earningReversal.aggregate({ where: { earning: { doctorId, currency, status: 'AVAILABLE' } }, _sum: { amount: true } });
}
