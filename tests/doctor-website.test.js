import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  doctorProfile: { findUnique: vi.fn() }, booking: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() }, $queryRaw: vi.fn()
} }));
import { prisma } from '../src/lib/prisma.js';
import { profileCompletion, canDoctorTakeSessions } from '../src/services/eligibility.service.js';
import { appointments, clients, joinState } from '../src/services/doctorWorkspace.service.js';
import { changedCredentialFields } from '../src/services/doctor.service.js';
import { updateProfileSchema } from '../src/validation/doctor.schemas.js';
import { readUpload, readAdminLicenseDocument, saveUpload, normalizeImageUpload } from '../src/services/upload.service.js';
import sharp from 'sharp';

const doctor = {
  id: 'doctor', timezone: 'Asia/Kolkata', firstName: 'Test', lastName: 'Professional',
  profileImageUrl: '/photo', professionalCategory: 'PSYCHOLOGIST', professionalStatus: 'LICENSED_PROFESSIONAL',
  licenseNumber: 'TEST', qualification: 'MSc', experienceYears: 0, consultationFee: 1200, bio: 'About care', languages: ['English'], preferredSessionLanguage: 'English', expertise: ['Anxiety'],
  verificationStatus: 'VERIFIED', isAcceptingBookings: true, user: { role: 'DOCTOR', accountStatus: 'ACTIVE', emailVerifiedAt: new Date() }
};
beforeEach(() => { vi.clearAllMocks(); prisma.doctorProfile.findUnique.mockResolvedValue(doctor); });
describe('server-derived profile and eligibility', () => {
  it('accepts zero years experience and calculates all required fields', () => expect(profileCompletion(doctor)).toEqual({ profileCompleted: true, completionPercentage: 100, missingFields: [] }));
  it.each(['firstName', 'profileImageUrl', 'professionalCategory', 'qualification', 'licenseNumber', 'bio', 'languages', 'preferredSessionLanguage', 'expertise'])('rejects incomplete %s', (field) => expect(canDoctorTakeSessions({ ...doctor, [field]: null })).toBe(false));
  it.each(['PENDING', 'SUSPENDED', 'REJECTED'])('completion never grants %s professional approval', (verificationStatus) => expect(canDoctorTakeSessions({ ...doctor, verificationStatus })).toBe(false));
  it('requires active, email-verified and accepting state', () => {
    expect(canDoctorTakeSessions({ ...doctor, isAcceptingBookings: false })).toBe(false);
    expect(canDoctorTakeSessions(doctor, { role: 'DOCTOR', accountStatus: 'LOCKED', emailVerifiedAt: new Date() })).toBe(false);
    expect(canDoctorTakeSessions(doctor, { role: 'DOCTOR', accountStatus: 'ACTIVE', emailVerifiedAt: null })).toBe(false);
    expect(canDoctorTakeSessions(doctor, { role: 'CLIENT', accountStatus: 'ACTIVE', emailVerifiedAt: new Date() })).toBe(false);
  });
  it('represents student credentials separately without requiring a license', () => {
    const student = { ...doctor, professionalStatus: 'FINAL_YEAR_STUDENT', licenseNumber: null, university: 'University', course: 'Psychology', enrollmentNumber: 'A1', expectedGraduationDate: new Date() };
    expect(profileCompletion(student).profileCompleted).toBe(true);
  });
  it.each(['profileCompleted', 'completionPercentage', 'canTakeSessions', 'profileImageUrl', 'licenseDocumentUrl'])('rejects client-controlled %s', (field) => expect(updateProfileSchema.safeParse({ body: { [field]: true } }).success).toBe(false));
  it.each([{ experienceYears: -1 }, { experienceYears: 1.5 }, { graduationYear: 1800 }, { consultationFee: -5 }, { languages: [''] }])('validates profile input %j', (body) => expect(updateProfileSchema.safeParse({ body }).success).toBe(false));
  it('does not treat verified doctors’ personal edits as credential changes', () => {
    expect(changedCredentialFields(doctor, { firstName: 'Updated', bio: 'Updated bio', phoneNumber: '+919876543210' })).toEqual([]);
    expect(changedCredentialFields(doctor, { licenseNumber: 'NEW-LICENSE' })).toEqual(['licenseNumber']);
  });
});
describe('doctor-scoped workspace', () => {
  it('uses doctor timezone for calendar bounds and strips client identifiers', async () => {
    prisma.booking.findMany.mockResolvedValue([{ id: 'booking', clientId: 'private-client-id', status: 'CONFIRMED', startTime: new Date('2030-01-01T10:00Z'), endTime: new Date('2030-01-01T11:00Z'), sessionDurationMinutes: 40 }]);
    prisma.booking.count.mockResolvedValue(1);
    const result = await appointments('doctor', { date: '2030-01-01', page: 1, limit: 20 });
    const query = prisma.booking.findMany.mock.calls[0][0];
    expect(query.where.doctorId).toBe('doctor');
    expect(query.where.startTime.gte.toISOString()).toBe('2029-12-31T18:30:00.000Z');
    expect(query.where.startTime.lt.toISOString()).toBe('2030-01-01T18:30:00.000Z');
    expect(JSON.stringify(result)).not.toContain('private-client-id');
    expect(result.items[0].clientLabel).toMatch(/^Client [A-F0-9]{10}$/);
  });
  it('scopes client aggregates to the assigned doctor', async () => {
    prisma.booking.groupBy.mockResolvedValue([{ clientId: 'private', _count: { id: 3 }, _max: { startTime: new Date() } }]);
    prisma.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const result = await clients('doctor', { page: 1, limit: 20 });
    expect(prisma.booking.groupBy.mock.calls[0][0].where).toEqual({ doctorId: 'doctor' });
    expect(result.items[0]).not.toHaveProperty('clientId');
  });
  it('uses the therapy cutoff, not the protected buffer', () => {
    const startTime = new Date('2030-01-01T10:00Z'); const booking = { startTime, endTime: new Date('2030-01-01T11:00Z'), sessionDurationMinutes: 40, status: 'CONFIRMED' };
    expect(joinState(booking, true, +startTime - 11 * 60000).state).toBe('NOT_YET');
    expect(joinState(booking, true, +startTime - 10 * 60000).canJoin).toBe(true);
    expect(joinState(booking, true, +startTime + 40 * 60000).state).toBe('ENDED');
    expect(joinState(booking, false, +startTime).canJoin).toBe(false);
    expect(joinState({ ...booking, status: 'CANCELLED' }, true, +startTime).canJoin).toBe(false);
  });
});
describe('private upload boundaries', () => {
  it('cannot fetch an unowned file', async () => {
    await expect(readUpload('user', 'another-file.pdf')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(prisma.doctorProfile.findUnique.mock.calls[0][0].where).toEqual({ userId: 'user' });
  });
  it('reports a stale credential reference instead of attempting to download a missing file', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111', licenseDocumentUrl: '/api/doctor/files/22222222-2222-4222-8222-222222222222.pdf' });
    await expect(readAdminLicenseDocument('doctor')).rejects.toMatchObject({
      status: 410,
      code: 'CREDENTIAL_DOCUMENT_UNAVAILABLE'
    });
  });
  it('rejects missing files and arbitrary HTML', async () => {
    await expect(saveUpload('user', 'doctor', undefined)).rejects.toMatchObject({ code: 'FILE_REQUIRED' });
    await expect(saveUpload('user', 'doctor', { mimetype: 'text/html', buffer: Buffer.from('<html>') })).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
  it('normalizes a valid profile image to a compact, display-safe JPEG', async () => {
    const source = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#f7256f' } }).png().toBuffer();
    const output = await normalizeImageUpload({ mimetype: 'image/png', buffer: source });
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 800, height: 600 });
  });
  it('rejects an image whose declared MIME type cannot actually be decoded', async () => {
    await expect(normalizeImageUpload({ mimetype: 'image/jpeg', buffer: Buffer.from('not an image') })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
});
