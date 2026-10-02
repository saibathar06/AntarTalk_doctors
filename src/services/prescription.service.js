import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { stableHash } from '../utils/crypto.js';
import { serialTransaction, lockDoctor, lockUser } from './transaction.service.js';
import { recordAudit } from './audit.service.js';
import { sendPrescriptionEmail } from '../lib/mailer.js';
import { logger } from '../lib/logger.js';

const safeText = (value) => Array.from(String(value ?? ''), (character) => character >= ' ' && character !== '\x7F' ? character : ' ').join('').trim();
const jsonSafe = (value) => JSON.parse(JSON.stringify(value));

export function renderPrescriptionPdf({ prescriptionId, doctor, clientName, sessionStart, medicines, instructions, signature }) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 54, info: { Title: 'AntarTalk Prescription', Author: `Dr. ${doctor.name}` } });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.rect(0, 0, 595.28, 9).fill('#F7256F');
    document.circle(77, 69, 18).fill('#F7256F');
    document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text('+', 71.6, 58.5, { width: 11, align: 'center' });
    document.fillColor('#172033').font('Helvetica-Bold').fontSize(21).text('AntarTalk', 105, 55);
    document.fillColor('#119B82').font('Helvetica-Bold').fontSize(7.5).text('MENTAL HEALTH CARE', 106, 80, { characterSpacing: 1.6 });
    document.fillColor('#172033').font('Helvetica-Bold').fontSize(18).text('PRESCRIPTION', 54, 126);
    document.strokeColor('#E9EAF0').moveTo(54, 155).lineTo(541, 155).stroke();

    const issued = DateTime.fromJSDate(new Date(sessionStart), { zone: 'utc' }).setZone('Asia/Kolkata');
    const rows = [
      ['Patient', safeText(clientName) || 'Client'],
      ['Session', issued.toFormat('dd LLL yyyy, hh:mm a') + ' IST'],
      ['Prescriber', `Dr. ${safeText(doctor.name)}`],
      ['Professional category', 'Psychiatrist'],
      ['Registration no.', safeText(doctor.licenseNumber) || 'On file with AntarTalk']
    ];
    let y = 177;
    for (const [label, value] of rows) {
      document.fillColor('#667085').font('Helvetica').fontSize(9).text(label.toUpperCase(), 54, y, { width: 145, characterSpacing: 0.6 });
      document.fillColor('#172033').font('Helvetica-Bold').fontSize(10.5).text(value, 205, y, { width: 336 });
      y += 25;
    }
    y += 14;
    document.fillColor('#119B82').font('Helvetica-Bold').fontSize(10).text('PRESCRIBED MEDICINES', 54, y, { characterSpacing: 1.1 });
    y += 23;
    document.fillColor('#172033').font('Helvetica').fontSize(11).text(safeText(medicines), 54, y, { width: 487, lineGap: 5 });
    y = document.y + 24;
    if (instructions) {
      document.fillColor('#119B82').font('Helvetica-Bold').fontSize(10).text('INSTRUCTIONS', 54, y, { characterSpacing: 1.1 });
      y = document.y + 11;
      document.fillColor('#172033').font('Helvetica').fontSize(11).text(safeText(instructions), 54, y, { width: 487, lineGap: 5 });
      y = document.y + 22;
    }
    if (y > 650) { document.addPage(); y = 72; }
    document.strokeColor('#E9EAF0').moveTo(54, y).lineTo(541, y).stroke();
    const signatureY = y + 20;
    document.image(signature, 380, signatureY, { fit: [145, 58], align: 'right' });
    document.strokeColor('#172033').moveTo(360, signatureY + 66).lineTo(541, signatureY + 66).stroke();
    document.fillColor('#172033').font('Helvetica-Bold').fontSize(10).text(`Dr. ${safeText(doctor.name)}`, 360, signatureY + 73, { width: 181, align: 'right' });
    document.fillColor('#667085').font('Helvetica').fontSize(8.5).text('Authorized psychiatrist signature / stamp', 360, signatureY + 87, { width: 181, align: 'right' });
    document.fillColor('#98A0AE').font('Helvetica').fontSize(7.5).text(`AntarTalk prescription ID: ${prescriptionId}`, 54, 780, { width: 487, align: 'center' });
    document.end();
  });
}

const bookingSelect = {
  id: true, doctorId: true, clientId: true, clientName: true, startTime: true, status: true,
  doctor: { select: { firstName: true, lastName: true, professionalCategory: true, licenseNumber: true, userId: true } },
  client: { select: { email: true, accountStatus: true } }
};

function serializePrescription(prescription) {
  return { id: prescription.id, bookingId: prescription.bookingId, medicines: prescription.medicines, instructions: prescription.instructions, issuedAt: prescription.issuedAt };
}

