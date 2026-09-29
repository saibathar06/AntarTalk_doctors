import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma.js';
import { sendBookingEmail } from '../lib/mailer.js';
import { logger } from '../lib/logger.js';

const displayTime = (value, minutes) => {
  const start = DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'Asia/Kolkata' });
  return `${start.toFormat('dd LLL yyyy, hh:mm a')} – ${start.plus({ minutes }).toFormat('hh:mm a')} IST`;
};

export function bookingEmailText(booking, audience, kind = 'CONFIRMATION', eventData = {}) {
  const start = DateTime.fromJSDate(booking.startTime, { zone: 'Asia/Kolkata' });
  const time = `${start.toFormat('dd LLL yyyy, hh:mm a')} – ${start.plus({ minutes: booking.sessionDurationMinutes }).toFormat('hh:mm a')} IST`;
  if (kind === 'CANCELLATION') {
    const byDoctor = eventData.cancelledBy === 'DOCTOR';
    if (audience === 'CLIENT') return byDoctor
      ? `Your AntarTalk session has been cancelled by the professional.\nTime: ${time}\nA full refund of ${booking.payment.currency} ${booking.payment.amount.toString()} has been initiated to your original payment method.\nBooking ID: ${booking.id}`
      : `Your AntarTalk session has been cancelled.\nTime: ${time}\nUnder the client cancellation policy, the consultation payment is not refunded.\nBooking ID: ${booking.id}`;
    return `The AntarTalk session has been cancelled.\nTime: ${time}\nCancelled by: ${byDoctor ? 'You' : 'Client'}${eventData.penaltyAmount ? `\nSame-day cancellation adjustment: ${booking.payment.currency} ${eventData.penaltyAmount}` : ''}\nBooking ID: ${booking.id}`;
  }
  if (kind === 'RESCHEDULE_REQUESTED') {
    const proposed = displayTime(eventData.proposedStartTime, booking.sessionDurationMinutes);
    return audience === 'DOCTOR'
      ? `A client requested to reschedule an AntarTalk session.\nCurrent time: ${time}\nRequested time: ${proposed}\nClient: ${booking.clientName || 'Not provided'}\nBooking ID: ${booking.id}`
      : `Your reschedule request was sent to Dr. ${booking.doctor.firstName} ${booking.doctor.lastName}.\nCurrent time: ${time}\nRequested time: ${proposed}\nThe original appointment remains confirmed until the professional approves.\nBooking ID: ${booking.id}`;
  }
  if (kind === 'RESCHEDULED') {
    const oldTime = eventData.oldStartTime ? displayTime(eventData.oldStartTime, booking.sessionDurationMinutes) : 'Previous appointment time';
    return `Your AntarTalk session has been rescheduled.\nPrevious time: ${oldTime}\nNew time: ${time}\nProfessional: ${booking.doctor.firstName} ${booking.doctor.lastName}\nBooking ID: ${booking.id}`;
  }
  if (kind === 'RESCHEDULE_REJECTED') {
    return `The requested appointment change was not approved.\nYour original session remains confirmed for ${time}.\nBooking ID: ${booking.id}`;
  }
  if (audience === 'DOCTOR') {
    return `Your AntarTalk session is confirmed.\nTime: ${time}\nClient: ${booking.clientName || 'Not provided'}\nAge: ${booking.clientAge ?? 'Not provided'}`;
  }
  return `Your AntarTalk session is confirmed.\nProfessional: ${booking.doctor.firstName} ${booking.doctor.lastName}\nTime: ${time}\nSession: up to ${booking.sessionDurationMinutes} minutes\nAmount paid: ${booking.payment.currency} ${booking.payment.amount.toString()}\nBooking ID: ${booking.id}`;
}

// Leases coordinate workers across instances. SMTP is at-least-once: a crash after
// delivery but before sentAt may resend, using the same stable Message-ID.
export async function processBookingEmails(db = prisma) {
  const jobs = await db.bookingEmail.findMany({
    where: { sentAt: null, attempts: { lt: 10 }, nextAttemptAt: { lte: new Date() } },
    take: 20, orderBy: { nextAttemptAt: 'asc' }
  });
  for (const job of jobs) {
    const lease = new Date(Date.now() + 5 * 60_000);
    const claimed = await db.bookingEmail.updateMany({
      where: { id: job.id, sentAt: null, attempts: job.attempts, nextAttemptAt: { lte: new Date() } },
      data: { attempts: { increment: 1 }, nextAttemptAt: lease }
    });
    if (!claimed.count) continue;
    try {
      const booking = await db.booking.findUnique({
        where: { id: job.bookingId },
        select: {
          id: true, status: true, startTime: true, sessionDurationMinutes: true, clientName: true, clientAge: true,
          client: { select: { email: true, accountStatus: true } },
          doctor: { select: { firstName: true, lastName: true, user: { select: { email: true, accountStatus: true } } } },
          payment: { select: { currency: true, amount: true } }
        }
      });
      const recipient = job.audience === 'CLIENT' ? booking?.client : booking?.doctor.user;
      const expectedStatus = job.kind === 'CANCELLATION' ? 'CANCELLED' : 'CONFIRMED';
      if (!booking || booking.status !== expectedStatus || recipient?.accountStatus !== 'ACTIVE') {
        await db.bookingEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
        continue;
      }
      await sendBookingEmail({
        email: recipient.email, text: bookingEmailText(booking, job.audience, job.kind, job.eventData ?? {}),
        subject: job.kind === 'CONFIRMATION' ? 'Your AntarTalk session is confirmed'
          : job.kind === 'CANCELLATION' ? 'Your AntarTalk session was cancelled'
            : job.kind === 'RESCHEDULE_REQUESTED' ? 'AntarTalk reschedule request'
              : job.kind === 'RESCHEDULED' ? 'Your AntarTalk session was rescheduled'
                : 'AntarTalk reschedule update',
        messageId: `<booking-${job.id}@antartalk.com>`
      });
      await db.bookingEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
    } catch {
      logger.warn({ jobId: job.id, attempt: job.attempts + 1, exhausted: job.attempts + 1 >= 10 }, 'Booking confirmation email failed; retry queued unless exhausted');
      await db.bookingEmail.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)) } });
    }
  }
}
