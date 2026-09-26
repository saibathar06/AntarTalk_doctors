import { Router } from 'express';
import { authenticateUser, requireDoctor, requireVerifiedDoctor } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as availability from '../services/availability.service.js';
import * as doctor from '../services/doctor.service.js';
import * as payouts from '../services/payout.service.js';
import * as sessions from '../services/session.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  blockedIdSchema, createBlockedSlotSchema, payoutAccountSchema, payoutListSchema,
  replaceHoursSchema, sessionListSchema, updateProfileSchema, withdrawSchema
} from '../validation/doctor.schemas.js';
import { z } from 'zod';
import { uuid } from '../validation/common.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';

export const doctorRouter = Router();
doctorRouter.use(authenticateUser, requireDoctor, sensitiveLimiter);

doctorRouter.get('/me', asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.getProfile(req.user.id) })));
doctorRouter.patch('/me', validate(updateProfileSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.updateProfile(req.user.id, req.body, { ip: req.ip }) })));

doctorRouter.get('/availability', asyncHandler(async (req, res) => res.json({ success: true, data: await availability.getWorkingHours(req.user.doctorProfile.id) })));
doctorRouter.put('/availability', validate(replaceHoursSchema), asyncHandler(async (req, res) => {
  const data = await availability.replaceWorkingHours(req.user.id, req.user.doctorProfile.id, req.body, { ip: req.ip });
  res.json({ success: true, data });
}));
doctorRouter.get('/blocked-slots', asyncHandler(async (req, res) => res.json({ success: true, data: await availability.listBlockedSlots(req.user.doctorProfile.id) })));
doctorRouter.post('/blocked-slots', validate(createBlockedSlotSchema), asyncHandler(async (req, res) => {
  const data = await availability.createBlockedSlot(req.user.id, req.user.doctorProfile.id, req.body, { ip: req.ip });
  res.status(201).json({ success: true, data });
}));
doctorRouter.delete('/blocked-slots/:id', validate(blockedIdSchema), asyncHandler(async (req, res) => {
  await availability.deleteBlockedSlot(req.user.id, req.user.doctorProfile.id, req.params.id, { ip: req.ip });
  res.json({ success: true, data: { deleted: true } });
}));

doctorRouter.get('/sessions/upcoming', requireVerifiedDoctor, validate(sessionListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user.doctorProfile.id, { ...req.query, type: 'upcoming' }) })));
doctorRouter.get('/sessions/past', requireVerifiedDoctor, validate(sessionListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user.doctorProfile.id, { ...req.query, type: 'past' }) })));
doctorRouter.get('/sessions', requireVerifiedDoctor, validate(sessionListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user.doctorProfile.id, { ...req.query, type: 'all' }) })));
doctorRouter.post('/sessions/:id/join', requireVerifiedDoctor, validate(z.object({ params: z.object({ id: uuid }) })), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.createJoinAccess(req.user.doctorProfile.id, req.params.id) })));

doctorRouter.get('/sessions/:id', requireVerifiedDoctor, validate(z.object({ params: z.object({ id: uuid }) })), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.getSession(req.user.doctorProfile.id, req.params.id) })));
doctorRouter.get('/earnings', requireVerifiedDoctor, asyncHandler(async (req, res) => res.json({ success: true, data: await payouts.earningsSummary(req.user.doctorProfile.id) })));
doctorRouter.get('/earnings/transactions', requireVerifiedDoctor, validate(payoutListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await payouts.earningTransactions(req.user.doctorProfile.id, req.query) })));
doctorRouter.get('/payouts', requireVerifiedDoctor, validate(payoutListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await payouts.listPayouts(req.user.doctorProfile.id, req.query) })));
doctorRouter.post('/payouts/withdraw', requireVerifiedDoctor, validate(withdrawSchema), asyncHandler(async (req, res) => {
  const data = await payouts.withdraw(req.user.id, req.user.doctorProfile.id, req.body, req.headers['idempotency-key'], { ip: req.ip });
  res.status(201).json({ success: true, data });
}));
doctorRouter.get('/payout-accounts', requireVerifiedDoctor, asyncHandler(async (req, res) => res.json({ success: true, data: await payouts.listPayoutAccounts(req.user.doctorProfile.id) })));
doctorRouter.post('/payout-accounts', requireVerifiedDoctor, validate(payoutAccountSchema), asyncHandler(async (req, res) => {
  const data = await payouts.createPayoutAccount(req.user.id, req.user.doctorProfile.id, req.body, { ip: req.ip });
  res.status(201).json({ success: true, data });
}));

doctorRouter.delete('/account', asyncHandler(async (req, res) => {
  await doctor.deleteAccount(req.user.id, { ip: req.ip });
  res.json({ success: true, data: { deleted: true } });
}));
