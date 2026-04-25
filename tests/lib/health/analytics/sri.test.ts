// tests/lib/health/analytics/sri.test.ts
import { describe, it, expect } from 'vitest';
import { computeSRI } from '$lib/health/analytics/sri';

describe('computeSRI', () => {
  it('returns 100 for perfectly regular sleep over 14 nights', () => {
    // 14 identical nights: in bed 23:00–07:00 local
    const nights = Array.from({ length: 14 }).map((_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i, 23, 0));      // 23:00 UTC
      const e = new Date(Date.UTC(2026, 0, 2 + i, 7, 0));       // 07:00 UTC next day
      return { startLocalIso: d.toISOString(), endLocalIso: e.toISOString() };
    });
    const r = computeSRI(nights);
    expect(r.sufficiency).toBe('ok');
    expect(Math.round(r.value)).toBe(100);
  });

  it('returns < 100 when sleep times shift', () => {
    const nights = [
      { startLocalIso: '2026-01-01T23:00:00Z', endLocalIso: '2026-01-02T07:00:00Z' },
      { startLocalIso: '2026-01-02T01:00:00Z', endLocalIso: '2026-01-02T09:00:00Z' },
      { startLocalIso: '2026-01-03T23:00:00Z', endLocalIso: '2026-01-04T07:00:00Z' },
      { startLocalIso: '2026-01-04T02:00:00Z', endLocalIso: '2026-01-04T10:00:00Z' },
      { startLocalIso: '2026-01-05T23:00:00Z', endLocalIso: '2026-01-06T07:00:00Z' },
      { startLocalIso: '2026-01-06T03:00:00Z', endLocalIso: '2026-01-06T11:00:00Z' },
      { startLocalIso: '2026-01-07T23:00:00Z', endLocalIso: '2026-01-08T07:00:00Z' },
    ];
    const r = computeSRI(nights);
    expect(r.value).toBeLessThan(100);
    expect(r.value).toBeGreaterThan(0);
  });

  it('reports insufficient with < 7 nights', () => {
    const r = computeSRI([
      { startLocalIso: '2026-01-01T23:00:00Z', endLocalIso: '2026-01-02T07:00:00Z' },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
