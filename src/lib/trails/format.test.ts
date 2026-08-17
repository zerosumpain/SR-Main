import { describe, it, expect } from 'vitest';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatElevation,
  formatHeartrate,
  formatEnergy,
  activityLabel,
  isPaceSport,
  formatLocalDate,
} from './format';

describe('formatDistance', () => {
  it('formats kilometres and miles from the same stored metres', () => {
    expect(formatDistance(10_000)).toBe('10.00 km');
    expect(formatDistance(10_000, 'mi')).toBe('6.21 mi');
  });

  it('drops decimals once the number is long', () => {
    expect(formatDistance(150_000)).toBe('150 km');
  });

  it('shows an em dash rather than 0 for missing data', () => {
    expect(formatDistance(null)).toBe('—');
    expect(formatDistance(undefined)).toBe('—');
    expect(formatDistance(NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('omits the hour field under an hour', () => {
    expect(formatDuration(125)).toBe('2:05');
  });

  it('includes hours once there are any', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('pads correctly', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('rejects nonsense', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('formatPace', () => {
  it('formats seconds per km as mm:ss', () => {
    expect(formatPace(285)).toBe('4:45 /km');
  });

  it('converts to miles', () => {
    // 285 s/km = 458.66 s/mi = 7:39
    expect(formatPace(285, 'mi')).toBe('7:39 /mi');
  });

  it('never emits a 60-second pace', () => {
    // 299.7 rounds to 60 s in the seconds field; must carry into the minute.
    expect(formatPace(299.7)).toBe('5:00 /km');
  });

  it('rejects a zero or missing pace', () => {
    expect(formatPace(0)).toBe('—');
    expect(formatPace(null)).toBe('—');
  });
});

describe('formatSpeed', () => {
  it('converts pace to km/h', () => {
    expect(formatSpeed(180)).toBe('20.0 km/h'); // 3 min/km
    expect(formatSpeed(360)).toBe('10.0 km/h');
  });

  it('rejects a zero pace rather than dividing by it', () => {
    expect(formatSpeed(0)).toBe('—');
  });
});

describe('simple formatters', () => {
  it('rounds elevation to whole metres', () => {
    expect(formatElevation(123.6)).toBe('124 m');
    expect(formatElevation(null)).toBe('—');
  });

  it('formats heart rate', () => {
    expect(formatHeartrate(152)).toBe('152 bpm');
    expect(formatHeartrate(0)).toBe('—');
  });

  it('shows energy as kilocalories, converted from stored kilojoules', () => {
    expect(formatEnergy(418.4)).toBe('100 kcal');
    expect(formatEnergy(null)).toBe('—');
  });
});

describe('activity labels', () => {
  it('gives readable names', () => {
    expect(activityLabel('trail_run')).toBe('Trail run');
    expect(activityLabel('mtb')).toBe('MTB');
  });

  it('degrades gracefully for a type it does not know', () => {
    expect(activityLabel('kite_surf')).toBe('kite surf');
  });

  it('knows which sports read as pace and which as speed', () => {
    expect(isPaceSport('run')).toBe(true);
    expect(isPaceSport('hike')).toBe(true);
    expect(isPaceSport('ride')).toBe(false);
    expect(isPaceSport('mtb')).toBe(false);
  });
});

describe('formatLocalDate', () => {
  const startedAt = Date.UTC(2026, 7, 16, 6, 12, 3) / 1000; // 07:12:03 +0100

  it('shows the time the workout was actually done', () => {
    // 07:12 +0100 is 06:12Z — the reader should see 07:12 regardless of server zone.
    expect(formatLocalDate('2026-08-16 07:12:03 +0100', startedAt)).toBe('16 Aug 2026, 07:12');
  });

  it('does not slide a late-evening run into the next day', () => {
    expect(formatLocalDate('2026-08-16 23:40:00 +0100', 0)).toBe('16 Aug 2026, 23:40');
  });

  it('falls back to the unix timestamp when the local string is unusable', () => {
    expect(formatLocalDate('garbage', startedAt)).toBe('16 Aug 2026, 06:12');
  });
});
