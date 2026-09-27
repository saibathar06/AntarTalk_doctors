import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { safeEqual } from '../utils/crypto.js';
import { assertStructurallyBookable, readOwnedReservation } from './slot.service.js';
import { confirmBooking } from './booking.service.js';

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
    paymentId: payment.id
  }, idempotencyKey);
}

export async function handleRazorpayWebhook(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook processing is not configured.');
  if (!signature) throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (!safeEqual(expected, signature)) throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError(400, 'INVALID_JSON', 'Malformed webhook payload.'); }
  if (event.event !== 'payment.captured') return { received: true };
  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id || !entity?.id || entity.status !== 'captured') return { received: true };
  await prisma.payment.updateMany({
    where: { provider: 'RAZORPAY', providerReference: entity.order_id, status: 'PENDING' },
    data: { status: 'SUCCEEDED', providerPaymentId: entity.id, amount: moneyFromPaise(entity.amount) }
  });
  return { received: true };
}
