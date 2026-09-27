import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';

export function recaptchaConfiguration() {
  return { enabled: Boolean(env.RECAPTCHA_SITE_KEY && env.RECAPTCHA_SECRET_KEY), siteKey: env.RECAPTCHA_SITE_KEY ?? null };
}

/** Verify a Google reCAPTCHA v2 checkbox token, while safely supporting v3 responses. */
export async function verifyRecaptcha(token, expectedAction) {
  if (!env.RECAPTCHA_SECRET_KEY) {
    throw new AppError(503, 'RECAPTCHA_UNAVAILABLE', 'Security verification is not configured. Please try again later.');
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new AppError(422, 'RECAPTCHA_REQUIRED', 'Complete the security verification before continuing.');
  }
  const controller = new globalThis.AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), env.RECAPTCHA_VERIFY_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new globalThis.URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: token }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new AppError(422, 'RECAPTCHA_FAILED', 'Security verification failed. Please try again.');
    }
    // Checkbox v2 responses do not carry action/score. Validate these if a v3 key is configured later.
    if ((result.action && result.action !== expectedAction) || (typeof result.score === 'number' && result.score < 0.5)) {
      throw new AppError(422, 'RECAPTCHA_FAILED', 'Security verification failed. Please try again.');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn({ errorCode: error?.name === 'AbortError' ? 'TIMEOUT' : 'RECAPTCHA_NETWORK_ERROR' }, 'reCAPTCHA verification unavailable');
    throw new AppError(503, 'RECAPTCHA_UNAVAILABLE', 'Security verification is temporarily unavailable. Please try again.');
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
