import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { prisma } from '../src/lib/prisma.js';
import { settleCompletedBooking, reverseRefundedEarning } from '../src/services/earnings.service.js';
beforeEach(() => {
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    booking: { findUnique: vi.fn(async () => ({ id: 'booking', doctorId: 'doctor', status: 'COMPLETED', payment: { status: 'SUCCEEDED', currency: 'INR', doctorEarning: new Prisma.Decimal(80) } })) },
    earning: {
      upsert: vi.fn(async ({ create }) => create),
      findUnique: vi.fn(async () => ({ id: 'earning', doctorId: 'doctor', status: 'AVAILABLE', amount: new Prisma.Decimal(80), booking: { payment: { status: 'REFUNDED' } } }))
    },
    earningReversal: { upsert: vi.fn(async ({ create }) => create) }
  });
  prisma.$transaction = (work) => work(prisma);
});
describe('trusted earnings boundary', () => {
  it('derives earning from trusted payment and uses booking uniqueness', async () => {
    await settleCompletedBooking('booking');
    const args = prisma.earning.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ bookingId: 'booking' });
    expect(args.create.amount.toString()).toBe('80');
    expect(args.update).toEqual({});
  });
  it('cannot settle an uncompleted booking', async () => {
    prisma.booking.findUnique.mockResolvedValue({ doctorId: 'doctor', status: 'CONFIRMED' });
    await expect(settleCompletedBooking('booking')).rejects.toMatchObject({ code: 'EARNING_NOT_SETTLEABLE' });
  });
  it('creates a compensating record instead of mutating earned amount', async () => {
    await reverseRefundedEarning('earning');
    expect(prisma.earningReversal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { earningId: 'earning' }, update: {} }));
    expect(prisma.earning.upsert).not.toHaveBeenCalled();
  });
  it('refuses reversal before trusted refund', async () => {
    prisma.earning.findUnique.mockResolvedValue({ doctorId: 'doctor', booking: { payment: { status: 'SUCCEEDED' } } });
    await expect(reverseRefundedEarning('earning')).rejects.toMatchObject({ code: 'EARNING_NOT_REVERSIBLE' });
  });
});
