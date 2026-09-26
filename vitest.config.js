import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/antartalk_test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-32-characters-long',
      OTP_PEPPER: 'test-otp-pepper-32-characters-long',
      PAYOUT_ENCRYPTION_KEY: 'a'.repeat(64)
    }
  }
});
