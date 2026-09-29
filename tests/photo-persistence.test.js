import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  doctorProfile: { findUnique: vi.fn(), update: vi.fn() },
  doctorPhoto: { upsert: vi.fn(), findUnique: vi.fn() },
  doctorCredentialDocument: { upsert: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn()
} }));
vi.mock('../src/services/transaction.service.js', () => ({ lockUser: vi.fn(), lockDoctor: vi.fn() }));
vi.mock('../src/services/audit.service.js', () => ({ recordAudit: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { saveUpload, readUpload } from '../src/services/upload.service.js';

describe('profile photo upload and persistence', () => {
  it('compresses, persists and returns the uploaded JPEG without a disk dependency', async () => {
    let row = { id: 'doctor', verificationStatus: 'VERIFIED', profileImageUrl: null };
    let saved;
    prisma.$transaction.mockImplementation((work) => work(prisma));
    prisma.doctorProfile.findUnique.mockImplementation(async () => row);
    prisma.doctorProfile.update.mockImplementation(async ({ data }) => { row = { ...row, ...data }; return row; });
    prisma.doctorPhoto.upsert.mockImplementation(async ({ create }) => { saved = create; return saved; });
    prisma.doctorPhoto.findUnique.mockImplementation(async () => saved);
    const source = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#f7256f' } }).png().toBuffer();
    const result = await saveUpload('test-user', 'doctor', { mimetype: 'image/png', buffer: source });
    const output = await readUpload('test-user', result.url.split('/').at(-1));
    expect(Buffer.isBuffer(output)).toBe(true);
    expect(await sharp(output).metadata()).toMatchObject({ width: 800, height: 600, format: 'jpeg' });
    expect(row.verificationStatus).toBe('VERIFIED');
    expect(prisma.doctorPhoto.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { doctorId: 'doctor' } }));
  });
  it('persists and reads a private credential document without local disk storage', async () => {
    let row = { id: 'doctor', verificationStatus: 'PENDING', profileImageUrl: null, licenseDocumentUrl: null };
    let savedDocument;
    prisma.$transaction.mockImplementation((work) => work(prisma));
    prisma.doctorProfile.findUnique.mockImplementation(async () => row);
    prisma.doctorProfile.update.mockImplementation(async ({ data }) => { row = { ...row, ...data }; return row; });
    prisma.doctorCredentialDocument.upsert.mockImplementation(async ({ create }) => { savedDocument = create; return savedDocument; });
    prisma.doctorCredentialDocument.findUnique.mockImplementation(async () => savedDocument);
    const source = Buffer.from('%PDF-1.7\nprivate credential');
    const result = await saveUpload('test-user', 'doctor', { mimetype: 'application/pdf', buffer: source }, true);
    const output = await readUpload('test-user', result.url.split('/').at(-1));
    expect(output).toEqual(source);
    expect(result.url).toMatch(/\.pdf$/);
    expect(prisma.doctorCredentialDocument.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { doctorId: 'doctor' } }));
  });
});
