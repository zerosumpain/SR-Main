import { describe, expect, it } from 'vitest';
import { normaliseLocationHistory, type HAHistoryRow } from './family-location-history';

const range = { start: '2026-08-18T00:00:00.000Z', end: '2026-08-18T02:00:00.000Z' };
const row = (state: string, at: string, latitude = 54.5): HAHistoryRow => ({
  entity_id: 'person.john',
  state,
  last_changed: at,
  attributes: { latitude, longitude: -1.5 },
});

describe('normaliseLocationHistory', () => {
  it('normalises driving and not_home to away, collapsing adjacent duplicates', () => {
    const result = normaliseLocationHistory(
      [
        row('home', '2026-08-18T00:00:00.000Z'),
        row('driving', '2026-08-18T00:10:00.000Z'),
        row('not_home', '2026-08-18T00:20:00.000Z', 54.6),
        row('home', '2026-08-18T01:00:00.000Z'),
      ],
      range,
    );

    expect(result.transitions.map((transition) => transition.state)).toEqual(['home', 'away', 'home']);
    expect(result.transitions[1]).toMatchObject({ durationSeconds: 3000, point: { lat: 54.6, lng: -1.5 } });
    expect(result.summary).toEqual({ awaySeconds: 3000, outings: 1, latestState: 'home' });
  });

  it('ignores a short unknown or unavailable gap which returns to the prior state', () => {
    const result = normaliseLocationHistory(
      [
        row('home', '2026-08-18T00:00:00.000Z'),
        row('unknown', '2026-08-18T00:30:00.000Z'),
        row('home', '2026-08-18T00:32:00.000Z'),
        row('unavailable', '2026-08-18T00:40:00.000Z'),
        row('home', '2026-08-18T00:42:00.000Z'),
      ],
      range,
    );

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({ state: 'home', durationSeconds: 7200 });
  });

  it('does not count unknown or unavailable time as away', () => {
    const result = normaliseLocationHistory(
      [
        row('home', '2026-08-18T00:00:00.000Z'),
        row('unknown', '2026-08-18T00:10:00.000Z'),
        row('unavailable', '2026-08-18T00:20:00.000Z'),
        row('not_home', '2026-08-18T00:30:00.000Z'),
      ],
      range,
    );

    expect(result.summary.awaySeconds).toBe(5400);
    expect(result.transitions.map((transition) => transition.durationSeconds)).toEqual([600, 600, 600, 5400]);
  });

  it('clamps the final pre-range state to the requested start', () => {
    const result = normaliseLocationHistory(
      [
        row('home', '2026-08-17T20:00:00.000Z'),
        row('not_home', '2026-08-17T23:00:00.000Z'),
        row('home', '2026-08-18T01:00:00.000Z'),
      ],
      range,
    );

    expect(result.transitions).toHaveLength(2);
    expect(result.transitions[0]).toMatchObject({ at: range.start, state: 'away', durationSeconds: 3600 });
    expect(result.summary.awaySeconds).toBe(3600);
  });
});
