import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), options: undefined, error: vi.fn(), info: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: options => { mocks.options = options; return { sendMail: mocks.sendMail }; } } }));
vi.mock('../src/lib/logger.js', () => ({ logger: { error: mocks.error, info: mocks.info } }));
import { sendOtpEmail } from '../src/lib/mailer.js';
beforeEach(() => { mocks.sendMail.mockReset(); mocks.error.mockClear(); mocks.info.mockClear(); });
describe('bounded and safely reported SMTP failures', () => {
  it('sets bounded connection, greeting and socket timeouts', () => {
    expect(mocks.options).toMatchObject({ connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  });
  it.each(['EAUTH', 'ETIMEDOUT', 'ESOCKET'])('returns an actionable 503 for %s without logging addresses, codes or provider responses', async code => {
    mocks.sendMail.mockRejectedValue(Object.assign(new Error('private-provider-message'), { code, responseCode: 535, response: 'private-email@example.test' }));
    await expect(sendOtpEmail({ email: 'private-email@example.test', code: '123456', purpose: 'VERIFY_EMAIL' })).rejects.toMatchObject({ status: 503, code: 'EMAIL_DELIVERY_UNAVAILABLE' });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toMatch(/private|123456/);
    expect(mocks.error).toHaveBeenCalledWith({ recipient: 'pr******@example.test', purpose: 'VERIFY_EMAIL', errorCode: code, responseCode: 535 }, 'OTP email delivery failed');
  });
  it('still sends successful emails normally', async () => {
    mocks.sendMail.mockResolvedValue({ messageId: '<message-id>', accepted: ['test@example.test'] });
    await sendOtpEmail({ email: 'test@example.test', code: '123456', purpose: 'VERIFY_EMAIL' });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('123456') }));
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'te**@example.test', messageId: '<message-id>' }), 'OTP email accepted by SMTP');
    expect(JSON.stringify([...mocks.info.mock.calls, ...mocks.error.mock.calls])).not.toContain('123456');
  });
});
