import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), options: undefined, log: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: options => { mocks.options = options; return { sendMail: mocks.sendMail }; } } }));
vi.mock('../src/lib/logger.js', () => ({ logger: { error: mocks.log } }));
import { sendOtpEmail } from '../src/lib/mailer.js';
beforeEach(() => { mocks.sendMail.mockReset(); mocks.log.mockClear(); });
describe('bounded and safely reported SMTP failures', () => {
  it('sets bounded connection, greeting and socket timeouts', () => {
    expect(mocks.options).toMatchObject({ connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000 });
  });
  it.each(['EAUTH', 'ETIMEDOUT', 'ESOCKET'])('returns an actionable 503 for %s without logging addresses, codes or provider responses', async code => {
    mocks.sendMail.mockRejectedValue(Object.assign(new Error('private-provider-message'), { code, responseCode: 535, response: 'private-email@example.test' }));
    await expect(sendOtpEmail({ email: 'private-email@example.test', code: '123456', purpose: 'VERIFY_EMAIL' })).rejects.toMatchObject({ status: 503, code: 'EMAIL_DELIVERY_UNAVAILABLE' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private|123456/);
    expect(mocks.log).toHaveBeenCalledWith({ errorCode: code, responseCode: 535 }, 'OTP email delivery failed');
  });
  it('still sends successful emails normally', async () => {
    mocks.sendMail.mockResolvedValue({});
    await sendOtpEmail({ email: 'test@example.test', code: '123456', purpose: 'VERIFY_EMAIL' });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1); expect(mocks.log).not.toHaveBeenCalled();
  });
});
