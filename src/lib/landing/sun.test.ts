import { describe, expect, it } from 'vitest';
import { roundCoord, skyLight, sunAltitude, sunFrom, sunOverride } from './sun';
import { sunAltitude as fromPlace } from './place';

const at = (iso: string) => Date.parse(iso);
const LONDON = [51.5, -0.1] as const;
const TOKYO = [35.5, 139.5] as const;

describe("the owner's sun", () => {
  it('stands where it should over London at the solstices', () => {
    // Solar noon in London is about 12:00 UTC; 90 - 51.5 ± 23.4.
    const summer = sunFrom(...LONDON, at('2026-06-21T12:02:00Z'));
    const winter = sunFrom(...LONDON, at('2026-12-21T12:00:00Z'));
    expect(Math.abs(summer.alt - 62)).toBeLessThanOrEqual(1);
    expect(Math.abs(winter.alt - 15)).toBeLessThanOrEqual(1);
  });

  it('is day in Tokyo while it is night in London', () => {
    // 03:00 UTC is midday in Tokyo.
    expect(sunFrom(...TOKYO, at('2026-10-10T03:00:00Z')).alt).toBeGreaterThan(40);
    expect(sunFrom(...LONDON, at('2026-10-10T03:00:00Z')).alt).toBeLessThan(-20);
  });

  it('says whether the sun is climbing', () => {
    expect(sunFrom(...LONDON, at('2026-10-10T08:00:00Z')).rising).toBe(true);
    expect(sunFrom(...LONDON, at('2026-10-10T15:00:00Z')).rising).toBe(false);
    // Rising in the small hours too: it climbs from its lowest at midnight.
    expect(sunFrom(...LONDON, at('2026-10-10T03:00:00Z')).rising).toBe(true);
    expect(sunFrom(...TOKYO, at('2026-10-10T00:00:00Z')).rising).toBe(true);
    expect(sunFrom(...TOKYO, at('2026-10-10T06:00:00Z')).rising).toBe(false);
  });

  it('answers whole degrees and two keys, nothing else', () => {
    const s = sunFrom(53.4808, -2.2426, at('2026-10-10T11:17:00Z'));
    expect(Object.keys(s).sort()).toEqual(['alt', 'rising']);
    expect(Number.isInteger(s.alt)).toBe(true);
    expect(Object.is(sunFrom(0, 0, at('2026-03-20T18:00:00Z')).alt, -0)).toBe(false);
  });

  it('rounds a coordinate to the nearest half degree', () => {
    expect(roundCoord(53.4808)).toBe(53.5);
    expect(roundCoord(53.24)).toBe(53);
    expect(roundCoord(53.26)).toBe(53.5);
    expect(roundCoord(-2.2426)).toBe(-2);
    expect(roundCoord(-2.26)).toBe(-2.5);
    expect(Object.is(roundCoord(-0.1), 0)).toBe(true);
  });

  it('keeps the place module drawing the same sun as before', () => {
    expect(fromPlace).toBe(sunAltitude);
    // The old default point: about 54.5°N, 1.5°W.
    expect(sunAltitude(at('2026-10-09T12:00:00Z'))).toBeGreaterThan(25);
  });

  it('falls back to the north of England and the London morning without one', () => {
    const now = at('2026-10-10T20:00:00Z');
    expect(skyLight(null, now, false)).toEqual({ alt: sunAltitude(now), morning: false });
    expect(skyLight(undefined, now, true).morning).toBe(true);
    expect(skyLight({ alt: 31, rising: true }, now, false)).toEqual({ alt: 31, morning: true });
  });
});

describe('the dev sun pin', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('pins the sun from the address in dev', () => {
    expect(sunOverride(q('view=place&sun=40&rising=1'), true)).toEqual({ alt: 40, rising: true });
    expect(sunOverride(q('sun=-8.4&rising=0'), true)).toEqual({ alt: -8, rising: false });
    expect(sunOverride(q('sun=12'), true)).toEqual({ alt: 12, rising: false });
  });

  it('ignores nonsense', () => {
    for (const bad of ['sun=', 'sun=high', 'sun=91', 'sun=-91', 'sun=NaN', 'sun=Infinity', 'view=place']) {
      expect(sunOverride(q(bad), true)).toBeNull();
    }
  });

  it('is inert outside dev', () => {
    expect(sunOverride(q('sun=40&rising=1'), false)).toBeNull();
    expect(sunOverride(q('sun=-30&rising=0'), false)).toBeNull();
  });
});
