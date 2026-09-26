import { beforeAll, describe, expect, it } from 'vitest';

let generateCandidateWindows;
beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(32);
  process.env.OTP_PEPPER ??= 'c'.repeat(32);
  ({ generateCandidateWindows } = await import('../src/services/slot.service.js'));
});

describe('dynamic slot generation', () => {
  it('creates hourly windows for availability that crosses midnight', () => {
    const profile = {
      timezone: 'UTC',
      workingHours: [{ dayOfWeek: 1, startTime: new Date('1970-01-01T20:00:00Z'), endTime: new Date('1970-01-01T01:00:00Z') }]
    };
    const slots = generateCandidateWindows(profile, new Date('2026-09-21T00:00:00Z'), new Date('2026-09-22T06:00:00Z'));
    expect(slots.map((slot) => slot.startTime.toISOString())).toEqual([
      '2026-09-21T20:00:00.000Z', '2026-09-21T21:00:00.000Z', '2026-09-21T22:00:00.000Z',
      '2026-09-21T23:00:00.000Z', '2026-09-22T00:00:00.000Z'
    ]);
  });

  it('does not create a partial trailing appointment window', () => {
    const profile = {
      timezone: 'UTC',
      workingHours: [{ dayOfWeek: 1, startTime: new Date('1970-01-01T18:00:00Z'), endTime: new Date('1970-01-01T20:30:00Z') }]
    };
    const slots = generateCandidateWindows(profile, new Date('2026-09-21T00:00:00Z'), new Date('2026-09-22T00:00:00Z'));
    expect(slots).toHaveLength(2);
  });
  it('converts Kolkata local overnight hours to UTC', () => {
    const slots = generateCandidateWindows({
      timezone: 'Asia/Kolkata',
      workingHours: [{ dayOfWeek: 1, startTime: new Date('1970-01-01T23:00Z'), endTime: new Date('1970-01-01T03:00Z') }]
    }, new Date('2026-09-21T00:00Z'), new Date('2026-09-22T00:00Z'));
    expect(slots).toHaveLength(4);
    expect(slots[0].startTime.toISOString()).toBe('2026-09-21T17:30:00.000Z');
  });
  it('skips nonexistent spring-forward boundary times', () => {
    const slots = generateCandidateWindows({
      timezone: 'America/New_York',
      workingHours: [{ dayOfWeek: 7, startTime: new Date('1970-01-01T02:30Z'), endTime: new Date('1970-01-01T05:00Z') }]
    }, new Date('2026-03-08T00:00Z'), new Date('2026-03-09T00:00Z'));
    expect(slots).toHaveLength(0);
  });
  it('skips ambiguous fall-back boundary times', () => {
    const slots = generateCandidateWindows({
      timezone: 'America/New_York',
      workingHours: [{ dayOfWeek: 7, startTime: new Date('1970-01-01T01:30Z'), endTime: new Date('1970-01-01T04:00Z') }]
    }, new Date('2026-11-01T00:00Z'), new Date('2026-11-02T00:00Z'));
    expect(slots).toHaveLength(0);
  });
});
