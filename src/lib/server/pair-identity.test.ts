import { describe, expect, it } from 'vitest';
import { PAIR_IDENTITY_TTL_MS, isPairCodeHash, mintPairIdentity, pairCodeHash, verifyPairIdentity } from './pair-identity';

const SECRET = 'test-secret-'.padEnd(40, 'x');
const CODE = 'A'.repeat(43);
const OTHER = 'B'.repeat(43);
const NOW = 1_800_000_000_000;

describe('pairing identity', () => {
  it('vouches for the person who signed in, for the code it was minted for', () => {
    const a = mintPairIdentity(' Fintan@Example.test ', pairCodeHash(CODE), SECRET, NOW);
    expect(verifyPairIdentity(a, CODE, SECRET, NOW + 1000)).toBe('fintan@example.test');
  });

  it('is no use with any other code', () => {
    const a = mintPairIdentity('fintan@example.test', pairCodeHash(CODE), SECRET, NOW);
    expect(verifyPairIdentity(a, OTHER, SECRET, NOW)).toBeNull();
  });

  it('expires, and refuses one that claims a longer life than it could have', () => {
    const a = mintPairIdentity('fintan@example.test', pairCodeHash(CODE), SECRET, NOW);
    expect(verifyPairIdentity(a, CODE, SECRET, NOW + PAIR_IDENTITY_TTL_MS + 1)).toBeNull();
    const future = mintPairIdentity('fintan@example.test', pairCodeHash(CODE), SECRET, NOW + 60 * 60_000);
    expect(verifyPairIdentity(future, CODE, SECRET, NOW)).toBeNull();
  });

  it('cannot be re-addressed or forged', () => {
    const a = mintPairIdentity('fintan@example.test', pairCodeHash(CODE), SECRET, NOW);
    const [, mac] = a.split('.');
    const payload = Buffer.from(JSON.stringify({ e: 'owner@example.test', h: pairCodeHash(CODE), x: NOW + 60_000 })).toString('base64url');
    expect(verifyPairIdentity(`${payload}.${mac}`, CODE, SECRET, NOW)).toBeNull();
    expect(verifyPairIdentity(a, CODE, 'another-secret'.padEnd(40, 'y'), NOW)).toBeNull();
  });

  it('fails closed on nothing to check', () => {
    expect(verifyPairIdentity(undefined, CODE, SECRET, NOW)).toBeNull();
    expect(verifyPairIdentity('nonsense', CODE, SECRET, NOW)).toBeNull();
    const a = mintPairIdentity('fintan@example.test', pairCodeHash(CODE), SECRET, NOW);
    expect(verifyPairIdentity(a, CODE, undefined, NOW)).toBeNull();
    expect(() => mintPairIdentity('fintan@example.test', pairCodeHash(CODE), '', NOW)).toThrow();
  });

  it('recognises a code hash and nothing else', () => {
    expect(isPairCodeHash(pairCodeHash(CODE))).toBe(true);
    expect(isPairCodeHash(CODE)).toBe(false);
    expect(isPairCodeHash(null)).toBe(false);
  });
});
