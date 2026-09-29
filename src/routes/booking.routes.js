import { Router } from 'express';
import { authenticateUser, requireClient } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { confirmBooking } from '../services/booking.service.js';
import { createRazorpayOrder, verifyRazorpayPayment } from '../services/razorpay.service.js';
import { getBookableDoctor, readBookableDoctorPhoto, searchBookableDoctors } from '../services/bookingDiscovery.service.js';
import { getAvailableSlots, reserveSlot } from '../services/slot.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  availabilityQuerySchema, cancelBookingSchema, cancelRescheduleSchema, clientBookingListSchema, confirmSchema,
  doctorSearchSchema, razorpayOrderSchema, razorpayVerifySchema, requestRescheduleSchema, reserveSchema
} from '../validation/booking.schemas.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { createVideoTicket } from '../services/video.service.js';
import * as lifecycle from '../services/bookingLifecycle.service.js';
import { z } from 'zod';
import { uuid } from '../validation/common.js';

export const bookingRouter = Router();

const doctorIdSchema = z.object({ params: z.object({ doctorId: uuid }) });

bookingRouter.get('/doctors/search', validate(doctorSearchSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await searchBookableDoctors(req.query) });
}));

bookingRouter.get('/doctors/:doctorId', validate(doctorIdSchema), asyncHandler(async (req, res) => {
  const data = await getBookableDoctor(req.params.doctorId);
  res.json({ success: true, data });
}));

bookingRouter.get('/doctors/:doctorId/photo', validate(doctorIdSchema), asyncHandler(async (req, res) => {
  const file = await readBookableDoctorPhoto(req.params.doctorId);
  res.set('Cache-Control', 'private, max-age=300');
  if (Buffer.isBuffer(file)) return res.type('image/jpeg').send(file);
  res.sendFile(file, { dotfiles: 'deny' }, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ success: false, error: { code: 'PROFILE_PHOTO_NOT_FOUND', message: 'Profile photo not found.' } });
    }
  });
}));

bookingRouter.get('/availability', validate(availabilityQuerySchema), asyncHandler(async (req, res) => {
  const data = await getAvailableSlots(req.query);
  res.json({ success: true, data });
}));

bookingRouter.post('/reserve', authenticateUser, requireClient, sensitiveLimiter, validate(reserveSchema), asyncHandler(async (req, res) => {
  const data = await reserveSlot(req.user.id, req.body.doctorId, req.body.startTime);
  res.status(201).json({ success: true, data });
}));

bookingRouter.post('/confirm', authenticateUser, requireClient, sensitiveLimiter, validate(confirmSchema), asyncHandler(async (req, res) => {
  const data = await confirmBooking(req.user.id, req.body, req.headers['idempotency-key']);
  res.status(201).json({ success: true, data });
}));

bookingRouter.get('/mine', authenticateUser, requireClient, validate(clientBookingListSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lifecycle.listClientBookings(req.user.id, req.query) });
}));

bookingRouter.get('/:bookingId', authenticateUser, requireClient, validate(z.object({ params: z.object({ bookingId: uuid }) })), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lifecycle.getClientBooking(req.user.id, req.params.bookingId) });
}));

bookingRouter.post('/:bookingId/cancel', authenticateUser, requireClient, sensitiveLimiter, validate(cancelBookingSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lifecycle.cancelClientSession(req.user.id, req.params.bookingId, req.body.reason, { ip: req.ip }) });
}));

bookingRouter.post('/:bookingId/reschedule-requests', authenticateUser, requireClient, sensitiveLimiter, validate(requestRescheduleSchema), asyncHandler(async (req, res) => {
  const data = await lifecycle.requestClientReschedule(req.user.id, req.params.bookingId, req.body, { ip: req.ip });
  res.status(201).json({ success: true, data });
}));

bookingRouter.delete('/:bookingId/reschedule-requests/:requestId', authenticateUser, requireClient, sensitiveLimiter, validate(cancelRescheduleSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lifecycle.cancelClientReschedule(req.user.id, req.params.bookingId, req.params.requestId, { ip: req.ip }) });
}));

bookingRouter.post('/:bookingId/join', authenticateUser, requireClient, sensitiveLimiter, validate(z.object({
  params: z.object({ bookingId: uuid }),
  body: z.object({ surface: z.enum(['WEB', 'MOBILE']).default('WEB') }).default({ surface: 'WEB' })
})), asyncHandler(async (req, res) => {
  const data = await createVideoTicket({ bookingId: req.params.bookingId, userId: req.user.id, audience: 'CLIENT', surface: req.body.surface });
  res.json({ success: true, data });
}));

bookingRouter.post('/razorpay/order', authenticateUser, requireClient, sensitiveLimiter, validate(razorpayOrderSchema), asyncHandler(async (req, res) => {
  const data = await createRazorpayOrder(req.user.id, req.body);
  res.status(201).json({ success: true, data });
}));

bookingRouter.post('/razorpay/verify', authenticateUser, requireClient, sensitiveLimiter, validate(razorpayVerifySchema), asyncHandler(async (req, res) => {
  const data = await verifyRazorpayPayment(req.user.id, req.body, req.headers['idempotency-key']);
  res.status(201).json({ success: true, data });
}));
