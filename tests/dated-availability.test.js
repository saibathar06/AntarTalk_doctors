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
import { replaceWorkingHours, savePresets, saveDefaultTiming } from '../src/services/availability.service.js';
import { effectiveWorkingHours, getDefaultTiming } from '../src/utils/defaultTiming.js';
import { presetsSchema } from '../src/validation/doctor.schemas.js';
import { generateCandidateWindows } from '../src/services/slot.service.js';
const window = { dayOfWeek: 1, availableDate: '2030-01-07', startTime: '09:00', endTime: '15:00', isActive: true };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-07T00:00Z'));
  prisma.doctorProfile.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED' });
});
afterEach(() => vi.useRealTimers());
describe('dated availability and favorite ranges', () => {
  it('saves one unnamed default and keeps explicit custom days', async () => {
    const timing = { startTime: '09:00', endTime: '15:00' };
    await saveDefaultTiming('user', 'doctor', timing);
    expect(prisma.doctorProfile.update).toHaveBeenCalledWith({ where: { id: 'doctor' }, data: { availabilityPresets: [{ ...timing, isDefault: true }] } });
    expect(prisma.doctorWorkingHour.deleteMany).not.toHaveBeenCalled();
  });
  it('default covers every day and rolls forward; custom and inactive days take precedence', () => {
    const presets = [{ startTime: '09:00', endTime: '15:00', isDefault: true }];
    const override = { dayOfWeek: 1, availableDate: new Date('2030-01-07'), startTime: new Date('1970-01-01T10:00Z'), endTime: new Date('1970-01-01T12:00Z'), isActive: false };
    const rows = effectiveWorkingHours([override], presets);
    expect(rows.filter((row) => row.availableDate.toISOString().slice(0, 10) >= '2030-01-07')).toHaveLength(7);
    expect(rows.filter((row) => row.availableDate.toISOString().startsWith('2030-01-07'))).toEqual([override]);
    vi.setSystemTime(new Date('2030-01-08T00:00Z'));
    expect(effectiveWorkingHours([override], presets).some((row) => row.availableDate.toISOString().startsWith('2030-01-14'))).toBe(true);
  });
  it('does not automatically publish old named favorites as default hours', () => {
    expect(getDefaultTiming([{ label: 'Old favorite', startTime: '09:00', endTime: '15:00' }])).toBeNull();
  });
  it('omits inherited rows when saving daily overrides so future default edits still apply', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED', availabilityPresets: [{ startTime: '09:00', endTime: '15:00', isDefault: true }] });
    await replaceWorkingHours('user', 'doctor', { timezone: 'Asia/Kolkata', windows: [{ ...window, useDefault: true }] });
    expect(prisma.doctorWorkingHour.createMany).not.toHaveBeenCalled();
  });
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
  it('allows the final overnight default day to be marked inactive', async () => {
    await expect(replaceWorkingHours('user', 'doctor', { timezone: 'Asia/Kolkata', windows: [{ ...window, dayOfWeek: 7, availableDate: '2030-01-13', startTime: '23:00', endTime: '03:00', isActive: false }] })).resolves.toEqual([]);
    expect(prisma.doctorWorkingHour.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ isActive: false })] });
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
