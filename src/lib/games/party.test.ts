// A party's tokens and names: a TV token and a seat round-trip, refuse any
// tampered part or an expired one, and a seat follows one party only.

import { describe, expect, it } from 'vitest';
import {
  cleanGuestName,
  isGuestId,
  issueSeat,
  issueTvToken,
  newGuestId,
  newPartyId,
  newTvId,
  partyRange,
  SEAT_TTL_SECONDS,
  TV_TOKEN_TTL_SECONDS,
  verifySeat,
  verifyTvToken,
} from './party';

const secret = 'test-secret-for-parties';

function tamper(token: string, part: number): string {
  const parts = token.split('.');
  const s = parts[part];
  parts[part] = s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
  return parts.join('.');
}

describe('TV tokens', () => {
  it('round-trips and names the TV', () => {
    const id = newTvId();
    expect(verifyTvToken(issueTvToken(id, secret).token, secret)).toBe(id);
  });
  it('refuses a tampered part, another secret, or no secret', () => {
    const { token } = issueTvToken(newTvId(), secret);
    for (const part of [0, 1, 2, 3]) expect(verifyTvToken(tamper(token, part), secret)).toBeNull();
    expect(verifyTvToken(token, 'other')).toBeNull();
    expect(verifyTvToken(token, undefined)).toBeNull();
    expect(verifyTvToken('', secret)).toBeNull();
  });
  it('expires', () => {
    const now = Date.now();
    const { token } = issueTvToken(newTvId(), secret, now);
    expect(verifyTvToken(token, secret, now + (TV_TOKEN_TTL_SECONDS + 5) * 1000)).toBeNull();
  });
});

describe('seats', () => {
  it('round-trips for its own party only', () => {
    const party = newPartyId();
    const guest = newGuestId();
    const seat = issueSeat(party, guest, secret);
    expect(verifySeat(seat, party, secret)).toBe(guest);
    expect(verifySeat(seat, newPartyId(), secret)).toBeNull();
    for (const part of [1, 2, 3]) expect(verifySeat(tamper(seat, part), party, secret)).toBeNull();
  });
  it('holds a family member too, and expires', () => {
    const party = newPartyId();
    const now = Date.now();
    const seat = issueSeat(party, 'p_0123456789ab', secret, now);
    expect(verifySeat(seat, party, secret, now)).toBe('p_0123456789ab');
    expect(verifySeat(seat, party, secret, now + (SEAT_TTL_SECONDS + 5) * 1000)).toBeNull();
  });
  it('guest ids are never email hashes', () => {
    expect(isGuestId(newGuestId())).toBe(true);
    expect(isGuestId('p_0123456789ab')).toBe(false);
  });
});

describe('guest names', () => {
  it('tidies spacing and keeps an ordinary name', () => {
    expect(cleanGuestName('  Sam   Lee ', [])).toBe('Sam Lee');
    expect(cleanGuestName("Mary-Jo O'Neil", [])).toBe("Mary-Jo O'Neil");
  });
  it('refuses empty, too long, odd characters and blocked words', () => {
    expect(cleanGuestName('', [])).toBeNull();
    expect(cleanGuestName('   ', [])).toBeNull();
    expect(cleanGuestName('x'.repeat(17), [])).toBeNull();
    expect(cleanGuestName('<script>', [])).toBeNull();
    expect(cleanGuestName(42, [])).toBeNull();
    expect(cleanGuestName('shit', [])).toBeNull();
  });
  it('numbers a name already taken, ignoring case', () => {
    expect(cleanGuestName('Sam', ['sam'])).toBe('Sam 2');
    expect(cleanGuestName('Sam', ['Sam', 'Sam 2'])).toBe('Sam 3');
  });
});

describe('party range', () => {
  it('caps at eight and never below one', () => {
    const r = partyRange('boggle');
    expect(r.max).toBeLessThanOrEqual(8);
    expect(r.min).toBeGreaterThanOrEqual(1);
  });
});
