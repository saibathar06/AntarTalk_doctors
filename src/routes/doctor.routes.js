import { Router } from 'express';
import { authenticateUser, requireDoctor, requireVerifiedDoctor } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as availability from '../services/availability.service.js';
import * as doctor from '../services/doctor.service.js';
import * as payouts from '../services/payout.service.js';
import * as sessions from '../services/session.service.js';
import * as lifecycle from '../services/bookingLifecycle.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  blockedIdSchema, changePasswordSchema, createBlockedSlotSchema, payoutAccountSchema, payoutListSchema,
  defaultTimingSchema, doctorRescheduleSchema, doctorSessionActionSchema, presetsSchema, replaceHoursSchema,
  rescheduleRequestListSchema, respondRescheduleSchema, sessionListSchema, updateProfileSchema, withdrawSchema
} from '../validation/doctor.schemas.js';
import { z } from 'zod';
import { uuid } from '../validation/common.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import multer from 'multer';
import * as workspace from '../services/doctorWorkspace.service.js';
import { saveUpload, readUpload } from '../services/upload.service.js';
import { pagination } from '../validation/common.js';
import { changePassword } from '../services/auth.service.js';

export const doctorRouter = Router();
doctorRouter.use(authenticateUser, requireDoctor, sensitiveLimiter);
doctorRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
doctorRouter.get('/profile', asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.getProfile(req.user.id) })));
doctorRouter.patch('/profile', validate(updateProfileSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.updateProfile(req.user.id, req.body, { ip: req.ip }) })));
doctorRouter.post('/profile/photo', upload.single('file'), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await saveUpload(req.user.id, req.user.doctorProfile.id, req.file) })));
doctorRouter.post('/profile/documents', upload.single('file'), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await saveUpload(req.user.id, req.user.doctorProfile.id, req.file, true) })));
doctorRouter.get('/files/:filename', validate(z.object({ params: z.object({ filename: z.string().regex(/^[a-f0-9-]{36}\.(jpg|pdf)$/) }) })), asyncHandler(async (req, res) => {
  const file = await readUpload(req.user.id, req.params.filename);
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (Buffer.isBuffer(file)) return res.type('image/jpeg').send(file);
  res.sendFile(file, { dotfiles: 'deny', headers: { 'Content-Disposition': req.params.filename.endsWith('.pdf') ? 'attachment' : 'inline' } }, (error) => { if (error && !res.headersSent) res.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found.' } }); });
}));
doctorRouter.get('/dashboard', asyncHandler(async (req, res) => res.json({ success: true, data: await workspace.dashboard(req.user.doctorProfile.id) })));
doctorRouter.get('/appointments', requireVerifiedDoctor, validate(z.object({ query: z.object({ ...pagination, filter: z.enum(['upcoming', 'today', 'past', 'completed', 'cancelled']).default('upcoming'), date: z.string().date().optional() }) })), asyncHandler(async (req, res) => res.json({ success: true, data: await workspace.appointments(req.user.doctorProfile.id, req.query) })));
doctorRouter.get('/clients', requireVerifiedDoctor, validate(payoutListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await workspace.clients(req.user.doctorProfile.id, req.query) })));

doctorRouter.get('/me', asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.getProfile(req.user.id) })));
doctorRouter.patch('/me', validate(updateProfileSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.updateProfile(req.user.id, req.body, { ip: req.ip }) })));
doctorRouter.post('/verification/submit', asyncHandler(async (req, res) => res.json({ success: true, data: await doctor.submitVerification(req.user.id, { ip: req.ip }) })));
doctorRouter.post('/change-password', validate(changePasswordSchema), asyncHandler(async (req, res) => {
  await changePassword(req.user.id, req.body, { ip: req.ip });
  res.json({ success: true, data: { changed: true } });
}));

