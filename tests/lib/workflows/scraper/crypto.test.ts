import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { SCRAPER_VAULT_KEY: '1'.repeat(64) },
}));

import { encryptCredential, decryptCredential } from '$lib/workflows/scraper/crypto';

describe('scraper crypto', () => {
  it('round-trips a JSON credential blob', () => {
    const cred = { username: 'user@example.com', password: 'p@ssw0rd!', totpSecret: 'ABC123' };
    const enc = encryptCredential(cred);
    expect(typeof enc).toBe('string');
    expect(enc).not.toContain('p@ssw0rd');
    const dec = decryptCredential(enc);
    expect(dec).toEqual(cred);
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptCredential({ a: 1 });
    const parts = enc.split(':');
    // Substitute the last byte for one it definitely is not. Pinning it to a
    // literal '00' looked like tampering and was a no-op whenever the payload
    // already ended in '00' — the untampered string decrypts fine, nothing
    // throws, and the test fails. Roughly 1 run in 256; seen in CI 2026-08-24.
    const tail = parts[2].slice(-2);
    const tampered = [parts[0], parts[1], parts[2].slice(0, -2) + (tail === '00' ? 'ff' : '00')].join(':');
    expect(tampered).not.toBe(enc);
    expect(() => decryptCredential(tampered)).toThrow();
  });
});
