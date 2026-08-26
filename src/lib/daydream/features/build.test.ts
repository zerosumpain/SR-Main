import { describe, it, expect } from 'vitest';
import { appleLocalDay, localDay, localMinutes, EXPECTED_FIXES_PER_DAY } from './build';

describe('localDay', () => {
  // A rhythm is a LOCAL fact. Filing an evening under the UTC date moves half
  // of every British summer evening onto the wrong day, and every correlation
  // that joins on that key is then comparing a night to the wrong morning.
  it('puts a late British summer evening on the local day', () => {
    expect(localDay(new Date('2026-08-26T23:30:00Z'))).toBe('2026-08-27');
    expect(localDay(new Date('2026-08-26T22:30:00Z'))).toBe('2026-08-26');
  });

  it('agrees with UTC in winter', () => {
    expect(localDay(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-14');
  });
});

describe('appleLocalDay', () => {
  // Apple's strings already carry the local offset, so re-parsing them is a
  // chance to shift the date and no more. The epoch is only a fallback.
  it('takes the date straight off a well-formed local string', () => {
    expect(appleLocalDay('2026-08-26 08:20:47 +0100', 0)).toBe('2026-08-26');
    expect(appleLocalDay('2026-01-28 00:00:43 +0000', 0)).toBe('2026-01-28');
  });

  it('falls back to the epoch when the string is unusable', () => {
    const epoch = Math.floor(Date.UTC(2026, 7, 26, 12, 0, 0) / 1000);
    expect(appleLocalDay('not-a-date', epoch)).toBe('2026-08-26');
  });
});

describe('localMinutes', () => {
  it('reads minutes since local midnight, not since UTC midnight', () => {
    // 07:30 UTC in August is 08:30 local.
    expect(localMinutes(new Date('2026-08-26T07:30:00Z'))).toBe(8 * 60 + 30);
  });
});

describe('coverage arithmetic', () => {
  // The divisor MUST match the observe cadence. When these drifted apart
  // earlier in this feature's life, a fully-observed hour computed a coverage
  // of 5.0, clamped to 1.0, and the gate passed everything including days the
  // sensor was dead.
  it('expects one fix per cadence interval across the day', () => {
    expect(EXPECTED_FIXES_PER_DAY).toBe(720);
  });
});
