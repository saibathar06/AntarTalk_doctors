import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/lib/redis.js', () => ({ redis: { mget: vi.fn(), eval: vi.fn() } }));

let getAvailableSlots, redis;

const profile = {
  id: 'doctor-id', userId: 'doctor-user-id', firstName: 'Asha', lastName: 'Sharma',
  timezone: 'UTC', profileImageUrl: '/api/doctor/files/00000000-0000-4000-8000-000000000001.jpg',
  professionalCategory: 'PSYCHOLOGIST', professionalStatus: 'LICENSED_PROFESSIONAL',
  licenseNumber: 'LICENSE-1', qualification: 'MSc Psychology', experienceYears: 3,
  bio: 'Public biography', languages: ['English'], preferredSessionLanguage: 'English', expertise: ['Anxiety'],
  verificationStatus: 'VERIFIED', isAcceptingBookings: true,
  user: { role: 'DOCTOR', accountStatus: 'ACTIVE', emailVerifiedAt: new Date('2029-01-01T00:00:00Z') },
  workingHours: [{ dayOfWeek: 1, startTime: new Date('1970-01-01T10:00:00Z'), endTime: new Date('1970-01-01T14:00:00Z') }]
};

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(32);
  process.env.OTP_PEPPER ??= 'b'.repeat(32);
  ({ getAvailableSlots } = await import('../src/services/slot.service.js'));
  ({ redis } = await import('../src/lib/redis.js'));
});

beforeEach(() => vi.clearAllMocks());

describe('availability filters on the shared backend', () => {
  it('returns only unblocked, unbooked and unreserved dynamically generated windows', async () => {
    const from = new Date('2030-01-07T00:00:00Z'); // Monday
    const to = new Date('2030-01-08T00:00:00Z');
    const db = {
      doctorProfile: { findUnique: vi.fn(async () => profile) },
      doctorBlockedSlot: { findMany: vi.fn(async () => [{ startTime: new Date('2030-01-07T11:00:00Z'), endTime: new Date('2030-01-07T12:00:00Z') }]) },
      booking: { findMany: vi.fn(async () => [{ startTime: new Date('2030-01-07T12:00:00Z'), endTime: new Date('2030-01-07T13:00:00Z') }]) }
    };
    // The remaining 13:00 window is held in Redis, so only 10:00 is client-visible.
    redis.mget.mockResolvedValue([null, '{"reservationId":"other-client"}']);
    const result = await getAvailableSlots({ doctorId: profile.id, from, to }, db);
    expect(result).toEqual([expect.objectContaining({
      doctorId: profile.id,
      startTime: new Date('2030-01-07T10:00:00Z'),
      endTime: new Date('2030-01-07T11:00:00Z'),
      sessionDurationMinutes: 40,
      bufferDurationMinutes: 20
    })]);
    expect(redis.mget).toHaveBeenCalledTimes(1);
  });

  it('does not return historical windows or a date outside the doctor’s recurring hours', async () => {
    const db = {
      doctorProfile: { findUnique: vi.fn(async () => profile) },
      doctorBlockedSlot: { findMany: vi.fn(async () => []) },
      booking: { findMany: vi.fn(async () => []) }
    };
    await expect(getAvailableSlots({ doctorId: profile.id, from: new Date('2020-01-06T00:00:00Z'), to: new Date('2020-01-07T00:00:00Z') }, db)).resolves.toEqual([]);
    await expect(getAvailableSlots({ doctorId: profile.id, from: new Date('2030-01-08T00:00:00Z'), to: new Date('2030-01-09T00:00:00Z') }, db)).resolves.toEqual([]);
  });
});
