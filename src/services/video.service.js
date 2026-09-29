import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

function configuration() {
  if (!env.VIDEO_SERVICE_URL || !env.VIDEO_SERVICE_API_KEY) {
    throw new AppError(503, 'VIDEO_NOT_CONFIGURED', 'Video calling is not configured yet.');
  }
  return { origin: new URL(env.VIDEO_SERVICE_URL).origin, apiKey: env.VIDEO_SERVICE_API_KEY };
}

async function videoRequest(path, body) {
  const { origin, apiKey } = configuration();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), env.VIDEO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, `${origin}/`), {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      logger.warn({ status: response.status, path, providerCode: payload?.code ?? 'UNKNOWN' }, 'Video service request rejected');
      throw new AppError(502, 'VIDEO_SERVICE_UNAVAILABLE', 'Video calling is temporarily unavailable.');
    }
    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn({ errorType: error?.name ?? 'Error', path }, 'Video service request failed');
    throw new AppError(502, 'VIDEO_SERVICE_UNAVAILABLE', 'Video calling is temporarily unavailable.');
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function bookingForVideo(bookingId, db = prisma) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, clientId: true, status: true, startTime: true, endTime: true, sessionDurationMinutes: true,
      doctor: { select: { userId: true } },
      videoCall: true
    }
  });
  if (!booking) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  return booking;
}

export async function provisionVideoCall(bookingId, db = prisma) {
  const booking = await bookingForVideo(bookingId, db);
  if (booking.status !== 'CONFIRMED') throw new AppError(409, 'SESSION_NOT_JOINABLE', 'Only confirmed sessions can use video calling.');
  if (!booking.videoCall) throw new AppError(409, 'VIDEO_SESSION_NOT_READY', 'The video session has not been prepared.');
  if (['ENDED', 'CANCELLED'].includes(booking.videoCall.state)) throw new AppError(409, 'VIDEO_SESSION_ENDED', 'This video session has ended.');
  if (booking.videoCall.state === 'SCHEDULED' && booking.videoCall.serviceSessionId) return booking.videoCall;

  const payload = await videoRequest('/v1/sessions', {
    appointmentId: booking.id,
    doctorId: booking.doctor.userId,
    clientId: booking.clientId,
    opensAt: booking.videoCall.opensAt.toISOString(),
    closesAt: booking.videoCall.closesAt.toISOString()
  });
  if (!payload?.sessionId) throw new AppError(502, 'VIDEO_SERVICE_INVALID_RESPONSE', 'Video calling is temporarily unavailable.');
  return db.videoCall.update({
    where: { bookingId },
    data: { serviceSessionId: String(payload.sessionId), state: 'SCHEDULED', lastErrorCode: null },
  });
}

function assertJoinWindow(videoCall, now = new Date()) {
  if (now < videoCall.opensAt || now >= videoCall.closesAt) {
    throw new AppError(403, 'OUTSIDE_JOIN_WINDOW', 'Join access is limited to the configured early window and therapy period.');
  }
}

export async function createVideoTicket({ bookingId, userId, audience, surface = 'WEB', now = new Date() }) {
  let booking = await bookingForVideo(bookingId);
  const isDoctor = booking.doctor.userId === userId;
  const isClient = booking.clientId === userId;
  if (!isDoctor && !isClient) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  if ((audience === 'DOCTOR' && !isDoctor) || (audience === 'CLIENT' && !isClient)) {
    throw new AppError(403, 'FORBIDDEN', 'This session does not belong to your account.');
  }
  if (booking.status !== 'CONFIRMED') throw new AppError(409, 'SESSION_NOT_JOINABLE', 'Only confirmed sessions can be joined.');
  if (!booking.videoCall) throw new AppError(409, 'VIDEO_SESSION_NOT_READY', 'The video session has not been prepared.');
  if (['ENDED', 'CANCELLED'].includes(booking.videoCall.state)) throw new AppError(409, 'VIDEO_SESSION_ENDED', 'This video session has ended.');
  assertJoinWindow(booking.videoCall, now);

  if (booking.videoCall.state !== 'SCHEDULED' || !booking.videoCall.serviceSessionId) {
    await provisionVideoCall(bookingId);
    booking = await bookingForVideo(bookingId);
  }
  const parentOrigin = surface === 'WEB' ? (audience === 'DOCTOR' ? env.DOCTOR_WEB_ORIGIN : env.CLIENT_WEB_ORIGIN) : null;
  const payload = await videoRequest(`/v1/sessions/${encodeURIComponent(booking.videoCall.serviceSessionId)}/tickets`, {
    userId,
    ...(parentOrigin ? { parentOrigin: new URL(parentOrigin).origin } : {})
  });
  if (!payload?.launchUrl || !payload?.expiresAt) throw new AppError(502, 'VIDEO_SERVICE_INVALID_RESPONSE', 'Video calling is temporarily unavailable.');
  const launch = new URL(payload.launchUrl);
  const videoOrigin = new URL(env.VIDEO_SERVICE_URL).origin;
  if (launch.origin !== videoOrigin || launch.pathname !== '/call') {
    throw new AppError(502, 'VIDEO_SERVICE_INVALID_RESPONSE', 'Video calling is temporarily unavailable.');
  }
  return { bookingId, launchUrl: launch.toString(), expiresAt: payload.expiresAt, videoOrigin };
}

export async function processVideoProvisioning(db = prisma) {
  if (!env.VIDEO_SERVICE_URL || !env.VIDEO_SERVICE_API_KEY) return;
  const expired = await db.videoCall.findMany({
    where: { state: 'SCHEDULED', closesAt: { lte: new Date() } },
    select: { bookingId: true }, take: 25, orderBy: { closesAt: 'asc' }
  });
  for (const call of expired) {
    try { await endVideoCall(call.bookingId, 'ended', db); }
    catch (error) { logger.warn({ bookingId: call.bookingId, errorCode: error.code ?? 'VIDEO_ERROR' }, 'Expired video session cleanup failed'); }
  }
  const jobs = await db.videoCall.findMany({
    where: { state: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() }, booking: { status: 'CONFIRMED' } },
    select: { id: true, bookingId: true, attempts: true }, take: 25, orderBy: { nextAttemptAt: 'asc' }
  });
  for (const job of jobs) {
    const claimed = await db.videoCall.updateMany({
      where: { id: job.id, state: { in: ['PENDING', 'FAILED'] }, attempts: job.attempts, nextAttemptAt: { lte: new Date() } },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) }
    });
    if (!claimed.count) continue;
    try {
      await provisionVideoCall(job.bookingId, db);
    } catch (error) {
      await db.videoCall.update({
        where: { id: job.id },
        data: { state: 'FAILED', lastErrorCode: error.code ?? 'VIDEO_SERVICE_UNAVAILABLE', nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** job.attempts)) }
      });
      logger.warn({ videoCallId: job.id, attempt: job.attempts + 1, errorCode: error.code ?? 'VIDEO_ERROR' }, 'Video session provisioning failed');
    }
  }
}

export async function endVideoCall(bookingId, state = 'ended', db = prisma) {
  const booking = await bookingForVideo(bookingId, db);
  if (!booking.videoCall?.serviceSessionId) return;
  await videoRequest(`/v1/sessions/${encodeURIComponent(booking.videoCall.serviceSessionId)}/end`, { state });
  await db.videoCall.update({ where: { bookingId }, data: { state: state === 'cancelled' ? 'CANCELLED' : 'ENDED' } });
}
