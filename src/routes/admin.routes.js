import { Router } from 'express';
import { authenticateUser, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { serialTransaction, lockUser, lockDoctor } from '../services/transaction.service.js';
import { recordAudit } from '../services/audit.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verificationSchema } from '../validation/admin.schemas.js';

export const adminRouter = Router();
adminRouter.use(authenticateUser, requireRole('ADMIN'));

adminRouter.patch('/doctors/:id/verification', validate(verificationSchema), asyncHandler(async (req, res) => {
  const profile = await serialTransaction(async (tx) => {
    const actor = await lockUser(tx, req.user.id);
    if (actor.role !== 'ADMIN') throw new Error('Admin role changed');
    await lockDoctor(tx, req.params.id);
    const updated = await tx.doctorProfile.update({
      where: { id: req.params.id },
      data: { verificationStatus: req.body.status, ...(req.body.status !== 'VERIFIED' ? { isAcceptingBookings: false } : {}) }
    });
    await recordAudit({ actorId: req.user.id, action: `DOCTOR_${req.body.status}`, entityType: 'DoctorProfile', entityId: updated.id, metadata: { reason: req.body.reason }, ipAddress: req.ip }, tx);
    return updated;
  });
  res.json({ success: true, data: profile });
}));