doctorRouter.get('/availability', requireVerifiedDoctor, asyncHandler(async (req, res) => res.json({ success: true, data: await availability.getWorkingHours(req.user.doctorProfile.id) })));
doctorRouter.get('/availability/slots', requireVerifiedDoctor, validate(z.object({ query: z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((value) => value.from < value.to, { path: ['to'], message: 'to must be after from' }) })), asyncHandler(async (req, res) => res.json({ success: true, data: await availability.previewAvailableSlots(req.user.doctorProfile.id, req.query.from, req.query.to) })));
doctorRouter.get('/availability/default-timing', requireVerifiedDoctor, asyncHandler(async (req, res) => res.json({ success: true, data: await availability.readDefaultTiming(req.user.doctorProfile.id) })));
doctorRouter.put('/availability/default-timing', requireVerifiedDoctor, validate(defaultTimingSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await availability.saveDefaultTiming(req.user.id, req.user.doctorProfile.id, req.body.timing) })));

doctorRouter.get('/availability/presets', requireVerifiedDoctor, asyncHandler(async (req, res) => res.json({ success: true, data: await availability.getPresets(req.user.doctorProfile.id) })));
doctorRouter.put('/availability/presets', requireVerifiedDoctor, validate(presetsSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await availability.savePresets(req.user.id, req.user.doctorProfile.id, req.body.presets) })));
doctorRouter.put('/availability', requireVerifiedDoctor, validate(replaceHoursSchema), asyncHandler(async (req, res) => {
  const data = await availability.replaceWorkingHours(req.user.id, req.user.doctorProfile.id, req.body, { ip: req.ip });
  res.json({ success: true, data });
}));
doctorRouter.get('/blocked-slots', requireVerifiedDoctor, asyncHandler(async (req, res) => res.json({ success: true, data: await availability.listBlockedSlots(req.user.doctorProfile.id) })));
doctorRouter.post('/blocked-slots', requireVerifiedDoctor, validate(createBlockedSlotSchema), asyncHandler(async (req, res) => {
  const data = await availability.createBlockedSlot(req.user.id, req.user.doctorProfile.id, req.body, { ip: req.ip });
  res.status(201).json({ success: true, data });
}));
doctorRouter.delete('/blocked-slots/:id', requireVerifiedDoctor, validate(blockedIdSchema), asyncHandler(async (req, res) => {
  await availability.deleteBlockedSlot(req.user.id, req.user.doctorProfile.id, req.params.id, { ip: req.ip });
  res.json({ success: true, data: { deleted: true } });
}));

doctorRouter.get('/sessions/upcoming', requireVerifiedDoctor, validate(sessionListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user.doctorProfile.id, { ...req.query, type: 'upcoming' }) })));
doctorRouter.get('/sessions/past', requireVerifiedDoctor, validate(sessionListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user.doctorProfile.id, { ...req.query, type: 'past' }) })));
doctorRouter.get('/sessions', requireVerifiedDoctor, validate(sessionListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.listSessions(req.user.doctorProfile.id, { ...req.query, type: 'all' }) })));
doctorRouter.post('/sessions/:id/join', requireVerifiedDoctor, validate(z.object({ params: z.object({ id: uuid }), body: z.object({ surface: z.enum(['WEB', 'MOBILE']).default('WEB') }).default({ surface: 'WEB' }) })), asyncHandler(async (req, res) => res.json({ success: true, data: await sessions.createJoinAccess(req.user.id, req.user.doctorProfile.id, req.params.id, req.body.surface) })));
doctorRouter.post('/sessions/:id/cancel', requireVerifiedDoctor, validate(doctorSessionActionSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await lifecycle.cancelDoctorSession(req.user.id, req.user.doctorProfile.id, req.params.id, req.body.reason, { ip: req.ip }) })));
doctorRouter.post('/sessions/:id/reschedule', requireVerifiedDoctor, validate(doctorRescheduleSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await lifecycle.rescheduleDoctorSession(req.user.id, req.user.doctorProfile.id, req.params.id, req.body, { ip: req.ip }) })));
doctorRouter.get('/reschedule-requests', requireVerifiedDoctor, validate(rescheduleRequestListSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await lifecycle.listDoctorRescheduleRequests(req.user.doctorProfile.id, req.query) })));
doctorRouter.post('/reschedule-requests/:id/respond', requireVerifiedDoctor, validate(respondRescheduleSchema), asyncHandler(async (req, res) => res.json({ success: true, data: await lifecycle.respondToReschedule(req.user.id, req.user.doctorProfile.id, req.params.id, req.body.decision, { ip: req.ip }) })));

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
