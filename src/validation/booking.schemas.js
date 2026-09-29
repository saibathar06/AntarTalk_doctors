import { z } from 'zod';
import { isoDateTime, pagination, uuid } from './common.js';

const attendee = {
  clientName: z.string().trim().min(1).max(200).optional(),
  clientAge: z.number().int().min(1).max(120).optional()
};

export const availabilityQuerySchema = z.object({ query: z.object({
  doctorId: uuid,
  from: isoDateTime,
  to: isoDateTime
}).refine((value) => value.from < value.to, { message: 'to must be after from', path: ['to'] }) });

export const doctorSearchSchema = z.object({ query: z.object({
  date: z.string().date(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  professionalCategory: z.enum(['PSYCHIATRIST', 'PSYCHOLOGIST', 'COUNSELLOR']).optional(),
  language: z.string().trim().min(1).max(80).optional(),
  gender: z.enum(['FEMALE', 'MALE', 'NON_BINARY', 'OTHER']).optional(),
  minimumFee: z.coerce.number().nonnegative().max(1000000).optional(),
  maximumFee: z.coerce.number().positive().max(1000000).optional(),
  ...pagination
}).refine((value) => value.minimumFee === undefined || value.maximumFee === undefined || value.minimumFee <= value.maximumFee, {
  message: 'minimumFee cannot exceed maximumFee', path: ['maximumFee']
}) });

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
