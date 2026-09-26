import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../src/middleware/rateLimits.js', () => {
  const pass = (_req, _res, next) => next();
  return { authLimiter: pass, otpLimiter: pass, accountAuthLimiter: pass };
});
vi.mock('../src/services/doctorAuth.service.js', () => ({ beginDoctorLogin: vi.fn(async () => ({ challengeToken: 'proof', status: 'OTP_SENT' })), registerWebsiteDoctor: vi.fn(), sendDoctorOtp: vi.fn(), verifyDoctorOtp: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'private-refresh', expiresIn: '15m' })) }));
vi.mock('../src/services/auth.service.js', () => ({ logout: vi.fn(), rotateRefreshToken: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { doctorAuthRouter } from '../src/routes/doctorAuth.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
const app = express(); app.use(express.json()); app.use('/api/doctor/auth', doctorAuthRouter); app.use(errorHandler);
describe('website authentication HTTP boundary', () => {
  it('rejects a supplied untrusted Origin', async () => {
    const req = request(app).post('/api/doctor/auth/verify-otp');
    req.set('Origin', 'https://attacker.example');
    const result = await req.send({ identifier: 'doctor@example.com', purpose: 'DOCTOR_LOGIN', otp: '123456' });
    expect(result.status).toBe(403); expect(result.body.error.code).toBe('ORIGIN_REQUIRED');
  });
  it('allows a request without an Origin after global CORS has accepted it', async () => {
    const result = await request(app).post('/api/doctor/auth/verify-otp').send({ challengeToken: 'x'.repeat(40), otp: '123456' });
    expect(result.status).toBe(200);
  });
  it('returns access token but keeps refresh token in HttpOnly scoped cookie', async () => {
    const result = await request(app).post('/api/doctor/auth/verify-otp').set('Origin', 'http://localhost:5173').send({ challengeToken: 'x'.repeat(40), otp: '123456' });
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ accessToken: 'access', expiresIn: '15m' });
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(result.headers['set-cookie'][0]).toContain('Path=/api/doctor/auth');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('rejects invalid codes before invoking authentication', async () => {
    const result = await request(app).post('/api/doctor/auth/verify-otp').set('Origin', 'http://localhost:5173').send({ identifier: 'doctor@example.com', purpose: 'DOCTOR_LOGIN', otp: 'abc' });
    expect(result.status).toBe(422);
  });
});
