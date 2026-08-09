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
    // Flip the final byte to a DIFFERENT value rather than to a fixed '00'.
    // Overwriting with '00' is a no-op whenever the ciphertext already ends in
    // 00, so the "tampered" string equals the original, decryption succeeds and
    // nothing throws — a 1-in-256 flake that turned master red on run
    // 31339999303, ten minutes after a green run of the identical code.
    const last = parts[2].slice(-2);
    const flipped = last.toLowerCase() === '00' ? '01' : '00';
    const tampered = [parts[0], parts[1], parts[2].slice(0, -2) + flipped].join(':');
    expect(tampered).not.toBe(enc);
    expect(() => decryptToken(tampered)).toThrow();
  });
});
