import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { prisma } from '../src/lib/prisma.js';
import { enqueueBookingNotifications, registerDevice, unregisterDevice } from '../src/services/notification.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(prisma, {
    pushDevice: {
      upsert: vi.fn(async ({ create }) => ({ id: 'device', platform: create.platform, isActive: true, createdAt: new Date(), updatedAt: new Date() })),
      updateMany: vi.fn(async () => ({ count: 1 }))
    }
  });
});

describe('notification devices and booking notifications', () => {
  it('registers a token to the authenticated account without returning it', async () => {
    const result = await registerDevice('user-one', { token: 'ExponentPushToken[abcdefghijklmnop]', platform: 'ANDROID' });
    expect(prisma.pushDevice.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 'user-one' }) }));
    expect(result).not.toHaveProperty('token');
  });

  it('will not remove another users device', async () => {
    prisma.pushDevice.updateMany.mockResolvedValue({ count: 0 });
    await expect(unregisterDevice('user-two', 'device')).rejects.toMatchObject({ code: 'PUSH_DEVICE_NOT_FOUND' });
  });

  it('creates separate client and doctor records and delivery jobs transactionally', async () => {
    const notifications = [];
    const deliveries = [];
    const tx = {
      notification: { create: vi.fn(async ({ data }) => { const row = { id: `n-${notifications.length}`, ...data }; notifications.push(row); return row; }) },
      pushDevice: { findMany: vi.fn(async ({ where }) => [{ id: `device-${where.userId}` }]) },
      pushDelivery: { createMany: vi.fn(async ({ data }) => { deliveries.push(...data); }) }
    };
    await enqueueBookingNotifications(tx, { id: 'booking', clientId: 'client', clientName: 'Client', startTime: new Date('2030-01-02T04:30:00Z') }, { userId: 'doctor-user', firstName: 'Asha', lastName: 'Rao' });
    expect(notifications.map((row) => row.userId)).toEqual(['client', 'doctor-user']);
    expect(deliveries).toHaveLength(2);
    expect(notifications[0].data).toMatchObject({ bookingId: 'booking' });
  });
});
