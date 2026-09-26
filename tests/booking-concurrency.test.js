import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/services/slot.service.js', () => ({
  readOwnedReservation: vi.fn(), assertStructurallyBookable: vi.fn(), deleteReservationIfOwned: vi.fn()
}));
import { prisma } from '../src/lib/prisma.js';
import { readOwnedReservation, assertStructurallyBookable, deleteReservationIfOwned } from '../src/services/slot.service.js';
import { confirmBooking } from '../src/services/booking.service.js';
import { withdraw } from '../src/services/payout.service.js';

let records, bookings, payouts, tail;
const start = new Date('2030-01-01T14:00:00Z');
const end = new Date('2030-01-01T15:00:00Z');
const input = { reservationId: 'reservation', doctorId: 'doctor', startTime: start, paymentId: 'payment' };
beforeEach(() => {
  vi.clearAllMocks();
  records = new Map(); bookings = []; payouts = []; tail = Promise.resolve();
  const recordKey = (where) => JSON.stringify(where.userId_scope_key);
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(async () => ({ id: 'client', role: 'CLIENT', accountStatus: 'ACTIVE', emailVerifiedAt: new Date() })) },
    doctorProfile: { findUnique: vi.fn(async () => ({ userId: 'doctor-user', verificationStatus: 'VERIFIED' })) },
    payment: { findUnique: vi.fn(async () => ({
      clientId: 'client', status: 'SUCCEEDED', doctorId: 'doctor', slotStart: start, slotEnd: end,
      amount: new Prisma.Decimal(100), expectedAmount: new Prisma.Decimal(100),
      currency: 'INR', expectedCurrency: 'INR', doctorEarning: new Prisma.Decimal(80), booking: null
    })) },
    booking: { create: vi.fn(async ({ data }) => { const value = { ...data, id: 'booking' }; bookings.push(value); return value; }) },
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }) => records.get(recordKey(where)) ?? null),
      create: vi.fn(async ({ data }) => records.set(recordKey({ userId_scope_key: { userId: data.userId, scope: data.scope, key: data.key } }), data))
    },
    earning: { aggregate: vi.fn(async () => ({ _sum: { amount: new Prisma.Decimal(100) } })) },
    earningReversal: { aggregate: vi.fn(async () => ({ _sum: { amount: new Prisma.Decimal(0) } })) },
    payoutTransaction: {
      aggregate: vi.fn(async () => ({ _sum: { amount: new Prisma.Decimal(payouts.reduce((sum, p) => sum + Number(p.amount), 0)) } })),
      create: vi.fn(async ({ data }) => { const value = { ...data, id: 'payout' }; payouts.push(value); return value; })
    },
    payoutAccount: { findFirst: vi.fn(async () => ({ id: 'account' })) },
    auditLog: { create: vi.fn() }
  });
  // Service concurrency model; real PostgreSQL lock/exclusion tests are a separate integration gate.
  prisma.$transaction = (work) => {
    const run = tail.then(async () => {
      const savedBookings = [...bookings], savedPayouts = [...payouts], savedRecords = new Map(records);
      try { return await work(prisma); } catch (error) { bookings = savedBookings; payouts = savedPayouts; records = savedRecords; throw error; }
    });
    tail = run.catch(() => {});
    return run;
  };
  readOwnedReservation.mockResolvedValue({ key: 'key', raw: 'raw', value: { endTime: end.toISOString(), expiresAt: Date.now() + 180000 } });
  assertStructurallyBookable.mockResolvedValue({ doctorId: 'doctor', startTime: start, endTime: end });
  deleteReservationIfOwned.mockResolvedValue(1);
});
describe('booking retry regressions', () => {
  it('simultaneous identical requests create one booking and replay one result', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => confirmBooking('client', input, 'same-key')));
    expect(bookings).toHaveLength(1);
    expect(results.every((r) => r.id === 'booking')).toBe(true);
  });
  it('rejects changed reservation ID under the same key', async () => {
    await confirmBooking('client', input, 'same-key');
    await expect(confirmBooking('client', { ...input, reservationId: 'different' }, 'same-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
  it('rolls back booking if reservation disappears at final validation', async () => {
    readOwnedReservation.mockResolvedValueOnce({ key: 'key', raw: 'raw', value: { endTime: end.toISOString(), expiresAt: Date.now() + 180000 } });
    readOwnedReservation.mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'RESERVATION_EXPIRED' }));
    await expect(confirmBooking('client', input, 'key')).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
    expect(bookings).toHaveLength(0);
    expect(records.size).toBe(0);
  });
  it('does not turn committed success into failure if Redis cleanup fails', async () => {
    deleteReservationIfOwned.mockRejectedValue(new Error('Redis unavailable'));
    await expect(confirmBooking('client', input, 'key')).resolves.toMatchObject({ id: 'booking' });
  });
  it('rejects changed endTime after schedule configuration changes', async () => {
    readOwnedReservation.mockResolvedValue({ value: { endTime: start.toISOString(), expiresAt: Date.now() + 180000 } });
    await expect(confirmBooking('client', input, 'key')).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(bookings).toHaveLength(0);
  });
});
describe('withdrawal retry regressions', () => {
  const request = { amount: 80, currency: 'INR', payoutAccountId: 'account' };
  it('simultaneous identical withdrawals produce one payout', async () => {
    await Promise.all(Array.from({ length: 10 }, () => withdraw('doctor-user', 'doctor', request, 'same-key')));
    expect(payouts).toHaveLength(1);
  });
  it('concurrent different withdrawals cannot spend the same available earnings twice', async () => {
    const results = await Promise.allSettled([
      withdraw('doctor-user', 'doctor', request, 'key-one'),
      withdraw('doctor-user', 'doctor', request, 'key-two')
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(payouts).toHaveLength(1);
  });
  it('rejects another doctors payout account', async () => {
    prisma.payoutAccount.findFirst.mockResolvedValue(null);
    await expect(withdraw('doctor-user', 'doctor', request, 'key')).rejects.toMatchObject({ code: 'PAYOUT_ACCOUNT_NOT_FOUND' });
  });
});
