import crypto from 'node:crypto';
import path from 'node:path';
import { unlink, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import sharp from 'sharp';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { lockUser, lockDoctor } from './transaction.service.js';
import { recordAudit } from './audit.service.js';
import { logger } from '../lib/logger.js';

export const uploadRoot = path.resolve(env.UPLOAD_DIR);

// All images are decoded by Sharp rather than trusted from their declared MIME type.
// Profile photos are standardized to a compact JPEG that is safe to display.
export async function normalizeImageUpload(file, document = false) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    throw new AppError(422, 'INVALID_FILE', 'Use JPEG, PNG or WebP images, or PDF for credentials.');
  }
  try {
    return await sharp(file.buffer, { limitInputPixels: 25000000 })
      .rotate()
      .resize({ width: document ? 2000 : 800, height: document ? 2000 : 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new AppError(422, 'INVALID_IMAGE', 'This image could not be decoded.');
  }
}

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
    data = await normalizeImageUpload(file, document);
    extension = 'jpg';
  }
  const filename = `${crypto.randomUUID()}.${extension}`;
  const url = `/api/doctor/files/${filename}`;
  let oldUrl;
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor profile not found.');
    if (document && doctor.verificationStatus === 'VERIFIED') {
      throw new AppError(403, 'VERIFIED_CREDENTIALS_LOCKED', 'Verified credentials are locked. Contact AntarTalk support to correct a registration document.');
    }
    oldUrl = document ? doctor.licenseDocumentUrl : doctor.profileImageUrl;
    if (document) {
      await tx.doctorCredentialDocument.upsert({ where: { doctorId }, create: { doctorId, data }, update: { data } });
    } else {
      await tx.doctorPhoto.upsert({ where: { doctorId }, create: { doctorId, data }, update: { data } });
    }
    await tx.doctorProfile.update({ where: { userId }, data: document ? { licenseDocumentUrl: url, verificationStatus: 'PENDING', verificationSubmittedAt: null, verificationReason: null, isAcceptingBookings: false } : { profileImageUrl: url } });
    await recordAudit({ actorId: userId, action: document ? 'LICENSE_DOCUMENT_UPDATED' : 'PROFILE_PHOTO_UPDATED', entityType: 'DoctorProfile', entityId: doctorId }, tx);
  }, { timeout: env.BOOKING_TRANSACTION_TIMEOUT_MS, maxWait: 5000 });
  if (oldUrl) await removeStoredUpload(userId, oldUrl);
  return { url };
}

export async function saveStampSignature(userId, doctorId, file) {
  if (!file) throw new AppError(422, 'FILE_REQUIRED', 'Choose a signature or stamp image.');
  const data = await normalizeImageUpload(file);
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { professionalCategory: true } });
    if (!doctor || doctor.professionalCategory !== 'PSYCHIATRIST') {
      throw new AppError(403, 'PRESCRIPTIONS_NOT_PERMITTED', 'Only psychiatrists can add a prescription signature.');
    }
    await tx.doctorSignature.upsert({ where: { doctorId }, create: { doctorId, data }, update: { data } });
    await recordAudit({ actorId: userId, action: 'DOCTOR_STAMP_SIGNATURE_UPDATED', entityType: 'DoctorProfile', entityId: doctorId }, tx);
  }, { timeout: env.BOOKING_TRANSACTION_TIMEOUT_MS, maxWait: 5000 });
  return { hasStampSignature: true };
}
export async function readUpload(userId, filename) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true, profileImageUrl: true, licenseDocumentUrl: true } });
  const url = `/api/doctor/files/${filename}`;
  if (!doctor || ![doctor.profileImageUrl, doctor.licenseDocumentUrl].includes(url)) throw new AppError(404, 'FILE_NOT_FOUND', 'File not found.');
  if (url === doctor.profileImageUrl) {
    const photo = await prisma.doctorPhoto.findUnique({ where: { doctorId: doctor.id } });
    if (photo) return Buffer.from(photo.data);
  }
  if (url === doctor.licenseDocumentUrl) {
    const document = await prisma.doctorCredentialDocument.findUnique({ where: { doctorId: doctor.id } });
    if (document) return Buffer.from(document.data);
  }
  const file = path.join(uploadRoot, userId, filename);
  try {
    await access(file, fsConstants.R_OK);
  } catch {
    throw new AppError(410, 'FILE_UNAVAILABLE', 'This file is no longer available in secure storage. Upload it again.');
  }
  return file;
}

export async function readAdminLicenseDocument(doctorId) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true, userId: true, licenseDocumentUrl: true } });
  const filename = doctor?.licenseDocumentUrl ? path.basename(doctor.licenseDocumentUrl) : '';
  if (!doctor || !/^[a-f0-9-]{36}\.(jpg|pdf)$/.test(filename)) throw new AppError(404, 'FILE_NOT_FOUND', 'Credential document not found.');
  const document = await prisma.doctorCredentialDocument.findUnique({ where: { doctorId: doctor.id } });
  if (document) return Buffer.from(document.data);
  const file = path.join(uploadRoot, doctor.userId, filename);
  try {
    await access(file, fsConstants.R_OK);
  } catch {
    throw new AppError(410, 'CREDENTIAL_DOCUMENT_UNAVAILABLE', 'The credential document is no longer available in secure storage. Ask this doctor to upload it again before approving their application.');
  }
  return file;
}
