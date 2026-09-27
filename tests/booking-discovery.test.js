import { beforeAll, describe, expect, it, vi } from 'vitest';

let getBookableDoctor;

const completeDoctor = {
  id: 'doctor-id',
  userId: 'doctor-user-id',
  firstName: 'Asha',
  lastName: 'Sharma',
  gender: 'FEMALE',
  professionalCategory: 'PSYCHOLOGIST',
  professionalStatus: 'LICENSED_PROFESSIONAL',
  specialization: 'Anxiety care',
  qualification: 'MSc Psychology',
  institution: 'Test University',
  experienceYears: 7,
  preferredSessionLanguage: 'English',
  languages: ['English', 'Hindi'],
  expertise: ['Anxiety'],
  bio: 'A short public biography.',
  timezone: 'Asia/Kolkata',
  profileImageUrl: '/api/doctor/files/00000000-0000-4000-8000-000000000001.jpg',
  licenseNumber: 'LICENSE-1',
  verificationStatus: 'VERIFIED',
  isAcceptingBookings: true,
  consultationFee: { toString: () => '1200.00' },
  user: { role: 'DOCTOR', accountStatus: 'ACTIVE', emailVerifiedAt: new Date() }
};

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(32);
  process.env.OTP_PEPPER ??= 'b'.repeat(32);
  ({ getBookableDoctor } = await import('../src/services/bookingDiscovery.service.js'));
});

describe('public booking doctor discovery', () => {
  it('returns only a bookable doctor’s client-safe professional information', async () => {
    const db = { doctorProfile: { findUnique: vi.fn(async () => completeDoctor) } };
    await expect(getBookableDoctor(completeDoctor.id, db)).resolves.toEqual({
      id: 'doctor-id', firstName: 'Asha', lastName: 'Sharma', gender: 'FEMALE',
      professionalCategory: 'PSYCHOLOGIST', specialization: 'Anxiety care',
      qualification: 'MSc Psychology', institution: 'Test University', experienceYears: 7,
      preferredSessionLanguage: 'English', languages: ['English', 'Hindi'],
      bio: 'A short public biography.', timezone: 'Asia/Kolkata', verificationStatus: 'VERIFIED',
      hasProfileImage: true, consultationFee: '1200.00'
    });
  });

  it('does not disclose a professional who is not currently bookable', async () => {
    const db = { doctorProfile: { findUnique: vi.fn(async () => ({ ...completeDoctor, isAcceptingBookings: false })) } };
    await expect(getBookableDoctor(completeDoctor.id, db)).rejects.toMatchObject({ code: 'DOCTOR_NOT_BOOKABLE' });
  });
  it('respects a professional’s choice not to publish gender', async () => {
    const db = { doctorProfile: { findUnique: vi.fn(async () => ({ ...completeDoctor, gender: 'PREFER_NOT_TO_SAY' })) } };
    await expect(getBookableDoctor(completeDoctor.id, db)).resolves.toMatchObject({ gender: null });
  });
});