export async function createPrescription(userId, doctorId, bookingId, input, idempotencyKey, context = {}) {
  const requestHash = stableHash({ bookingId, medicines: input.medicines, instructions: input.instructions ?? null });
  const existing = await prisma.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope: 'PRESCRIPTION_CREATE', key: idempotencyKey } } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request.');
    return existing.responseBody;
  }
  const response = await serialTransaction(async (tx) => {
    await lockUser(tx, userId);
    await lockDoctor(tx, doctorId);
    const replay = await tx.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope: 'PRESCRIPTION_CREATE', key: idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request.');
      return replay.responseBody;
    }
    const booking = await tx.booking.findFirst({ where: { id: bookingId, doctorId }, select: bookingSelect });
    if (!booking) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    if (booking.status !== 'COMPLETED') throw new AppError(409, 'PRESCRIPTION_SESSION_INCOMPLETE', 'A prescription can be issued only after this session is completed.');
    if (booking.doctor.userId !== userId || booking.doctor.professionalCategory !== 'PSYCHIATRIST') throw new AppError(403, 'PRESCRIPTIONS_NOT_PERMITTED', 'Only the assigned verified psychiatrist can issue a prescription.');
    const signature = await tx.doctorSignature.findUnique({ where: { doctorId }, select: { data: true } });
    if (!signature) throw new AppError(422, 'SIGNATURE_REQUIRED', 'Upload your stamp or signature before issuing a prescription.');
    const existingPrescription = await tx.prescription.findUnique({ where: { bookingId } });
    if (existingPrescription) throw new AppError(409, 'PRESCRIPTION_ALREADY_ISSUED', 'A prescription has already been issued for this completed session.');
    const prescriptionId = crypto.randomUUID();
    const pdfData = await renderPrescriptionPdf({
      prescriptionId,
      doctor: { name: `${booking.doctor.firstName} ${booking.doctor.lastName}`, licenseNumber: booking.doctor.licenseNumber },
      clientName: booking.clientName,
      sessionStart: booking.startTime,
      medicines: input.medicines,
      instructions: input.instructions,
      signature: Buffer.from(signature.data)
    });
    const prescription = await tx.prescription.create({ data: { id: prescriptionId, bookingId, doctorId, clientId: booking.clientId, medicines: input.medicines, instructions: input.instructions ?? null, pdfData } });
    await tx.prescriptionEmail.create({ data: { prescriptionId: prescription.id } });
    const result = serializePrescription(prescription);
    await tx.idempotencyRecord.create({ data: { userId, scope: 'PRESCRIPTION_CREATE', key: idempotencyKey, requestHash, responseCode: 201, responseBody: jsonSafe(result), resourceId: prescription.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    await recordAudit({ actorId: userId, action: 'PRESCRIPTION_ISSUED', entityType: 'Prescription', entityId: prescription.id, metadata: { bookingId }, ipAddress: context.ip }, tx);
    return result;
  }, { timeout: 20_000, maxWait: 5000, retryOnTimeout: true });
  void processPrescriptionEmails();
  return response;
}

export async function getPrescriptionPdf(doctorId, prescriptionId) {
  const prescription = await prisma.prescription.findFirst({ where: { id: prescriptionId, doctorId }, select: { pdfData: true } });
  if (!prescription) throw new AppError(404, 'PRESCRIPTION_NOT_FOUND', 'Prescription not found.');
  return Buffer.from(prescription.pdfData);
}

export async function processPrescriptionEmails(db = prisma) {
  const jobs = await db.prescriptionEmail.findMany({
    where: { sentAt: null, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } },
    take: 20,
    orderBy: { nextAttemptAt: 'asc' }
  });
  for (const job of jobs) {
    const lease = new Date(Date.now() + 5 * 60_000);
    const claimed = await db.prescriptionEmail.updateMany({ where: { id: job.id, sentAt: null, attempts: job.attempts, nextAttemptAt: { lte: new Date() } }, data: { attempts: { increment: 1 }, nextAttemptAt: lease } });
    if (!claimed.count) continue;
    try {
      const prescription = await db.prescription.findUnique({
        where: { id: job.prescriptionId },
        select: {
          id: true,
          pdfData: true,
          booking: { select: {
            clientName: true,
            client: { select: { email: true, accountStatus: true } },
            doctor: { select: { firstName: true, lastName: true } }
          } }
        }
      });
      const recipient = prescription?.booking.client;
      if (!prescription || recipient?.accountStatus !== 'ACTIVE') {
        await db.prescriptionEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
        continue;
      }
      await sendPrescriptionEmail({ email: recipient.email, clientName: prescription.booking.clientName, doctorName: `${prescription.booking.doctor.firstName} ${prescription.booking.doctor.lastName}`, prescriptionId: prescription.id, pdf: Buffer.from(prescription.pdfData) });
      await db.prescriptionEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
    } catch {
      logger.warn({ prescriptionEmailId: job.id, attempt: job.attempts + 1, exhausted: job.attempts + 1 >= 10 }, 'Prescription email failed; retry queued unless exhausted');
      await db.prescriptionEmail.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** job.attempts)) } });
    }
  }
}
