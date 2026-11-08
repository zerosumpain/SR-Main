import { describe, expect, it } from 'vitest';
import { coverageBetween, emptyDriveState, eventsBetween, foldDriveFixes, type DriveFix } from './drive';

// A straight road north from (54.5, -1.55): one fix a second at the given
// speeds (m/s), positions integrated from the speeds so they agree.
function drive(speeds: number[], start = Date.parse('2026-11-01T08:00:00Z'), accuracyM = 5): DriveFix[] {
  let lat = 54.5;
  return speeds.map((v, i) => {
    if (i) lat += (((speeds[i - 1] + v) / 2) * 1) / 111_320;
    return { ts: start + i * 1000, lat, lon: -1.55, accuracyM, speedMs: v };
  });
}

describe('foldDriveFixes', () => {
  it('finds one harsh brake in a hard stop, not one per second of it', () => {
    const { added } = foldDriveFixes(emptyDriveState(), drive([14, 14, 14, 10, 6, 2, 0, 0, 0]));
    expect(added.map((e) => e.kind)).toEqual(['brake']);
    expect(added[0].fromKmh).toBeGreaterThan(30);
    expect(added[0].ms2).toBeGreaterThanOrEqual(3.5);
  });

  it('finds a hard start, and ignores an ordinary one', () => {
    expect(foldDriveFixes(emptyDriveState(), drive([0, 0, 4, 8, 12, 14])).added.map((e) => e.kind)).toEqual(['accel']);
    expect(foldDriveFixes(emptyDriveState(), drive([0, 0, 2, 4, 6, 8, 10])).added).toEqual([]);
  });

  it('ignores speed changes below car speed: a cyclist stopping is not a drive', () => {
    expect(foldDriveFixes(emptyDriveState(), drive([6, 6, 3, 0, 0])).added).toEqual([]);
  });

  it('ignores imprecise fixes', () => {
    expect(foldDriveFixes(emptyDriveState(), drive([14, 14, 10, 6, 2, 0], undefined, 40)).added).toEqual([]);
  });

  it('ignores a speed the phone did not know, sent as 0, while the car kept going', () => {
    const fixes = drive([14, 14, 14, 14, 14, 14]);
    fixes[4] = { ...fixes[4], speedMs: 0 };
    expect(foldDriveFixes(emptyDriveState(), fixes).added).toEqual([]);
  });

  it('sees a stop that straddles two ingest pages, and a re-read page adds nothing', () => {
    const fixes = drive([14, 14, 14, 10, 6, 2, 0]);
    const first = foldDriveFixes(emptyDriveState(), fixes.slice(0, 4));
    const second = foldDriveFixes(first.state, fixes.slice(4));
    expect([...first.added, ...second.added].map((e) => e.kind)).toEqual(['brake']);
    expect(foldDriveFixes(second.state, fixes).added).toEqual([]);
  });
});

describe('coverageBetween', () => {
  it('says how much of a window was watched at one fix a second, and a 5 s phone was not', () => {
    const start = Date.parse('2026-11-01T08:00:00Z');
    const { state } = foldDriveFixes(emptyDriveState(), drive(Array(120).fill(14), start));
    expect(coverageBetween(state, start, start + 120_000)).toBeGreaterThan(0.9);
    const sparse = drive(Array(120).fill(14), start).filter((_, i) => i % 5 === 0);
    expect(coverageBetween(foldDriveFixes(emptyDriveState(), sparse).state, start, start + 120_000)).toBe(0);
  });
});

describe('eventsBetween', () => {
  it('keeps only the trip window', () => {
    const { state } = foldDriveFixes(emptyDriveState(), drive([14, 14, 14, 10, 6, 2, 0]));
    const t = Date.parse(state.events[0].at);
    expect(eventsBetween(state.events, t - 1000, t + 1000)).toHaveLength(1);
    expect(eventsBetween(state.events, t + 1, t + 5000)).toHaveLength(0);
  });
});
