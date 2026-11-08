import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkSharePassword, hashSharePassword, normaliseSharePassword } from './share-password';

// The same pattern the gateway's normaliseClaims holds `project.pass` to. A
// verifier Main mints that failed it would make every claim for that link
// malformed, and the link would open for nobody.
const CLAIM_PASS = /^scrypt\$[A-Za-z0-9_-]{16,64}\$[A-Za-z0-9_-]{32,128}$/;

describe('share link passwords', () => {
  it('mints scrypt$salt$key with a 16-byte salt and a 32-byte key, fresh salt each time', async () => {
    const a = await hashSharePassword('correct horse');
    const b = await hashSharePassword('correct horse');
    expect(a).toMatch(CLAIM_PASS);
    const [scheme, salt, key] = a.split('$');
    expect(scheme).toBe('scrypt');
    expect(Buffer.from(salt, 'base64url')).toHaveLength(16);
    expect(Buffer.from(key, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('accepts the right answer, trimmed, and refuses a wrong one', async () => {
    const v = await hashSharePassword('  correct horse ');
    expect(await checkSharePassword('correct horse', v)).toBe(true);
    expect(await checkSharePassword(' correct horse\n', v)).toBe(true);
    expect(await checkSharePassword('correct horsf', v)).toBe(false);
    expect(await checkSharePassword('', v)).toBe(false);
  });

  it('refuses a sha256 verifier even for the right password: that format is gone', async () => {
    const v = 'sha256$' + createHash('sha256').update('old shared one').digest('hex');
    expect(v).not.toMatch(CLAIM_PASS);
    expect(await checkSharePassword('old shared one', v)).toBe(false);
  });

  it('anything unrecognised is false, never a throw', async () => {
    const v = await hashSharePassword('pw12');
    const [, salt] = v.split('$');
    for (const bad of ['', 'pw12', 'plain$pw12', 'sha256$ABC', `scrypt$${salt}`, `scrypt$${salt}$${'A'.repeat(64)}`]) {
      expect(await checkSharePassword('pw12', bad)).toBe(false);
    }
  });

  it('a password is 4 to 128 characters after trimming', () => {
    expect(normaliseSharePassword('  abcd  ')).toBe('abcd');
    expect(normaliseSharePassword('abc')).toBeNull();
    expect(normaliseSharePassword('   abc   ')).toBeNull();
    expect(normaliseSharePassword('x'.repeat(128))).toBe('x'.repeat(128));
    expect(normaliseSharePassword('x'.repeat(129))).toBeNull();
    expect(normaliseSharePassword(1234)).toBeNull();
    expect(normaliseSharePassword(undefined)).toBeNull();
  });
});
