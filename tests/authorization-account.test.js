import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/lib/mailer.js', () => ({ sendOtpEmail: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { requireDoctor, requireRole, requireVerifiedDoctor, authenticateUser } from '../src/middleware/auth.js';
import { signAccessToken } from '../src/utils/tokens.js';
import { deleteAccount } from '../src/services/doctor.service.js';

let user;
beforeEach(() => {
  user = { id: '12345678-1234-4234-8234-123456789abc', accountStatus: 'ACTIVE', emailVerifiedAt: new Date(), tokenVersion: 0, role: 'DOCTOR', doctorProfile: { id: 'doctor', verificationStatus: 'VERIFIED' } };
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(async () => user), update: vi.fn() },
    doctorProfile: { findUnique: vi.fn(async () => ({ id: 'doctor' })), update: vi.fn() },
    booking: { count: vi.fn(async () => 0) },
    refreshToken: { updateMany: vi.fn() },
    doctorWorkingHour: { updateMany: vi.fn() },
    doctorBlockedSlot: { updateMany: vi.fn() },
    otpChallenge: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() }
  });
  prisma.$transaction = async (work) => work(prisma);
});
describe('authorization and account deletion', () => {
  it('rejects a client from doctor routes', () => {
    const next = vi.fn();
    requireDoctor({ user: { role: 'CLIENT' } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
  it('rejects doctors from admin routes', () => {
    const next = vi.fn();
    requireRole('ADMIN')({ user }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
  it.each(['PENDING', 'REJECTED', 'SUSPENDED'])('rejects %s doctor from verified operations', (state) => {
    user.doctorProfile.verificationStatus = state;
    const next = vi.fn();
    requireVerifiedDoctor({ user }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCTOR_NOT_VERIFIED' }));
  });
  it.each(['DELETED', 'LOCKED'])('rejects valid JWT for %s account', async (status) => {
    const token = signAccessToken(user);
    user.accountStatus = status;
    const next = vi.fn();
    await authenticateUser({ get: () => 'Bearer ' + token }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_REVOKED' }));
  });
  it('checks appointment end rather than start before deletion', async () => {
    prisma.booking.count.mockResolvedValue(1);
    await expect(deleteAccount(user.id)).rejects.toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    const where = prisma.booking.count.mock.calls[0][0].where;
    expect(where).toHaveProperty('endTime');
    expect(where).not.toHaveProperty('startTime');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('revokes tokens, disables hours, and uses a phone placeholder fitting the DB column', async () => {
    await deleteAccount(user.id);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(prisma.doctorWorkingHour.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
    expect(prisma.doctorProfile.update.mock.calls[0][0].data.phoneNumber.length).toBeLessThanOrEqual(32);
    expect(prisma.user.update.mock.calls[0][0].data.accountStatus).toBe('DELETED');
  });
});
