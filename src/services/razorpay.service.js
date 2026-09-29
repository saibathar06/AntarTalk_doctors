import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { safeEqual } from '../utils/crypto.js';
import { assertStructurallyBookable, readOwnedReservation } from './slot.service.js';
import { confirmBooking } from './booking.service.js';
import { clientBookingIdentity } from './clientIdentity.service.js';

const apiBase = 'https://api.razorpay.com/v1';

function assertConfigured() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Online payments are not configured yet.');
  }
}

function toPaise(value) {
  const amount = Number(value);
  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || paise < 100) {
    throw new AppError(422, 'INVALID_CONSULTATION_FEE', 'This professional does not have a valid consultation fee.');
  }
  return paise;
}

function moneyFromPaise(paise) {
  return (paise / 100).toFixed(2);
}

function authHeader() {
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

async function razorpayRequest(path, options = {}) {
  const response = await globalThis.fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    signal: globalThis.AbortSignal.timeout(15_000)
  }).catch((error) => {
    logger.warn({ errorCode: error?.name ?? 'NETWORK_ERROR' }, 'Razorpay request failed');
    throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment provider is temporarily unavailable.');
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    logger.warn({ status: response.status, providerError: body?.error?.code }, 'Razorpay rejected a payment request');
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment provider could not process this request.');
  }
  return body;
}

function verifySignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

