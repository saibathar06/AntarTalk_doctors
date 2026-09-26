import { describe, expect, it } from 'vitest';
import { apiTarget, isLocalRequest, localCookie } from '../web/devProxy.ts';

describe('Render development proxy', () => {
  it('accepts HTTPS Render and loopback API targets', () => {
    expect(apiTarget('https://antartalk-doctors.onrender.com').origin).toBe('https://antartalk-doctors.onrender.com');
    expect(apiTarget('http://127.0.0.1:4000').port).toBe('4000');
  });
  it.each(['http://external.example', 'https://user:secret@example.com', 'https://example.com/api', 'https://example.com?token=secret'])('rejects unsafe target %s', target => expect(() => apiTarget(target)).toThrow());
  it('requires exact browser origin and loopback connection for writes', () => {
    expect(isLocalRequest('127.0.0.1:5173', 'http://127.0.0.1:5173', '127.0.0.1', 'POST')).toBe(true);
    expect(isLocalRequest('localhost:5173', 'http://localhost:5173', '::1', 'POST')).toBe(true);
    expect(isLocalRequest('localhost:5173', 'https://attacker.example', '127.0.0.1', 'POST')).toBe(false);
    expect(isLocalRequest('localhost:5173', undefined, '127.0.0.1', 'POST')).toBe(false);
    expect(isLocalRequest('localhost:5173', 'http://localhost:5173', '192.168.1.2', 'POST')).toBe(false);
    expect(isLocalRequest('attacker.example', 'http://attacker.example', '127.0.0.1', 'POST')).toBe(false);
  });
  it('retains cookie protections except Secure on local HTTP and does not rewrite other cookies', () => {
    expect(localCookie('antartalk_doctor_refresh=test; Path=/api/doctor/auth; HttpOnly; Secure; SameSite=Strict; Domain=example.com')).toBe('antartalk_doctor_refresh=test; Path=/api/doctor/auth; HttpOnly; SameSite=Strict');
    expect(localCookie('other=test; Secure')).toBe('other=test; Secure');
  });
});
