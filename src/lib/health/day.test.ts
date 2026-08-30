import { describe, it, expect } from 'vitest';
import { localToday, HEALTH_TIMEZONE } from './day';

describe('localToday', () => {
  it('is the LONDON day, not the UTC one, in the hour after midnight BST', () => {
    // 00:30 BST on the 30th is 23:30 UTC on the 29th. Every week and day bucket
    // on /health is keyed on the local day, so the UTC read spent that hour
    // comparing today's derivations against yesterday's date.
    const justAfterMidnightBst = new Date('2026-08-29T23:30:00Z');
    expect(justAfterMidnightBst.toISOString().slice(0, 10)).toBe('2026-08-29');
    expect(localToday(justAfterMidnightBst)).toBe('2026-08-30');
  });

  it('agrees with UTC through the rest of a summer day', () => {
    for (const hour of ['00:30', '09:00', '13:45', '22:59']) {
      const d = new Date(`2026-08-30T${hour}:00Z`);
      expect(localToday(d)).toBe('2026-08-30');
    }
  });

  it('holds in winter, when London is UTC', () => {
    expect(localToday(new Date('2026-01-15T00:10:00Z'))).toBe('2026-01-15');
    expect(localToday(new Date('2026-01-15T23:50:00Z'))).toBe('2026-01-15');
  });

  it('emits a plain YYYY-MM-DD, the shape every bucket key here uses', () => {
    expect(localToday(new Date('2026-03-05T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('names the zone once, so the coach and the loader cannot drift apart', () => {
    expect(HEALTH_TIMEZONE).toBe('Europe/London');
  });
});
