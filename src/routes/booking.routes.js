import { Router } from 'express';
import { authenticateUser, requireClient } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { confirmBooking } from '../services/booking.service.js';
import { getBookableDoctor, readBookableDoctorPhoto } from '../services/bookingDiscovery.service.js';
import { getAvailableSlots, reserveSlot } from '../services/slot.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { availabilityQuerySchema, confirmSchema, reserveSchema } from '../validation/booking.schemas.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { z } from 'zod';
import { uuid } from '../validation/common.js';

export const bookingRouter = Router();

const doctorIdSchema = z.object({ params: z.object({ doctorId: uuid }) });

bookingRouter.get('/doctors/:doctorId', validate(doctorIdSchema), asyncHandler(async (req, res) => {
  const data = await getBookableDoctor(req.params.doctorId);
  res.json({ success: true, data });
}));

bookingRouter.get('/doctors/:doctorId/photo', validate(doctorIdSchema), asyncHandler(async (req, res) => {
  const file = await readBookableDoctorPhoto(req.params.doctorId);
  res.set('Cache-Control', 'private, max-age=300');
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
