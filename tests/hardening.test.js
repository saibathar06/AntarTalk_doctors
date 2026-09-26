import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  booking: { findFirst: vi.fn() }
} }));
import { prisma } from '../src/lib/prisma.js';
import { joinExpiry, getSession, createJoinAccess } from '../src/services/session.service.js';
import { validatePayment } from '../src/services/payment.service.js';
import { logoutSchema } from '../src/validation/auth.schemas.js';
import { amount, currency } from '../src/validation/common.js';
import { updateProfileSchema } from '../src/validation/doctor.schemas.js';
import { encryptProviderToken } from '../src/utils/encryption.js';
import { serializeWorkingHour } from '../src/services/availability.service.js';
import jwt from 'jsonwebtoken';

const start = new Date('2030-01-01T14:00:00Z');
const booking = { id: 'booking', startTime: start, endTime: new Date('2030-01-01T15:00:00Z'), sessionDurationMinutes: 40, status: 'CONFIRMED', earning: null };
beforeEach(() => vi.clearAllMocks());
describe('therapy authorization boundaries', () => {
  it.each([-11, 40, 45, 60, 61])('rejects minute %s', (offset) => {
    expect(() => joinExpiry(booking, +start + offset * 60000)).toThrow();
  });
  it.each([-10, 0, 20, 39])('allows minute %s and expires at therapy end', (offset) => {
    expect(joinExpiry(booking, +start + offset * 60000)).toBe((+start + 40 * 60000) / 1000);
  });
  it('scopes detail lookup to the owning doctor and uses the privacy selection', async () => {
    prisma.booking.findFirst.mockResolvedValue(null);
    await expect(getSession('other-doctor', 'booking')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({ id: 'booking', doctorId: 'other-doctor' });
    expect(prisma.booking.findFirst.mock.calls[0][0].select).not.toHaveProperty('client');
  });
  it('rejects cancelled sessions', async () => {
    prisma.booking.findFirst.mockResolvedValue({ ...booking, status: 'CANCELLED' });
    await expect(createJoinAccess('doctor', 'booking')).rejects.toMatchObject({ code: 'SESSION_NOT_JOINABLE' });
  });
  it('does not issue tokens extending into the buffer', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(+start);
    prisma.booking.findFirst.mockResolvedValue(booking);
    const access = await createJoinAccess('doctor', 'booking');
    expect(jwt.decode(access.sessionAccessToken).exp).toBe((+start + 40 * 60000) / 1000);
    vi.restoreAllMocks();
  });
});
describe('payment trust boundary', () => {
  const slot = { doctorId: 'doctor', startTime: start, endTime: booking.endTime };
  const valid = { clientId: 'client', status: 'SUCCEEDED', doctorId: 'doctor', slotStart: start, slotEnd: booking.endTime, amount: new Prisma.Decimal(100), expectedAmount: new Prisma.Decimal(100), currency: 'INR', expectedCurrency: 'INR', doctorEarning: new Prisma.Decimal(80), booking: null };
  it('accepts an unused trusted priced order', () => expect(() => validatePayment(valid, 'client', slot)).not.toThrow());
  it.each([
    { clientId: 'other' }, { status: 'REFUNDED' }, { status: 'FAILED' },
    { doctorId: 'other' }, { expectedAmount: null }, { amount: new Prisma.Decimal(1) },
    { currency: 'USD' }, { slotStart: new Date('2030-01-02') }, { booking: { id: 'used' } }
  ])('rejects mismatched or consumed payment %j', (change) => {
    expect(() => validatePayment({ ...valid, ...change }, 'client', slot)).toThrow();
  });
});
describe('input and secret regressions', () => {
  it('rejects logout that would revoke nothing', () => expect(logoutSchema.safeParse({ body: {} }).success).toBe(false));
  it.each([-1, 0, Infinity, NaN, 1.001])('rejects unsafe amount %s', (value) => expect(amount.safeParse(value).success).toBe(false));
  it.each(['ABC', 'ZZZ', 'XXX', '12!'])('rejects unsupported currency %s', (value) => expect(currency.safeParse(value).success).toBe(false));
  it('normalizes INR', () => expect(currency.parse('inr')).toBe('INR'));
  it.each(['role', 'verificationStatus', 'accountStatus', 'userId'])('rejects profile mass assignment %s', (key) => {
    expect(updateProfileSchema.safeParse({ body: { [key]: 'VERIFIED' } }).success).toBe(false);
  });
  it('encrypts provider tokens with randomized authenticated encryption', () => {
    const a = encryptProviderToken('sensitive-provider-token');
    expect(a).not.toContain('sensitive-provider-token');
    expect(a).not.toBe(encryptProviderToken('sensitive-provider-token'));
    expect(a).toMatch(/^v1:/);
  });
  it('returns wall-clock HH:mm rather than Prisma date encodings', () => {
    expect(serializeWorkingHour({ startTime: new Date('1970-01-01T23:00Z'), endTime: new Date('1970-01-01T03:00Z') })).toEqual({ startTime: '23:00', endTime: '03:00' });
  });
});
