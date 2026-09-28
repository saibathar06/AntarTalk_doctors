import { z } from 'zod';
import { isoDateTime, uuid } from './common.js';

const attendee = {
  clientName: z.string().trim().min(1).max(200).optional(),
  clientAge: z.number().int().min(1).max(120).optional()
};

export const availabilityQuerySchema = z.object({ query: z.object({
  doctorId: uuid,
  from: isoDateTime,
  to: isoDateTime
}).refine((value) => value.from < value.to, { message: 'to must be after from', path: ['to'] }) });

export const reserveSchema = z.object({ body: z.object({
  doctorId: uuid,
  startTime: isoDateTime
}) });

export const confirmSchema = z.object({
  headers: z.object({ 'idempotency-key': z.string().min(8).max(128) }).passthrough(),
  body: z.object({ reservationId: uuid, doctorId: uuid, startTime: isoDateTime, paymentId: uuid, ...attendee })
});

export const razorpayOrderSchema = z.object({ body: z.object({
  reservationId: uuid,
  doctorId: uuid,
  startTime: isoDateTime
}).strict() });

export const razorpayVerifySchema = z.object({
  headers: z.object({ 'idempotency-key': z.string().min(8).max(128) }).passthrough(),
  body: z.object({
    reservationId: uuid,
    doctorId: uuid,
    startTime: isoDateTime,
    paymentId: uuid,
    razorpayOrderId: z.string().trim().min(3).max(200),
    razorpayPaymentId: z.string().trim().min(3).max(200),
    razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
    ...attendee
  }).strict()
});
