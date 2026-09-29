import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { deviceIdSchema, notificationIdSchema, notificationListSchema, registerDeviceSchema } from '../validation/notification.schemas.js';
import * as notifications from '../services/notification.service.js';

export const notificationRouter = Router();
notificationRouter.use(authenticateUser, sensitiveLimiter);
notificationRouter.post('/devices', validate(registerDeviceSchema), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await notifications.registerDevice(req.user.id, req.body) })));
notificationRouter.delete('/devices/:id', validate(deviceIdSchema), asyncHandler(async (req, res) => {
  await notifications.unregisterDevice(req.user.id, req.params.id);
  res.json({ success: true, data: { removed: true } });
}));
notificationRouter.get('/', validate(notificationListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await notifications.listNotifications(req.user.id, req.query) })));
notificationRouter.patch('/:id/read', validate(notificationIdSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await notifications.markRead(req.user.id, req.params.id) })));
