import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../errors/AppError.js';

export async function registerDevice(userId, input) {
  return prisma.pushDevice.upsert({
    where: { token: input.token },
    create: { userId, token: input.token, platform: input.platform },
    update: { userId, platform: input.platform, isActive: true },
    select: { id: true, platform: true, isActive: true, createdAt: true, updatedAt: true }
  });
}

export async function unregisterDevice(userId, id) {
  const result = await prisma.pushDevice.updateMany({ where: { id, userId }, data: { isActive: false } });
  if (!result.count) throw new AppError(404, 'PUSH_DEVICE_NOT_FOUND', 'Notification device not found.');
}

export async function listNotifications(userId, { page, limit, unreadOnly }) {
  const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } })
  ]);
  return { items, unread, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function markRead(userId, id) {
  const result = await prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  if (!result.count) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  return { read: true };
}

async function createNotification(tx, userId, content) {
  const notification = await tx.notification.create({ data: { userId, ...content } });
  const devices = await tx.pushDevice.findMany({ where: { userId, isActive: true }, select: { id: true } });
  if (devices.length) await tx.pushDelivery.createMany({ data: devices.map((device) => ({ notificationId: notification.id, deviceId: device.id })) });
  return notification;
}

export async function enqueueBookingEventNotifications(tx, booking, doctor, kind, eventData = {}, audiences = ['CLIENT', 'DOCTOR']) {
  const start = DateTime.fromJSDate(booking.startTime, { zone: 'Asia/Kolkata' }).toFormat('dd LLL, hh:mm a');
  const proposed = eventData.proposedStartTime
    ? DateTime.fromISO(eventData.proposedStartTime, { zone: 'utc' }).setZone('Asia/Kolkata').toFormat('dd LLL, hh:mm a')
    : start;
  const content = {
    CANCELLATION: {
      CLIENT: { type: 'SESSION_CANCELLED', title: 'Session cancelled', body: eventData.cancelledBy === 'DOCTOR' ? `Your ${start} session was cancelled by the professional. A full refund has been initiated.` : `Your ${start} session has been cancelled.` },
      DOCTOR: { type: 'SESSION_CANCELLED', title: 'Session cancelled', body: eventData.cancelledBy === 'DOCTOR' ? `You cancelled the ${start} session.` : `The client cancelled the ${start} session.` }
    },
    RESCHEDULE_REQUESTED: {
      CLIENT: { type: 'RESCHEDULE_REQUESTED', title: 'Reschedule requested', body: `Your request to move the session to ${proposed} was sent to Dr. ${doctor.firstName} ${doctor.lastName}.` },
      DOCTOR: { type: 'RESCHEDULE_REQUESTED', title: 'Reschedule request', body: `${booking.clientName || 'A client'} requested ${proposed}.` }
    },
    RESCHEDULED: {
      CLIENT: { type: 'SESSION_RESCHEDULED', title: 'Session rescheduled', body: `Your session with Dr. ${doctor.firstName} ${doctor.lastName} is now scheduled for ${start}.` },
      DOCTOR: { type: 'SESSION_RESCHEDULED', title: 'Session rescheduled', body: `The session with ${booking.clientName || 'your client'} is now scheduled for ${start}.` }
    },
    RESCHEDULE_REJECTED: {
      CLIENT: { type: 'RESCHEDULE_REJECTED', title: 'Reschedule request declined', body: `Your session remains scheduled for ${start}.` },
      DOCTOR: { type: 'RESCHEDULE_REJECTED', title: 'Request declined', body: `The session remains scheduled for ${start}.` }
    }
  };
  for (const audience of audiences) {
    const item = content[kind]?.[audience];
    if (!item) continue;
    const userId = audience === 'CLIENT' ? booking.clientId : doctor.userId;
    await createNotification(tx, userId, {
      ...item,
      data: { bookingId: booking.id, startTime: booking.startTime.toISOString(), route: audience === 'CLIENT' ? `/bookings/${booking.id}` : `/doctor/appointments/${booking.id}` }
    });
  }
}

export async function enqueueBookingNotifications(tx, booking, doctor) {
  const start = DateTime.fromJSDate(booking.startTime, { zone: 'Asia/Kolkata' }).toFormat('dd LLL, hh:mm a');
  await createNotification(tx, booking.clientId, {
    type: 'SESSION_BOOKED', title: 'Session booked',
    body: `Your session with Dr. ${doctor.firstName} ${doctor.lastName} is confirmed for ${start}.`,
    data: { bookingId: booking.id, startTime: booking.startTime.toISOString(), route: `/bookings/${booking.id}` }
  });
  await createNotification(tx, doctor.userId, {
    type: 'SESSION_BOOKED', title: 'New session booked',
    body: `A session with ${booking.clientName || 'a client'} is confirmed for ${start}.`,
    data: { bookingId: booking.id, startTime: booking.startTime.toISOString(), route: `/doctor/appointments/${booking.id}` }
  });
}

async function sendExpo(message) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {})
      },
      body: JSON.stringify(message)
    });
    if (!response.ok) throw new Error('EXPO_HTTP_ERROR');
    const payload = await response.json();
    const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (ticket?.status !== 'ok') {
      throw Object.assign(new Error('EXPO_TICKET_ERROR'), { expoCode: ticket?.details?.error });
    }
  } finally { globalThis.clearTimeout(timeout); }
}

export async function processPushDeliveries(db = prisma) {
  if (!env.PUSH_DELIVERY_ENABLED) return;
  const jobs = await db.pushDelivery.findMany({
    where: { sentAt: null, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() }, device: { isActive: true } },
    include: { device: true, notification: true }, take: 50, orderBy: { nextAttemptAt: 'asc' }
  });
  for (const job of jobs) {
    const claimed = await db.pushDelivery.updateMany({
      where: { id: job.id, sentAt: null, attempts: job.attempts, nextAttemptAt: { lte: new Date() } },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60000) }
    });
    if (!claimed.count) continue;
    try {
      await sendExpo({ to: job.device.token, title: job.notification.title, body: job.notification.body, data: job.notification.data, sound: 'default' });
      await db.pushDelivery.update({ where: { id: job.id }, data: { sentAt: new Date() } });
    } catch (error) {
      const providerCode = /** @type {{ expoCode?: string }} */ (error).expoCode;
      if (providerCode === 'DeviceNotRegistered') await db.pushDevice.update({ where: { id: job.deviceId }, data: { isActive: false } });
      await db.pushDelivery.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)) } });
      logger.warn({ deliveryId: job.id, attempt: job.attempts + 1, providerCode: providerCode ?? 'PUSH_ERROR' }, 'Push notification delivery failed');
    }
  }
}
