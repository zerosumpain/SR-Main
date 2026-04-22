import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { GMAIL_TOKEN_ENCRYPTION_KEY: '0'.repeat(64) },
}));

import { encryptToken, decryptToken } from '$lib/workflows/gmail/crypto';

describe('gmail crypto', () => {
  it('round-trips a refresh token', () => {
    const plain = 'ya29.refresh-token-sample-12345';
    const enc = encryptToken(plain);
    expect(enc).not.toBe(plain);
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // iv:tag:ciphertext
    expect(decryptToken(enc)).toBe(plain);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const plain = 'same-token';
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a).not.toBe(b); // IV randomization
    expect(decryptToken(a)).toBe(plain);
    expect(decryptToken(b)).toBe(plain);
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptToken('hello');
    const parts = enc.split(':');
    const tampered = [parts[0], parts[1], parts[2].slice(0, -2) + '00'].join(':');
    expect(() => decryptToken(tampered)).toThrow();
  });
});
