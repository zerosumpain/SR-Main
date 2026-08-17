import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { signBridgeToken, verifyBridgeToken, buildFromAuthHeader } from './bridge-token';

const SECRET = 'x'.repeat(48);
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.JKAI_BRIDGE_SECRET;
  process.env.JKAI_BRIDGE_SECRET = SECRET;
});
afterAll(() => {
  if (previous === undefined) delete process.env.JKAI_BRIDGE_SECRET;
  else process.env.JKAI_BRIDGE_SECRET = previous;
});

describe('the per-build credential', () => {
  it('round-trips the build it was issued to', () => {
    expect(verifyBridgeToken(signBridgeToken('build-123'))).toBe('build-123');
  });

  it('refuses a token signed with a different secret', () => {
    const token = signBridgeToken('build-123');
    process.env.JKAI_BRIDGE_SECRET = 'y'.repeat(48);
    expect(verifyBridgeToken(token)).toBeNull();
    process.env.JKAI_BRIDGE_SECRET = SECRET;
  });

  it('refuses a tampered build id', () => {
    const decoded = Buffer.from(signBridgeToken('build-123'), 'base64url').toString('utf-8');
    const [, ts, sig] = decoded.split('.');
    const forged = Buffer.from(`build-999.${ts}.${sig}`).toString('base64url');
    expect(verifyBridgeToken(forged)).toBeNull();
  });

  it('refuses rubbish rather than throwing', () => {
    for (const junk of ['', 'not-base64url!!', Buffer.from('a.b').toString('base64url')]) {
      expect(verifyBridgeToken(junk)).toBeNull();
    }
  });

  it('refuses a secret that is too weak to be one', () => {
    process.env.JKAI_BRIDGE_SECRET = 'short';
    expect(() => signBridgeToken('build-1')).toThrow(/JKAI_BRIDGE_SECRET/);
    // Verification must not throw its way into a 500 — it fails closed.
    expect(verifyBridgeToken('anything')).toBeNull();
    process.env.JKAI_BRIDGE_SECRET = SECRET;
  });
});

describe('reading the credential off a request', () => {
  /*
   * This is the half that was missing. `executor.ts` sets JKAI_BRIDGE_TOKEN to
   * a signed build token and `codegraph-query.mjs` sends it as a bearer, but
   * the query route only compared against CLAUDE_CHANGELOG_SECRET — so every
   * pull from inside a build 401'd, from the day it shipped.
   */
  it('accepts the header the pull script actually sends', () => {
    const token = signBridgeToken('build-abc');
    expect(buildFromAuthHeader(`Bearer ${token}`)).toBe('build-abc');
  });

  it('is case-insensitive on the scheme and tolerates padding', () => {
    const token = signBridgeToken('build-abc');
    expect(buildFromAuthHeader(`bearer  ${token} `)).toBe('build-abc');
  });

  it('returns null for a missing, malformed or non-bearer header', () => {
    expect(buildFromAuthHeader(null)).toBeNull();
    expect(buildFromAuthHeader('Basic abc')).toBeNull();
    expect(buildFromAuthHeader('Bearer')).toBeNull();
  });
});
