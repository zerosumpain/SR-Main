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
    const last = parts[2].slice(-2);
    const flipped = last.toLowerCase() === '00' ? '01' : '00';
    const tampered = [parts[0], parts[1], parts[2].slice(0, -2) + flipped].join(':');
    expect(tampered).not.toBe(enc);
    expect(() => decryptCredential(tampered)).toThrow();
  });
});
