import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma.js';
import { sendBookingEmail } from '../lib/mailer.js';
import { logger } from '../lib/logger.js';

export function bookingEmailText(booking, audience) {
  const start = DateTime.fromJSDate(booking.startTime, { zone: 'Asia/Kolkata' });
  const time = `${start.toFormat('dd LLL yyyy, hh:mm a')} – ${start.plus({ minutes: booking.sessionDurationMinutes }).toFormat('hh:mm a')} IST`;
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
      if (!booking || booking.status !== 'CONFIRMED' || recipient?.accountStatus !== 'ACTIVE') {
        await db.bookingEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
        continue;
      }
      await sendBookingEmail({
        email: recipient.email, text: bookingEmailText(booking, job.audience),
        messageId: `<booking-${job.id}@antartalk.com>`
      });
      await db.bookingEmail.update({ where: { id: job.id }, data: { sentAt: new Date() } });
    } catch {
      logger.warn({ jobId: job.id, attempt: job.attempts + 1, exhausted: job.attempts + 1 >= 10 }, 'Booking confirmation email failed; retry queued unless exhausted');
      await db.bookingEmail.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)) } });
    }
  }
}
