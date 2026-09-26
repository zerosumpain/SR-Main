import { describe, expect, it } from 'vitest';
import { kindHref, weekDates, weekHref } from './chart-links';

describe('release chart links', () => {
  const filters = { kind: 'feature', q: 'health', from: '', to: '', impact: 'user-facing', via: 'backfill' };

  it('maps ISO week 32 to its UTC dates and keeps the other filters', () => {
    expect(weekDates('2026-W32')).toEqual({ from: '2026-08-03', to: '2026-08-09' });
    expect(weekHref(filters, '2026-W32')).toBe('/releases?q=health&kind=feature&impact=user-facing&via=backfill&from=2026-08-03&to=2026-08-09#release-log');
  });

  it('toggles selected week and kind off without losing the other selection', () => {
    const selected = { ...filters, from: '2026-08-03', to: '2026-08-09' };
    expect(weekHref(selected, '2026-W32')).toBe('/releases?q=health&kind=feature&impact=user-facing&via=backfill#release-log');
    expect(kindHref(selected, 'feature')).toBe('/releases?q=health&impact=user-facing&via=backfill&from=2026-08-03&to=2026-08-09#release-log');
  });
});
