import { describe, expect, it, vi } from 'vitest';
import { searchBookableDoctors } from '../src/services/bookingDiscovery.service.js';

const slotStart = new Date('2030-01-02T04:30:00.000Z'); // 10:00 IST
const profile = {
  id: '10000000-0000-4000-8000-000000000001', userId: '20000000-0000-4000-8000-000000000001',
  firstName: 'Asha', lastName: 'Rao', gender: 'FEMALE', professionalCategory: 'PSYCHOLOGIST',
  professionalStatus: 'LICENSED_PROFESSIONAL', specialization: 'Anxiety', qualification: 'MSc',
  institution: 'Test University', experienceYears: 4, preferredSessionLanguage: 'English', languages: ['English'],
  bio: 'Therapist', timezone: 'Asia/Kolkata', verificationStatus: 'VERIFIED', isAcceptingBookings: true,
  licenseNumber: 'PSY-123', profileImageUrl: '/photo.jpg', consultationFee: 1000, expertise: ['Anxiety'], availabilityPresets: [],
  user: { role: 'DOCTOR', accountStatus: 'ACTIVE', emailVerifiedAt: new Date() },
  workingHours: [{ dayOfWeek: 3, availableDate: new Date('2030-01-02T00:00:00.000Z'), startTime: new Date('1970-01-01T10:00:00.000Z'), endTime: new Date('1970-01-01T12:00:00.000Z'), isActive: true }]
};

function database(overrides = {}) {
  return {
    doctorProfile: { findMany: vi.fn(async () => [structuredClone(profile)]) },
    doctorBlockedSlot: { findMany: vi.fn(async () => overrides.blocked ?? []) },
    booking: { findMany: vi.fn(async () => overrides.booked ?? []) }
  };
}

const input = { date: '2030-01-02', startTime: '10:00', page: 1, limit: 20 };

describe('client doctor discovery', () => {
  it('returns only a verified doctor with the exact backend-generated slot', async () => {
    const result = await searchBookableDoctors(input, database(), { mget: vi.fn(async () => [null]) }, new Date('2030-01-01T00:00:00Z'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ doctor: { firstName: 'Asha', verificationStatus: 'VERIFIED' }, slot: { startTime: slotStart, sessionDurationMinutes: 40 } });
  });

  it.each([
    ['blocked', { blocked: [{ doctorId: profile.id }] }, [null]],
    ['booked', { booked: [{ doctorId: profile.id }] }, [null]],
    ['reserved', {}, ['held-by-another-client']]
  ])('excludes a %s slot', async (_name, records, holds) => {
    const result = await searchBookableDoctors(input, database(records), { mget: vi.fn(async () => holds) }, new Date('2030-01-01T00:00:00Z'));
    expect(result.items).toEqual([]);
  });

  it('rejects dates outside the rolling seven-day IST window', async () => {
    await expect(searchBookableDoctors({ ...input, date: '2030-01-10' }, database(), { mget: vi.fn() }, new Date('2030-01-01T00:00:00Z')))
      .rejects.toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
  });
});
