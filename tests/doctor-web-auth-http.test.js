import { beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../src/middleware/rateLimits.js', () => {
  const pass = (_req, _res, next) => next();
  return { authLimiter: vi.fn(pass), otpLimiter: vi.fn(pass), accountAuthLimiter: vi.fn(pass) };
});
vi.mock('../src/services/doctorAuth.service.js', () => ({ beginDoctorLogin: vi.fn(async () => ({ challengeToken: 'proof', status: 'OTP_SENT' })), registerWebsiteDoctor: vi.fn(), sendDoctorOtp: vi.fn(), verifyDoctorOtp: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'private-refresh', expiresIn: '15m' })) }));
vi.mock('../src/services/auth.service.js', () => ({ logout: vi.fn(), rotateRefreshToken: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { doctorAuthRouter } from '../src/routes/doctorAuth.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { authLimiter } from '../src/middleware/rateLimits.js';
const app = express(); app.use(express.json()); app.use('/api/doctor/auth', doctorAuthRouter); app.use(errorHandler);
describe('website authentication HTTP boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  it('serves public CAPTCHA configuration without consuming a login attempt', async () => {
    const result = await request(app).get('/api/doctor/auth/recaptcha-config');
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveProperty('enabled');
    expect(authLimiter).not.toHaveBeenCalled();
  });
  it('rejects a cookie-free refresh without consuming a login attempt', async () => {
    const result = await request(app).post('/api/doctor/auth/refresh').send({});
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(authLimiter).not.toHaveBeenCalled();
  });
  it('still applies the auth limiter to login attempts', async () => {
    const result = await request(app).post('/api/doctor/auth/login').send({ email: 'doctor@example.com', password: 'Password123' });
    expect(result.status).toBe(422);
    expect(authLimiter).toHaveBeenCalledOnce();
  });
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
