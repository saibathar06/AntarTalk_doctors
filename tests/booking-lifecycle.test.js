import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../src/config/env.js', () => ({ env: {
  DOCTOR_SAME_DAY_CANCELLATION_PENALTY_PERCENT: 5,
  BOOKING_TRANSACTION_TIMEOUT_MS: 15_000,
  JOIN_EARLY_MINUTES: 10
} }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/services/transaction.service.js', async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  return {
    lockUser: vi.fn(),
    lockDoctor: vi.fn(),
    serialTransaction: vi.fn((work) => work(prisma))
  };
});
vi.mock('../src/services/slot.service.js', () => ({ assertStructurallyBookable: vi.fn() }));
vi.mock('../src/services/bookingEvent.service.js', () => ({ enqueueBookingEvent: vi.fn() }));
vi.mock('../src/services/audit.service.js', () => ({ recordAudit: vi.fn() }));
vi.mock('../src/services/video.service.js', () => ({ endVideoCall: vi.fn(async () => undefined) }));

import { prisma } from '../src/lib/prisma.js';
import { enqueueBookingEvent } from '../src/services/bookingEvent.service.js';
import { assertStructurallyBookable } from '../src/services/slot.service.js';
import {
  cancelClientSession,
  cancelDoctorSession,
  completeDoctorSession,
  requestClientReschedule,
  respondToReschedule,
  rescheduleDoctorSession
} from '../src/services/bookingLifecycle.service.js';

const amount = (value) => new Prisma.Decimal(value);
const baseStart = new Date('2030-01-08T10:00:00Z');
const baseBooking = () => ({
  id: 'booking', doctorId: 'doctor', clientId: 'client', clientName: 'Client',
  startTime: baseStart, endTime: new Date('2030-01-08T11:00:00Z'), sessionDurationMinutes: 40,
  status: 'CONFIRMED', rescheduleCount: 0, refund: null, penalty: null,
  doctor: { id: 'doctor', userId: 'doctor-user', firstName: 'Test', lastName: 'Doctor', timezone: 'Asia/Kolkata' },
  payment: { id: 'payment', status: 'SUCCEEDED', provider: 'RAZORPAY', providerPaymentId: 'pay_one', amount: amount(700), doctorEarning: amount(560), currency: 'INR' },
  videoCall: { opensAt: new Date('2030-01-08T09:50:00Z') }, rescheduleRequests: []
});

let booking;
beforeEach(() => {
  vi.clearAllMocks();
  booking = baseBooking();
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    booking: {
      findUnique: vi.fn(async () => booking),
      update: vi.fn(async ({ data }) => {
        booking = { ...booking, ...data, rescheduleCount: data.rescheduleCount?.increment ? booking.rescheduleCount + data.rescheduleCount.increment : booking.rescheduleCount };
        return booking;
      })
    },
    earning: { upsert: vi.fn(async ({ create }) => ({ id: 'earning', ...create })) },
    rescheduleRequest: {
      create: vi.fn(async ({ data }) => ({ id: 'request', status: 'PENDING', ...data })),
      findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn()
    },
    videoCall: { update: vi.fn() },
    refundTransaction: { upsert: vi.fn(async ({ create }) => ({ id: 'refund', status: 'PENDING', ...create })) },
    doctorPenalty: { upsert: vi.fn(async ({ create }) => ({ id: 'penalty', ...create })) }
  });
  assertStructurallyBookable.mockImplementation(async (_doctorId, startTime) => ({
    startTime, endTime: new Date(startTime.getTime() + 60 * 60_000)
  }));
});

describe('booking lifecycle financial and reschedule boundaries', () => {
  it('credits earnings only after the scheduled therapy period ends', async () => {
    await expect(completeDoctorSession('doctor-user', 'doctor', 'booking', { now: new Date('2030-01-08T10:39:59Z') }))
      .rejects.toMatchObject({ code: 'SESSION_STILL_IN_PROGRESS' });
    expect(prisma.earning.upsert).not.toHaveBeenCalled();

    await completeDoctorSession('doctor-user', 'doctor', 'booking', { now: new Date('2030-01-08T10:40:00Z') });
    expect(prisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
    expect(prisma.earning.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: 'booking' }, create: expect.objectContaining({ amount: amount(560), status: 'AVAILABLE' })
    }));
  });

  it('charges a client cancellation without creating a refund or doctor penalty', async () => {
    await cancelClientSession('client', 'booking', 'Plans changed', { now: new Date('2030-01-07T10:00:00Z') });
    expect(booking).toMatchObject({ status: 'CANCELLED', cancelledBy: 'CLIENT' });
    expect(prisma.refundTransaction.upsert).not.toHaveBeenCalled();
    expect(prisma.doctorPenalty.upsert).not.toHaveBeenCalled();
    expect(enqueueBookingEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'CANCELLATION', expect.objectContaining({ cancelledBy: 'CLIENT' }));
  });

  it('creates a full refund and five-percent adjustment for same-day doctor cancellation', async () => {
    await cancelDoctorSession('doctor-user', 'doctor', 'booking', 'Emergency', { now: new Date('2030-01-08T01:00:00Z') });
    expect(prisma.refundTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ amount: amount(700) }) }));
    expect(prisma.doctorPenalty.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ amount: amount(35) }) }));
  });

  it('keeps the original booking while a client request is pending and moves it only after approval', async () => {
    const proposed = new Date('2030-01-09T10:00:00Z');
    const request = await requestClientReschedule('client', 'booking', { startTime: proposed }, { now: new Date('2030-01-07T01:00:00Z') });
    expect(request).toMatchObject({ status: 'PENDING', proposedStartTime: proposed });
    expect(booking.startTime).toEqual(baseStart);
    expect(prisma.booking.update).not.toHaveBeenCalled();

    prisma.rescheduleRequest.findUnique.mockResolvedValue({ ...request, bookingId: 'booking' });
    prisma.rescheduleRequest.update.mockResolvedValue({ ...request, status: 'APPROVED' });
    await respondToReschedule('doctor-user', 'doctor', 'request', 'APPROVE', { now: new Date('2030-01-07T02:00:00Z') });
    expect(booking.startTime).toEqual(proposed);
    expect(booking.rescheduleCount).toBe(1);
  });

  it('allows a doctor to reschedule a missed confirmed session from appointments', async () => {
    const proposed = new Date('2030-01-10T10:00:00Z');
    await rescheduleDoctorSession('doctor-user', 'doctor', 'booking', { startTime: proposed }, { now: new Date('2030-01-08T11:01:00Z') });
    expect(booking.startTime).toEqual(proposed);
    expect(booking.rescheduleCount).toBe(1);
  });
});
