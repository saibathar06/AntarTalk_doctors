import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';

// Use ONLY a disposable, already-migrated database and dedicated Redis DB.
const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL && process.env.INTEGRATION_REDIS_URL);
describe.skipIf(!enabled)('real PostgreSQL and Redis concurrency', () => {
  let db, redis, doctor, otherDoctor, client, otherClient, doctorUser, otherDoctorUser;
  let reserveSlot, confirmBooking, reservationKey;
  const start = new Date('2035-01-01T14:00:00Z');
  const end = new Date('2035-01-01T15:00:00Z');
  const prefix = crypto.randomUUID();
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
    process.env.REDIS_URL = process.env.INTEGRATION_REDIS_URL;
    ({ prisma: db } = await import('../src/lib/prisma.js'));
    ({ redis } = await import('../src/lib/redis.js'));
    ({ reserveSlot, reservationKey } = await import('../src/services/slot.service.js'));
    ({ confirmBooking } = await import('../src/services/booking.service.js'));
    const user = (role, suffix) => db.user.create({ data: {
      email: prefix + suffix + '@example.invalid', role, passwordHash: 'unused-test-hash', emailVerifiedAt: new Date(),
      firstName: 'Integration', lastName: 'Client', dateOfBirth: new Date('2000-01-01')
    } });
    doctorUser = await user('DOCTOR', 'doctor'); otherDoctorUser = await user('DOCTOR', 'other-doctor');
    client = await user('CLIENT', 'client'); otherClient = await user('CLIENT', 'other-client');
    const profile = (owner) => db.doctorProfile.create({ data: {
      userId: owner.id, firstName: 'Test', lastName: 'Doctor', dateOfBirth: new Date('1990-01-01'),
      phoneNumber: crypto.randomBytes(16).toString('hex'), professionalCategory: 'PSYCHOLOGIST',
      professionalStatus: 'LICENSED_PROFESSIONAL', licenseNumber: crypto.randomUUID(),
      verificationStatus: 'VERIFIED', isAcceptingBookings: true, timezone: 'UTC'
    } });
    doctor = await profile(doctorUser); otherDoctor = await profile(otherDoctorUser);
    for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) await db.doctorWorkingHour.create({
      data: { doctorId: doctor.id, dayOfWeek, startTime: new Date('1970-01-01T10:00Z'), endTime: new Date('1970-01-01T20:00Z'), timezone: 'UTC' }
    });
  });
  afterAll(async () => {
    if (!doctor) return;
    const doctors = [doctor.id, otherDoctor.id], users = [client.id, otherClient.id, doctorUser.id, otherDoctorUser.id];
    await db.booking.deleteMany({ where: { doctorId: { in: doctors } } });
    await db.payment.deleteMany({ where: { clientId: { in: users } } });
    await db.idempotencyRecord.deleteMany({ where: { userId: { in: users } } });
    await db.doctorProfile.deleteMany({ where: { id: { in: doctors } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await redis.del(reservationKey(doctor.id, start));
    await Promise.all([db.$disconnect(), redis.quit()]);
  });
  const booking = (doctorId, clientId, date) => ({
    doctorId, clientId, startTime: date, endTime: new Date(+date + 3600000),
    status: 'CONFIRMED', sessionDurationMinutes: 40, bufferDurationMinutes: 20
  });
  it('excludes two clients booking one doctor concurrently', async () => {
    const results = await Promise.allSettled([
      db.booking.create({ data: booking(doctor.id, client.id, new Date('2035-01-02T14:00Z')) }),
      db.booking.create({ data: booking(doctor.id, otherClient.id, new Date('2035-01-02T14:00Z')) })
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('excludes one client booking two doctors concurrently', async () => {
    const results = await Promise.allSettled([
      db.booking.create({ data: booking(doctor.id, client.id, new Date('2035-01-03T14:00Z')) }),
      db.booking.create({ data: booking(otherDoctor.id, client.id, new Date('2035-01-03T14:00Z')) })
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects an expired deadline at database commit', async () => {
    await expect(db.booking.create({ data: {
      ...booking(doctor.id, client.id, new Date('2035-01-04T14:00Z')), reservationExpiresAt: new Date(0)
    } })).rejects.toThrow();
  });
  it('atomically reserves once and confirms simultaneous identical requests once', async () => {
    const results = await Promise.allSettled([reserveSlot(client.id, doctor.id, start), reserveSlot(otherClient.id, doctor.id, start)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const index = results.findIndex((r) => r.status === 'fulfilled');
    const owner = index === 0 ? client : otherClient;
    const reservation = results[index].value;
    const payment = await db.payment.create({ data: {
      clientId: owner.id, doctorId: doctor.id, slotStart: start, slotEnd: end,
      expectedAmount: 100, amount: 100, expectedCurrency: 'INR', currency: 'INR', doctorEarning: 80,
      status: 'SUCCEEDED', provider: 'integration-fixture', providerReference: prefix
    } });
    const body = { doctorId: doctor.id, startTime: start, reservationId: reservation.reservationId, paymentId: payment.id };
    const confirmations = await Promise.all(Array.from({ length: 5 }, () => confirmBooking(owner.id, body, prefix)));
    expect(new Set(confirmations.map((r) => r.id)).size).toBe(1);
    expect(await db.booking.count({ where: { paymentId: payment.id } })).toBe(1);
  });
});
