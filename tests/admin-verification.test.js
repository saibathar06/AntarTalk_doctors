import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { prisma } from '../src/lib/prisma.js';
import { decideVerification, listVerificationQueue } from '../src/services/adminVerification.service.js';

const admin = { id: '12345678-1234-4234-8234-123456789abc', role: 'ADMIN', accountStatus: 'ACTIVE' };
let profile;
beforeEach(() => {
  profile = {
    id: '87654321-1234-4234-8234-123456789abc', firstName: 'Review', lastName: 'Doctor', phoneNumber: '+919876543210',
    professionalCategory: 'PSYCHOLOGIST', professionalStatus: 'LICENSED_PROFESSIONAL', licenseNumber: 'LIC-1', licenseAuthority: 'Authority',
    university: null, course: null, specialization: null, expectedGraduationDate: null, enrollmentNumber: null,
    qualification: 'MSc Psychology', institution: 'University', graduationYear: 2020, experienceYears: 3, bio: 'Care focused',
    languages: ['English'], expertise: ['Anxiety'], licenseDocumentUrl: '/api/doctor/files/11111111-1111-4111-8111-111111111111.pdf', profileImageUrl: null,
    timezone: 'Asia/Kolkata', verificationStatus: 'PENDING', verificationSubmittedAt: new Date('2030-01-01T10:00:00Z'), verificationReason: null,
    isAcceptingBookings: false, updatedAt: new Date('2030-01-01T11:00:00Z'), user: { email: 'review@example.test' }
  };
  Object.assign(prisma, {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (work) => work(prisma)),
    user: { findUnique: vi.fn(async () => admin) },
    doctorProfile: {
      findMany: vi.fn(async () => [profile]), count: vi.fn(async () => 1), findFirst: vi.fn(async () => profile),
      update: vi.fn(async ({ data }) => ({ ...profile, ...data }))
    },
    auditLog: { create: vi.fn() }
  });
});

describe('admin verification queue', () => {
  it('shows only explicitly submitted pending profiles and does not expose nested user data', async () => {
    const result = await listVerificationQueue({ page: 1, limit: 20 });
    expect(prisma.doctorProfile.findMany.mock.calls[0][0].where).toEqual({ verificationStatus: 'PENDING', verificationSubmittedAt: { not: null } });
    expect(result.items[0]).toMatchObject({ email: 'review@example.test', hasLicenseDocument: true });
    expect(result.items[0]).not.toHaveProperty('user');
  });
  it('rejects with a recorded reason, keeps bookings off, and records an audit event', async () => {
    const result = await decideVerification(admin.id, profile.id, { status: 'REJECTED', reason: 'Please upload a current credential document.', expectedUpdatedAt: profile.updatedAt }, { ip: '127.0.0.1' });
    expect(prisma.doctorProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { verificationStatus: 'REJECTED', verificationReason: 'Please upload a current credential document.', isAcceptingBookings: false } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'DOCTOR_VERIFICATION_REJECTED', actorId: admin.id }) }));
    expect(result.verificationStatus).toBe('REJECTED');
  });
  it('rejects a stale decision when the profile changed after the admin opened it', async () => {
    await expect(decideVerification(admin.id, profile.id, { status: 'VERIFIED', expectedUpdatedAt: new Date('2030-01-01T09:00:00Z') })).rejects.toMatchObject({ code: 'VERIFICATION_REQUEST_CHANGED' });
    expect(prisma.doctorProfile.update).not.toHaveBeenCalled();
  });
});
