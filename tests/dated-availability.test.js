import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  doctorProfile: { findUnique: vi.fn(), update: vi.fn() },
  doctorWorkingHour: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(async () => []) }
} }));
vi.mock('../src/services/transaction.service.js', async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  return { serialTransaction: (work) => work(prisma), lockUser: vi.fn(), lockDoctor: vi.fn() };
});
vi.mock('../src/services/audit.service.js', () => ({ recordAudit: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { replaceWorkingHours, savePresets } from '../src/services/availability.service.js';
import { presetsSchema } from '../src/validation/doctor.schemas.js';
import { generateCandidateWindows } from '../src/services/slot.service.js';
const window = { dayOfWeek: 1, availableDate: '2030-01-07', startTime: '09:00', endTime: '15:00', isActive: true };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-07T00:00Z'));
  prisma.doctorProfile.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED' });
});
afterEach(() => vi.useRealTimers());
describe('dated availability and favorite ranges', () => {
  it('persists an explicit date, not a repeating weekday', async () => {
    await replaceWorkingHours('user', 'doctor', { timezone: 'Asia/Kolkata', windows: [window] });
    expect(prisma.doctorWorkingHour.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ availableDate: new Date('2030-01-07'), dayOfWeek: 1 })] });
  });
  it.each(['2030-01-06', '2030-01-14'])('rejects a date outside seven days: %s', async (availableDate) => {
    await expect(replaceWorkingHours('user', 'doctor', { timezone: 'Asia/Kolkata', windows: [{ ...window, availableDate }] })).rejects.toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
    expect(prisma.doctorWorkingHour.deleteMany).not.toHaveBeenCalled();
  });
  it('rejects the final date spilling outside the booking window', async () => {
    await expect(replaceWorkingHours('user', 'doctor', { timezone: 'Asia/Kolkata', windows: [{ ...window, dayOfWeek: 7, availableDate: '2030-01-13', startTime: '23:00', endTime: '03:00' }] })).rejects.toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
  });
  it('detects overlapping overnight ranges on adjacent dates', async () => {
    await expect(replaceWorkingHours('user', 'doctor', { timezone: 'Asia/Kolkata', windows: [
      { ...window, startTime: '23:00', endTime: '03:00' },
      { ...window, dayOfWeek: 2, availableDate: '2030-01-08', startTime: '02:00', endTime: '04:00' }
    ] })).rejects.toMatchObject({ code: 'OVERLAPPING_WORKING_HOURS' });
  });
  it('does not repeat an expired dated range the following week', () => {
    const profile = { timezone: 'Asia/Kolkata', workingHours: [{ ...window, availableDate: new Date(window.availableDate), startTime: new Date('1970-01-01T09:00Z'), endTime: new Date('1970-01-01T15:00Z') }] };
    expect(generateCandidateWindows(profile, new Date('2030-01-07'), new Date('2030-01-08'))).toHaveLength(6);
    expect(generateCandidateWindows(profile, new Date('2030-01-14'), new Date('2030-01-15'))).toHaveLength(0);
  });
  it('saves a favorite without publishing working hours', async () => {
    const presets = [{ label: 'Daytime', startTime: '09:00', endTime: '15:00' }];
    expect(presetsSchema.safeParse({ body: { presets } }).success).toBe(true);
    await savePresets('user', 'doctor', presets);
    expect(prisma.doctorProfile.update).toHaveBeenCalledWith({ where: { id: 'doctor' }, data: { availabilityPresets: presets } });
    expect(prisma.doctorWorkingHour.createMany).not.toHaveBeenCalled();
  });
  it('does not let an unverified doctor save favorites', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ verificationStatus: 'PENDING' });
    await expect(savePresets('user', 'doctor', [])).rejects.toMatchObject({ code: 'DOCTOR_NOT_VERIFIED' });
  });
});
