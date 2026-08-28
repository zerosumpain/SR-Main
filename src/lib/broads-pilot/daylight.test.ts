import { describe, it, expect } from 'vitest';
import { sunTimes, daylightHours } from './daylight';

describe('daylight (NOAA solar)', () => {
  const date = new Date(Date.UTC(2026, 5, 21)); // 2026-06-21, summer solstice
  const lat = 52.6;
  const lng = 1.5; // Broads

  it('daylightHours ≈ 16.8 at the solstice (lat 52.6)', () => {
    expect(daylightHours(date, lat, lng)).toBeCloseTo(16.8, 0); // ±0.4 → 0 dp
    // tighter explicit bound
    const h = daylightHours(date, lat, lng);
    expect(h).toBeGreaterThan(16.4);
    expect(h).toBeLessThan(17.2);
  });

  it('sunrise UTC hour ≈ 3.6', () => {
    const { sunrise } = sunTimes(date, lat, lng);
    const hourUtc =
      sunrise.getUTCHours() + sunrise.getUTCMinutes() / 60 + sunrise.getUTCSeconds() / 3600;
    expect(hourUtc).toBeGreaterThan(3.2);
    expect(hourUtc).toBeLessThan(4.0);
  });

  it('sunset is after sunrise and daylightHours matches the gap', () => {
    const { sunrise, sunset, daylightHours: dh } = sunTimes(date, lat, lng);
    expect(sunset.getTime()).toBeGreaterThan(sunrise.getTime());
    const gapH = (sunset.getTime() - sunrise.getTime()) / 3_600_000;
    expect(dh).toBeCloseTo(gapH, 3);
  });

  it('winter solstice is much shorter than summer', () => {
    const winter = new Date(Date.UTC(2026, 11, 21));
    expect(daylightHours(winter, lat, lng)).toBeLessThan(8.5);
  });
});
