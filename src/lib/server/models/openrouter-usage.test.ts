/**
 * The fingerprint exists for exactly one comparison — "does the engine bill the
 * key we are reconciling against?" — so what matters is that two different keys
 * never collide and that a real key never leaks through it.
 */
import { describe, it, expect } from 'vitest';
import { keyFingerprint } from './openrouter-usage';

const A = 'sk-or-v1-56e8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9fd7';
const B = 'sk-or-v1-8d5daaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaafa9f';

describe('keyFingerprint', () => {
  it('gives the same answer for the same key on either host', () => {
    expect(keyFingerprint(A)).toBe(keyFingerprint(A));
  });

  it('separates the two live keys on this account', () => {
    // The real pair: homeserv + Hermes on one key, the VPS on another. If these
    // ever compared equal the VPS would divide a combined ledger by a bill that
    // covered half of it.
    expect(keyFingerprint(A)).not.toBe(keyFingerprint(B));
  });

  it('never carries enough of the key to use it', () => {
    const fp = keyFingerprint(A)!;
    expect(fp).not.toContain(A.slice(12, -4));
    expect(fp.length).toBeLessThan(24);
  });

  it('says "cannot tell" rather than guessing when there is no key', () => {
    expect(keyFingerprint(null)).toBeNull();
    expect(keyFingerprint(undefined)).toBeNull();
    expect(keyFingerprint('')).toBeNull();
    // Too short to have a distinct head and tail — a fingerprint of it would
    // overlap itself and could collide with a different short string.
    expect(keyFingerprint('sk-or-v1')).toBeNull();
  });
});
