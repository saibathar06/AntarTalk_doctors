import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { lockUser, lockDoctor } from './transaction.service.js';
import { recordAudit } from './audit.service.js';
import { logger } from '../lib/logger.js';

export const uploadRoot = path.resolve(env.UPLOAD_DIR);
export async function removeStoredUpload(userId, url) {
  const filename = path.basename(url);
  if (!/^[a-f0-9-]{36}$/.test(userId) || !/^[a-f0-9-]{36}\.(jpg|pdf)$/.test(filename)) return;
  try { await unlink(path.join(uploadRoot, userId, filename)); }
  catch (error) { if (error.code !== 'ENOENT') logger.error({ errorCode: error.code }, 'Private upload deletion failed; run orphan cleanup'); }
}
export async function saveUpload(userId, doctorId, file, document = false) {
  if (!file) throw new AppError(422, 'FILE_REQUIRED', 'Choose a file to upload.');
  let data;
  let extension;
  if (document && file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-') {
    data = file.buffer; extension = 'pdf';
  } else {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new AppError(422, 'INVALID_FILE', 'Use JPEG, PNG or WebP images, or PDF for credentials.');
    try {
      data = await sharp(file.buffer, { limitInputPixels: 25000000 }).rotate().resize({ width: document ? 2000 : 800, height: document ? 2000 : 800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch { throw new AppError(422, 'INVALID_IMAGE', 'This image could not be decoded.'); }
    extension = 'jpg';
  }
  const filename = `${crypto.randomUUID()}.${extension}`;
  const directory = path.join(uploadRoot, userId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), data, { flag: 'wx', mode: 0o600 });
  const url = `/api/doctor/files/${filename}`;
  let oldUrl;
  try {
    await prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await lockDoctor(tx, doctorId);
      const doctor = await tx.doctorProfile.findUnique({ where: { userId } });
      oldUrl = document ? doctor.licenseDocumentUrl : doctor.profileImageUrl;
      await tx.doctorProfile.update({ where: { userId }, data: document ? { licenseDocumentUrl: url, verificationStatus: 'PENDING', verificationSubmittedAt: null, verificationReason: null, isAcceptingBookings: false } : { profileImageUrl: url } });
      await recordAudit({ actorId: userId, action: document ? 'LICENSE_DOCUMENT_UPDATED' : 'PROFILE_PHOTO_UPDATED', entityType: 'DoctorProfile', entityId: doctorId }, tx);
    });
  } catch (error) { await unlink(path.join(directory, filename)).catch(() => {}); throw error; }
  if (oldUrl) await removeStoredUpload(userId, oldUrl);
  return { url };
}
export async function readUpload(userId, filename) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, select: { profileImageUrl: true, licenseDocumentUrl: true } });
  const url = `/api/doctor/files/${filename}`;
  if (!doctor || ![doctor.profileImageUrl, doctor.licenseDocumentUrl].includes(url)) throw new AppError(404, 'FILE_NOT_FOUND', 'File not found.');
  return path.join(uploadRoot, userId, filename);
}

export async function readAdminLicenseDocument(doctorId) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { userId: true, licenseDocumentUrl: true } });
  const filename = doctor?.licenseDocumentUrl ? path.basename(doctor.licenseDocumentUrl) : '';
  if (!doctor || !/^[a-f0-9-]{36}\.(jpg|pdf)$/.test(filename)) throw new AppError(404, 'FILE_NOT_FOUND', 'Credential document not found.');
  return path.join(uploadRoot, doctor.userId, filename);
}
