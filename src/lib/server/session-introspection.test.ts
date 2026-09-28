import { describe, it, expect } from 'vitest';
import { encode } from '@auth/core/jwt';
import { browserSessionEmail, sessionCaller } from './session-introspection';
describe('session authority', () => {
  it('isolates audience keys and fails closed on missing or invalid config', () => {
    const keys = JSON.stringify({ 'sr-health': 'h'.repeat(40), 'sr-drive': 'd'.repeat(40) });
    expect(sessionCaller('sr-health', 'h'.repeat(40), keys)).toBe(true);
    expect(sessionCaller('sr-drive', 'h'.repeat(40), keys)).toBe(false);
    expect(sessionCaller('__proto__', 'h'.repeat(40), keys)).toBe(false);
    expect(sessionCaller('sr-health', 'h'.repeat(40), '{')).toBe(false);
    expect(sessionCaller('sr-health', 'h'.repeat(40), undefined)).toBe(false);
    expect(sessionCaller('sr-health', 'h'.repeat(40), 'null')).toBe(false);
    expect(sessionCaller('sr-health', 'h'.repeat(40), JSON.stringify({ 'sr-health': 'h'.repeat(40), 'sr-drive': 'h'.repeat(40) }))).toBe(false);
  });
  it('recognises ordinary encrypted sessions and rejects every registration-only form', async () => {
    const secret = 'synthetic-authority-secret-32-characters', salt = '__Secure-authjs.session-token';
    for (const registrant of [undefined, false, true, 'true', 1]) {
      const token = await encode({ secret, salt, maxAge: 60, token: { email: 'Member@Example.invalid', registrant } });
      expect(await browserSessionEmail(`${salt}=${token}`, secret)).toBe(registrant == null || registrant === false ? 'member@example.invalid' : null);
    }
    expect(await browserSessionEmail(`${salt}=forged`, secret)).toBe(null);
  });
});