export async function createRazorpayOrder(clientId, input) {
  assertConfigured();
  const client = await prisma.user.findUnique({
    where: { id: clientId },
    select: { firstName: true, lastName: true, dateOfBirth: true }
  });
  clientBookingIdentity(client, input.startTime);
  const reservation = await readOwnedReservation(clientId, input);
  const slot = await assertStructurallyBookable(input.doctorId, input.startTime);
  if (reservation.value.endTime !== slot.endTime.toISOString()) {
    throw new AppError(409, 'SLOT_UNAVAILABLE', 'The appointment window changed. Choose another slot.');
  }
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: input.doctorId },
    select: { consultationFee: true, firstName: true, lastName: true }
  });
  const amountPaise = toPaise(doctor?.consultationFee);
  const doctorEarningPaise = Math.round(amountPaise * (1 - env.PLATFORM_COMMISSION_PERCENT / 100));
  const payment = await prisma.payment.create({
    data: {
      clientId,
      doctorId: input.doctorId,
      slotStart: slot.startTime,
      slotEnd: slot.endTime,
      expectedAmount: moneyFromPaise(amountPaise),
      expectedCurrency: env.RAZORPAY_CURRENCY,
      doctorEarning: moneyFromPaise(doctorEarningPaise),
      amount: moneyFromPaise(amountPaise),
      currency: env.RAZORPAY_CURRENCY,
      status: 'PENDING',
      provider: 'RAZORPAY',
      providerReference: `pending_${crypto.randomUUID()}`
    }
  });
  let order;
  try {
    order = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountPaise,
        currency: env.RAZORPAY_CURRENCY,
        receipt: `atk_${payment.id.replaceAll('-', '')}`,
        notes: { antartalkPaymentId: payment.id }
      })
    });
  } catch (error) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } }).catch(() => {});
    throw error;
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { providerReference: order.id } });
  return {
    paymentId: payment.id,
    keyId: env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amount: amountPaise,
    currency: env.RAZORPAY_CURRENCY,
    doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}` : 'AntarTalk professional',
    expiresAt: reservation.value.expiresAt
  };
}

export async function verifyRazorpayPayment(clientId, input, idempotencyKey) {
  assertConfigured();
  const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment || payment.clientId !== clientId || payment.provider !== 'RAZORPAY' || payment.providerReference !== input.razorpayOrderId) {
    throw new AppError(422, 'PAYMENT_ORDER_MISMATCH', 'The payment does not match this booking request.');
  }
  if (!verifySignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
    throw new AppError(422, 'PAYMENT_SIGNATURE_INVALID', 'The payment verification signature is invalid.');
  }
  const providerPayment = await razorpayRequest(`/payments/${encodeURIComponent(input.razorpayPaymentId)}`, { method: 'GET' });
  if (providerPayment.order_id !== payment.providerReference || providerPayment.status !== 'captured' ||
      providerPayment.currency !== payment.expectedCurrency || providerPayment.amount !== toPaise(payment.expectedAmount)) {
    throw new AppError(422, 'PAYMENT_NOT_CONFIRMED', 'Payment has not been captured for this appointment.');
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'SUCCEEDED', providerPaymentId: providerPayment.id, amount: moneyFromPaise(providerPayment.amount) }
  });
  return confirmBooking(clientId, {
    reservationId: input.reservationId,
    doctorId: input.doctorId,
    startTime: input.startTime,
    paymentId: payment.id,
  }, idempotencyKey, { allowCapturedPaymentRecovery: true });
}

export async function handleRazorpayWebhook(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook processing is not configured.');
  if (!signature) throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (!safeEqual(expected, signature)) throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError(400, 'INVALID_JSON', 'Malformed webhook payload.'); }
  if (event.event === 'refund.processed') {
    const refund = event.payload?.refund?.entity;
    if (refund?.id && refund?.payment_id) {
      await prisma.$transaction(async (tx) => {
        const record = await tx.refundTransaction.findFirst({ where: { payment: { providerPaymentId: refund.payment_id } }, include: { payment: true } });
        if (!record || Number(refund.amount) !== toPaise(record.amount)) return;
        await tx.refundTransaction.update({ where: { id: record.id }, data: { status: 'COMPLETED', providerReference: refund.id, completedAt: new Date(), lastErrorCode: null } });
        await tx.payment.update({ where: { id: record.paymentId }, data: { status: 'REFUNDED' } });
      });
    }
    return { received: true };
  }
  if (event.event !== 'payment.captured') return { received: true };
  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id || !entity?.id || entity.status !== 'captured') return { received: true };
  await prisma.payment.updateMany({
    where: { provider: 'RAZORPAY', providerReference: entity.order_id, status: 'PENDING' },
    data: { status: 'SUCCEEDED', providerPaymentId: entity.id, amount: moneyFromPaise(entity.amount) }
  });
  return { received: true };
}

async function completeRefund(recordId, paymentId, providerReference, db = prisma) {
  await db.$transaction([
    db.refundTransaction.update({ where: { id: recordId }, data: { status: 'COMPLETED', providerReference, completedAt: new Date(), lastErrorCode: null } }),
    db.payment.update({ where: { id: paymentId }, data: { status: 'REFUNDED' } })
  ]);
}

export async function processRazorpayRefunds(db = prisma) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return;
  const jobs = await db.refundTransaction.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } },
    include: { payment: true }, take: 20, orderBy: { nextAttemptAt: 'asc' }
  });
  for (const job of jobs) {
    const claimed = await db.refundTransaction.updateMany({
      where: { id: job.id, status: job.status, attempts: job.attempts, nextAttemptAt: { lte: new Date() } },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) }
    });
    if (!claimed.count) continue;
    try {
      if (!job.payment.providerPaymentId || job.payment.provider !== 'RAZORPAY') throw new AppError(422, 'REFUND_PAYMENT_INVALID', 'The original payment cannot be refunded automatically.');
      if (job.providerReference) {
        const providerRefund = await razorpayRequest(`/refunds/${encodeURIComponent(job.providerReference)}`, { method: 'GET' });
        if (providerRefund.status === 'processed') {
          await completeRefund(job.id, job.paymentId, providerRefund.id, db);
          continue;
        }
        if (providerRefund.status === 'failed') throw new AppError(502, 'REFUND_PROVIDER_FAILED', 'The payment provider rejected the refund.');
        await db.refundTransaction.update({ where: { id: job.id }, data: { status: 'PROCESSING', nextAttemptAt: new Date(Date.now() + 60_000), lastErrorCode: null } });
        continue;
      }
      // Reconcile before creating. This makes a retry safe if the previous HTTP
      // response was lost after Razorpay accepted the refund.
      const providerPayment = await razorpayRequest(`/payments/${encodeURIComponent(job.payment.providerPaymentId)}`, { method: 'GET' });
      if (Number(providerPayment.amount_refunded ?? 0) >= toPaise(job.amount)) {
        await completeRefund(job.id, job.paymentId, `reconciled_${job.payment.providerPaymentId}`, db);
        continue;
      }
      const providerRefund = await razorpayRequest(`/payments/${encodeURIComponent(job.payment.providerPaymentId)}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amount: toPaise(job.amount), notes: { antartalkBookingId: job.bookingId, antartalkRefundId: job.id } })
      });
      if (!providerRefund?.id || providerRefund.payment_id !== job.payment.providerPaymentId || Number(providerRefund.amount) !== toPaise(job.amount)) {
        throw new AppError(502, 'REFUND_PROVIDER_INVALID_RESPONSE', 'The payment provider returned an invalid refund response.');
      }
      if (providerRefund.status === 'processed') await completeRefund(job.id, job.paymentId, providerRefund.id, db);
      else await db.refundTransaction.update({ where: { id: job.id }, data: { status: 'PROCESSING', providerReference: providerRefund.id, nextAttemptAt: new Date(Date.now() + 60_000), lastErrorCode: null } });
    } catch (error) {
      await db.refundTransaction.update({ where: { id: job.id }, data: {
        status: 'FAILED', lastErrorCode: error.code ?? 'REFUND_ERROR',
        nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** job.attempts))
      } });
      logger.warn({ refundId: job.id, attempt: job.attempts + 1, errorCode: error.code ?? 'REFUND_ERROR' }, 'Razorpay refund attempt failed');
    }
  }
}
