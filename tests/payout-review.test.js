import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { prisma } from '../src/lib/prisma.js';
import { encryptProviderToken } from '../src/utils/encryption.js';
import { completePayout, reviewPayout } from '../src/services/payout.service.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const payoutId = '22222222-2222-4222-8222-222222222222';
let payout;
beforeEach(() => {
  payout = { id: payoutId, doctorId: '33333333-3333-4333-8333-333333333333', payoutAccountId: '44444444-4444-4444-8444-444444444444', status: 'PENDING' };
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (work) => work(prisma)),
    user: { findUnique: vi.fn(async () => ({ id: adminId, role: 'ADMIN', accountStatus: 'ACTIVE' })) },
    payoutAccount: { findUnique: vi.fn(async () => ({ encryptedProviderDetails: encryptProviderToken(JSON.stringify({ type: 'UPI', upiId: 'doctor@bank' })) })) },
    payoutTransaction: {
      findUnique: vi.fn(async () => payout),
      updateMany: vi.fn(async ({ where, data }) => {
        if (payout.status !== where.status) return { count: 0 };
        payout = { ...payout, ...data };
        return { count: 1 };
      })
    },
    auditLog: { create: vi.fn() }
  });
});

describe('administrator payout decisions', () => {
  it('requires admin approval before a transfer can be marked complete', async () => {
    await expect(completePayout(adminId, payoutId, 'UTR123456')).rejects.toMatchObject({ code: 'PAYOUT_REQUEST_CHANGED' });
    await reviewPayout(adminId, payoutId, { decision: 'APPROVE' });
    expect(payout.status).toBe('PROCESSING');
    await completePayout(adminId, payoutId, 'UTR123456');
    expect(payout).toMatchObject({ status: 'COMPLETED', providerReference: 'UTR123456' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PAYOUT_TRANSFER_RECORDED' }) }));
  });
  it('rejects a request once and prevents a second decision', async () => {
    await reviewPayout(adminId, payoutId, { decision: 'REJECT', reason: 'Account details could not be verified.' });
    expect(payout).toMatchObject({ status: 'CANCELLED', failureReason: 'Account details could not be verified.' });
    await expect(reviewPayout(adminId, payoutId, { decision: 'APPROVE' })).rejects.toMatchObject({ code: 'PAYOUT_REQUEST_CHANGED' });
  });
  it('denies non-admin callers', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: adminId, role: 'DOCTOR', accountStatus: 'ACTIVE' });
    await expect(reviewPayout(adminId, payoutId, { decision: 'APPROVE' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
