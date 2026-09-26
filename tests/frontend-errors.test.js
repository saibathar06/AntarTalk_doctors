import { describe, it, expect } from 'vitest';
import { responseError } from '../web/src/httpError.ts';
const { Response } = globalThis;

describe('browser HTTP error reporting', () => {
  it('handles gateway HTML without JSON parsing errors', async () => {
    const error = await responseError(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'X-Request-Id': 'test-reference' } }));
    expect(error).toMatchObject({ status: 502, code: 'API_UNAVAILABLE', requestId: 'test-reference' });
    expect(error.message).toContain('email verification');
    expect(error.message).toContain('test-reference');
  });
  it('keeps backend SMTP failures distinct from transport failures', async () => {
    const error = await responseError(new Response(JSON.stringify({ error: { code: 'EMAIL_DELIVERY_UNAVAILABLE', message: 'Could not send email.' } }), { status: 503 }));
    expect(error.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(error.message).toBe('Could not send email.');
  });
});
