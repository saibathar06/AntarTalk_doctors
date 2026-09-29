import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma.js';
import { sendBookingEmail } from '../lib/mailer.js';
import { logger } from '../lib/logger.js';

const displayTime = (value, minutes) => {
  const start = DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'Asia/Kolkata' });
  return `${start.toFormat('dd LLL yyyy, hh:mm a')} – ${start.plus({ minutes }).toFormat('hh:mm a')} IST`;
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function emailShell({ eyebrow, title, description, rows, tone = 'success' }) {
  const accent = tone === 'danger' ? '#f7256f' : '#0d9794';
  const icon = tone === 'danger' ? '!' : '&#10003;';
  const details = rows.map(([label, value]) => `<tr>
    <td style="padding:14px 0;border-bottom:1px solid #e7ebf0;color:#718096;font-size:14px;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:14px 0;border-bottom:1px solid #e7ebf0;color:#172033;font-size:14px;font-weight:700;text-align:right;vertical-align:top">${escapeHtml(value)}</td>
  </tr>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#fff8fb;font-family:Arial,Helvetica,sans-serif;color:#172033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff8fb;padding:28px 12px"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;background:#ffffff;border:1px solid #e7ebf0;border-radius:20px">
        <tr><td style="padding:44px 42px 38px">
          <div style="text-align:center">
            <div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:50%;background:${accent};color:#ffffff;font-size:30px;font-weight:700;text-align:center">${icon}</div>
            <p style="margin:28px 0 14px;color:#078b8b;font-size:12px;font-weight:700;letter-spacing:3px">${escapeHtml(eyebrow)}</p>
            <h1 style="margin:0;color:#172033;font-size:30px;line-height:1.25">${escapeHtml(title)}</h1>
            <p style="margin:16px auto 28px;max-width:500px;color:#718096;font-size:15px;line-height:1.6">${escapeHtml(description)}</p>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${details}</table>
          <p style="margin:30px 0 0;color:#8793a5;font-size:12px;line-height:1.6;text-align:center">This is an automated message from AntarTalk. Please keep the booking ID for reference.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export function bookingEmailHtml(booking, audience, kind = 'CONFIRMATION', eventData = {}) {
  const start = DateTime.fromJSDate(booking.startTime, { zone: 'Asia/Kolkata' });
  const date = start.toFormat('cccc, dd LLLL yyyy');
  const time = `${start.toFormat('hh:mm a')} – ${start.plus({ minutes: booking.sessionDurationMinutes }).toFormat('hh:mm a')} IST`;
  const doctorName = `Dr. ${booking.doctor.firstName} ${booking.doctor.lastName}`;
  if (kind === 'CONFIRMATION' && audience === 'CLIENT') return emailShell({
    eyebrow: 'BOOKING CONFIRMED', title: 'Session booked successfully',
    description: 'Your appointment is confirmed by AntarTalk’s booking service.',
    rows: [
      ['Professional', doctorName], ['Date', date], ['Therapy time', time],
      ['Session length', `Up to ${booking.sessionDurationMinutes} minutes`],
      ['Amount paid', `${booking.payment.currency} ${booking.payment.amount.toString()}`],
      ['Booking ID', booking.id], ['Payment status', 'Successful payment accepted'], ['Booking status', booking.status]
    ]
  });
  if (kind === 'CONFIRMATION') return emailShell({
    eyebrow: 'NEW SESSION CONFIRMED', title: 'A client booked a session',
    description: 'The appointment has been confirmed and added to your AntarTalk schedule.',
    rows: [
      ['Client', booking.clientName || 'Client'], ['Age', booking.clientAge ?? 'Not available'],
      ['Date', date], ['Therapy time', time], ['Booking ID', booking.id], ['Booking status', booking.status]
    ]
  });
  if (kind === 'CANCELLATION') {
    const byDoctor = eventData.cancelledBy === 'DOCTOR';
    return emailShell({
      eyebrow: 'SESSION CANCELLED', title: 'Your session was cancelled', tone: 'danger',
      description: audience === 'CLIENT' && byDoctor
        ? 'The professional cancelled this appointment. A full refund has been initiated.'
        : 'This appointment is no longer scheduled.',
      rows: [
        [audience === 'CLIENT' ? 'Professional' : 'Client', audience === 'CLIENT' ? doctorName : booking.clientName || 'Client'],
        ['Date', date], ['Therapy time', time], ['Cancelled by', byDoctor ? 'Professional' : 'Client'],
        ...(audience === 'CLIENT' && byDoctor ? [['Refund', `${booking.payment.currency} ${booking.payment.amount.toString()} initiated`]] : []),
        ...(audience === 'CLIENT' && !byDoctor ? [['Refund', 'Not applicable under the client cancellation policy']] : []),
        ['Booking ID', booking.id], ['Booking status', 'CANCELLED']
      ]
    });
  }
  const proposed = eventData.proposedStartTime ? displayTime(eventData.proposedStartTime, booking.sessionDurationMinutes) : null;
  const oldTime = eventData.oldStartTime ? displayTime(eventData.oldStartTime, booking.sessionDurationMinutes) : null;
  const content = kind === 'RESCHEDULE_REQUESTED'
    ? { eyebrow: 'RESCHEDULE REQUESTED', title: 'A new appointment time was requested', description: 'The original appointment remains confirmed until the request is approved.', rows: [['Current time', time], ['Requested time', proposed], ['Booking ID', booking.id]] }
    : kind === 'RESCHEDULED'
      ? { eyebrow: 'SESSION RESCHEDULED', title: 'Your appointment time has changed', description: 'Please use the updated appointment details below.', rows: [['Previous time', oldTime || 'Previous appointment time'], ['New date', date], ['New therapy time', time], ['Booking ID', booking.id], ['Booking status', 'CONFIRMED']] }
      : { eyebrow: 'RESCHEDULE DECLINED', title: 'The original appointment remains confirmed', description: 'The requested change was not approved.', rows: [['Date', date], ['Therapy time', time], ['Booking ID', booking.id], ['Booking status', 'CONFIRMED']] };
  return emailShell(content);
}

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
        email: recipient.email,
        text: bookingEmailText(booking, job.audience, job.kind, job.eventData ?? {}),
        html: bookingEmailHtml(booking, job.audience, job.kind, job.eventData ?? {}),
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
