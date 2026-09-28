import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/lib/mailer.js', () => ({ sendBookingEmail: vi.fn() }));
import { bookingEmailText, processBookingEmails } from '../src/services/bookingEmail.service.js';
import { sendBookingEmail } from '../src/lib/mailer.js';
const booking = {
  id: 'booking', status: 'CONFIRMED', startTime: new Date('2030-01-07T04:30Z'), sessionDurationMinutes: 40,
  clientName: 'Example Client', clientAge: 28,
  client: { accountStatus: 'ACTIVE', email: 'client@example.test' },
  doctor: { firstName: 'Asha', lastName: 'Sharma', user: { accountStatus: 'ACTIVE', email: 'doctor@example.test' } },
  payment: { currency: 'INR', amount: '1200.00' }
};
beforeEach(() => vi.resetAllMocks());
describe('booking confirmation emails', () => {
  it('client receipt uses payment amount and session times in IST, not buffer time', () => {
    const text = bookingEmailText(booking, 'CLIENT');
    expect(text).toContain('Asha Sharma');
    expect(text).toContain('INR 1200.00');
    expect(text).toContain('10:00 AM – 10:40 AM IST');
    expect(text).not.toContain('buffer');
  });
  it('doctor email contains only session time, client name and age', () => {
    const text = bookingEmailText(booking, 'DOCTOR');
    expect(text).toContain('Example Client');
    expect(text).toContain('Age: 28');
    expect(text).not.toContain('1200');
    expect(text).not.toContain('client@example.test');
  });
  function database(count = 1) {
    return {
      bookingEmail: { findMany: vi.fn(async () => [{ id: 'job', bookingId: 'booking', audience: 'CLIENT', attempts: 0 }]), updateMany: vi.fn(async () => ({ count })), update: vi.fn() },
      booking: { findUnique: vi.fn(async () => booking) }
    };
  }
  it('marks a claimed delivery complete only after SMTP succeeds', async () => {
    const db = database();
    await processBookingEmails(db);
    expect(sendBookingEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'client@example.test', messageId: '<booking-job@antartalk.com>' }));
    expect(db.bookingEmail.update).toHaveBeenCalledWith({ where: { id: 'job' }, data: { sentAt: expect.any(Date) } });
  });
  it('does not send a job claimed by a concurrent worker', async () => {
    await processBookingEmails(database(0));
    expect(sendBookingEmail).not.toHaveBeenCalled();
  });
  it('schedules a retry on SMTP failure without marking delivery successful', async () => {
    sendBookingEmail.mockRejectedValue(new Error('offline'));
    const db = database();
    await processBookingEmails(db);
    expect(db.bookingEmail.update).toHaveBeenCalledWith({ where: { id: 'job' }, data: { nextAttemptAt: expect.any(Date) } });
  });
});
