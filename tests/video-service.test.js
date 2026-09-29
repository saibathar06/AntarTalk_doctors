import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/config/env.js', () => ({ env: {
  VIDEO_SERVICE_URL: 'https://video.example', VIDEO_SERVICE_API_KEY: 'x'.repeat(32), VIDEO_REQUEST_TIMEOUT_MS: 1000,
  DOCTOR_WEB_ORIGIN: 'https://doctors.example', CLIENT_WEB_ORIGIN: 'https://clients.example', LOG_LEVEL: 'silent'
} }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { booking: { findUnique: vi.fn() }, videoCall: { update: vi.fn() } } }));
import { prisma } from '../src/lib/prisma.js';
import { createVideoTicket, provisionVideoCall, readVideoAttendance } from '../src/services/video.service.js';

const booking = {
  id: 'booking', clientId: 'client-user', status: 'CONFIRMED', startTime: new Date('2030-01-02T04:30:00Z'),
  endTime: new Date('2030-01-02T05:30:00Z'), sessionDurationMinutes: 40,
  doctor: { userId: 'doctor-user' },
  videoCall: { serviceSessionId: 'video-session', state: 'SCHEDULED', opensAt: new Date('2030-01-02T04:20:00Z'), closesAt: new Date('2030-01-02T05:10:00Z') }
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.booking.findUnique.mockResolvedValue(structuredClone(booking));
  prisma.videoCall.update.mockImplementation(async ({ data }) => ({ ...booking.videoCall, ...data }));
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessionId: 'video-session', launchUrl: 'https://video.example/call?ticket=one-use', expiresAt: '2030-01-02T04:31:00Z' }) }));
});

describe('trusted video integration', () => {
  it('authorizes only a booking participant', async () => {
    await expect(createVideoTicket({ bookingId: 'booking', userId: 'stranger', audience: 'CLIENT', now: new Date('2030-01-02T04:30:00Z') }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('never recreates an ended call', async () => {
    prisma.booking.findUnique.mockResolvedValue({ ...structuredClone(booking), videoCall: { ...booking.videoCall, state: 'ENDED' } });
    await expect(createVideoTicket({ bookingId: 'booking', userId: 'client-user', audience: 'CLIENT', now: new Date('2030-01-02T04:30:00Z') }))
      .rejects.toMatchObject({ code: 'VIDEO_SESSION_ENDED' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requests a short-lived client ticket and pins the launch origin/path', async () => {
    const result = await createVideoTicket({ bookingId: 'booking', userId: 'client-user', audience: 'CLIENT', surface: 'WEB', now: new Date('2030-01-02T04:30:00Z') });
    expect(result).toMatchObject({ bookingId: 'booking', videoOrigin: 'https://video.example' });
    const [, request] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({ userId: 'client-user', parentOrigin: 'https://clients.example' });
    expect(request.headers.Authorization).toBe('Bearer ' + 'x'.repeat(32));
  });

  it('omits browser origin for a native mobile WebView ticket', async () => {
    await createVideoTicket({ bookingId: 'booking', userId: 'doctor-user', audience: 'DOCTOR', surface: 'MOBILE', now: new Date('2030-01-02T04:30:00Z') });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ userId: 'doctor-user' });
  });

  it('provisions the standalone service with trusted booking identities', async () => {
    prisma.booking.findUnique.mockResolvedValue({ ...structuredClone(booking), videoCall: { ...booking.videoCall, state: 'PENDING', serviceSessionId: null } });
    await provisionVideoCall('booking');
    const [, request] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({ appointmentId: 'booking', doctorId: 'doctor-user', clientId: 'client-user' });
  });

  it('reads only trusted attendance summaries from the video service', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ attendance: {
      doctor: { firstJoinedAt: '2030-01-02T04:30:00Z' },
      client: { firstJoinedAt: '2030-01-02T04:31:00Z' }, overlapSeconds: 120
    } }) });
    await expect(readVideoAttendance('video-session')).resolves.toMatchObject({ concurrentSeconds: 120 });
    expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('returns safe upstream diagnostics without exposing credentials', async () => {
    prisma.booking.findUnique.mockResolvedValue({ ...structuredClone(booking), videoCall: { ...booking.videoCall, state: 'PENDING', serviceSessionId: null } });
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: 'UNAUTHORIZED' }) });
    await expect(provisionVideoCall('booking')).rejects.toMatchObject({
      code: 'VIDEO_SERVICE_REJECTED', details: { upstreamStatus: 401, upstreamCode: 'UNAUTHORIZED' }
    });
  });
});
