import { describe, it, expect } from 'vitest';
import { jwtExpiryMs, needsRefresh, isUnusable } from './codex-auth';

/**
 * The clock arithmetic behind the credential.
 *
 * Worth real tests because the failure is invisible: the access token lasts
 * about a week, so a refresh rule that is wrong in either direction looks
 * perfectly healthy for days. Too eager and we rotate the refresh token on every
 * request; too slow and chat stops on a Sunday with a 401 nobody is watching for.
 *
 * The network half is deliberately not mocked here — a fake that returns
 * whatever we tell it proves nothing about an endpoint we do not control. That
 * half is verified against the live endpoint on the canary before the swap.
 */
const HOUR = 3_600_000;

/** Build an unsigned JWT with a given exp. Unsigned is the point: the module
 *  reads the claim, it does not verify the token. */
function tokenExpiringAt(epochSeconds: number): string {
  const claims = Buffer.from(JSON.stringify({ exp: epochSeconds })).toString('base64url');
  return `header.${claims}.signature`;
}

describe('jwtExpiryMs', () => {
  it('reads the exp claim as milliseconds', () => {
    expect(jwtExpiryMs(tokenExpiringAt(1_700_000_000))).toBe(1_700_000_000_000);
  });

  it('returns null for a token with no exp, rather than pretending it expired', () => {
    const noExp = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    expect(jwtExpiryMs(`h.${noExp}.s`)).toBeNull();
  });

  it('returns null for a non-JWT instead of throwing', () => {
    expect(jwtExpiryMs('not-a-jwt')).toBeNull();
    expect(jwtExpiryMs(undefined)).toBeNull();
  });

  it('returns null for undecodable claims', () => {
    expect(jwtExpiryMs('h.!!!not-base64!!!.s')).toBeNull();
  });
});

describe('needsRefresh', () => {
  const now = 1_000 * HOUR;

  it('is false with plenty of life left — the common case, and it must not rotate', () => {
    expect(needsRefresh(now + 100 * HOUR, now)).toBe(false);
  });

  it('is true inside the margin', () => {
    expect(needsRefresh(now + 30 * 60_000, now)).toBe(true);
  });

  it('is true for an already-expired token', () => {
    expect(needsRefresh(now - HOUR, now)).toBe(true);
  });

  it('is false when the expiry is unreadable — let the API be the judge, do not churn', () => {
    expect(needsRefresh(null, now)).toBe(false);
  });
});

describe('isUnusable', () => {
  const now = 1_000 * HOUR;

  it('a token inside the refresh window is stale but still usable', () => {
    // The distinction that keeps a failed refresh from taking chat down.
    expect(needsRefresh(now + 30 * 60_000, now)).toBe(true);
    expect(isUnusable(now + 30 * 60_000, now)).toBe(false);
  });

  it('an expired token is unusable', () => {
    expect(isUnusable(now - 1000, now)).toBe(true);
  });

  it('an unreadable expiry is not treated as unusable', () => {
    expect(isUnusable(null, now)).toBe(false);
  });
});
