import { Router } from 'express';
import { authenticateUser, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pagination, uuid } from '../validation/common.js';
import { z } from 'zod';
import * as verification from '../services/adminVerification.service.js';
import { readAdminLicenseDocument } from '../services/upload.service.js';

export const adminRouter = Router();
adminRouter.use(authenticateUser, requireRole('ADMIN'));
adminRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const reviewId = z.object({ params: z.object({ id: uuid }) });
const decision = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ status: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().trim().min(3).max(500).optional(), expectedUpdatedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)) }).strict().superRefine((body, ctx) => {
    if (body.status === 'REJECTED' && !body.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A clear rejection reason is required.' });
  })
});
adminRouter.get('/verification-requests', validate(z.object({ query: z.object({ ...pagination }) })), asyncHandler(async (req, res) => res.json({ success: true, data: await verification.listVerificationQueue(req.query) })));
adminRouter.get('/verification-requests/:id', validate(reviewId), asyncHandler(async (req, res) => res.json({ success: true, data: await verification.getVerificationReview(req.params.id) })));
adminRouter.patch('/doctors/:id/verification', validate(decision), asyncHandler(async (req, res) => res.json({ success: true, data: await verification.decideVerification(req.user.id, req.params.id, req.body, { ip: req.ip }) })));
adminRouter.get('/doctors/:id/license-document', validate(reviewId), asyncHandler(async (req, res) => {
  const file = await readAdminLicenseDocument(req.params.id);
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.sendFile(file, { dotfiles: 'deny', headers: { 'Content-Disposition': 'attachment' } }, (error) => { if (error && !res.headersSent) res.status(404).json({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'Credential document not found.' } }); });
}));
