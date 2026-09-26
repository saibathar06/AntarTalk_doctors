import { beforeAll, describe, expect, it } from 'vitest';

let cryptoUtils;
beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(32);
  process.env.OTP_PEPPER ??= 'c'.repeat(32);
  cryptoUtils = await import('../src/utils/crypto.js');
});

describe('security primitives', () => {
  it('hashes OTPs deterministically without preserving plaintext', () => {
    const hash = cryptoUtils.hashOtp('user-id', 'VERIFY_EMAIL', '123456');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('123456');
    expect(cryptoUtils.safeEqual(hash, cryptoUtils.hashOtp('user-id', 'VERIFY_EMAIL', '123456'))).toBe(true);
  });

  it('creates high-entropy URL-safe tokens', () => {
    const token = cryptoUtils.randomToken();
    expect(token.length).toBeGreaterThan(50);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
