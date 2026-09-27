import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({ env: {
  RECAPTCHA_SITE_KEY: 'public-test-key',
  RECAPTCHA_SECRET_KEY: 'private-test-secret',
  RECAPTCHA_MODE: 'v2_checkbox',
  RECAPTCHA_VERIFY_TIMEOUT_MS: 1000,
  LOG_LEVEL: 'silent'
} }));

import { recaptchaConfiguration, verifyRecaptcha } from '../src/services/recaptcha.service.js';

afterEach(() => vi.unstubAllGlobals());

describe('doctor reCAPTCHA v2 boundary', () => {
  it('exposes only the public site key and checkbox mode', () => {
    const config = recaptchaConfiguration();
    expect(config).toEqual({ enabled: true, siteKey: 'public-test-key', mode: 'v2_checkbox' });
    expect(JSON.stringify(config)).not.toContain('private-test-secret');
  });

  it('rejects a missing token without contacting Google', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(verifyRecaptcha('', 'doctor_login')).rejects.toMatchObject({ status: 422, code: 'RECAPTCHA_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a token that Google reports as invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })));
    await expect(verifyRecaptcha('invalid-token', 'doctor_login')).rejects.toMatchObject({ status: 422, code: 'RECAPTCHA_FAILED' });
  });

  it('sends the token and server-side secret to Google and accepts a v2 response', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(verifyRecaptcha('checkbox-token', 'doctor_login')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(options.body.get('response')).toBe('checkbox-token');
    expect(options.body.get('secret')).toBe('private-test-secret');
  });
});
