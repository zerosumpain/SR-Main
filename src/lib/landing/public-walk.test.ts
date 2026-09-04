import { describe, expect, it } from 'vitest';
import { PUBLIC_WALK_EXPIRE_MS, publicWalkState } from './public-walk';

describe('publicWalkState', () => {
  it('exposes only whether a current private GPS broadcast is active', () => {
    const now = 1_800_000_000_000;
    const result = publicWalkState({
      receivedAt: now - 1_000,
      status: 'recording',
      routeName: 'Home to secret destination',
      distanceKm: 4.2,
      startedAt: now - 30_000,
      elevationGainM: 120,
      track: [{ lat: 51.5, lng: -0.1 }],
    }, now);

    expect(result).toEqual({ active: true });
    expect(Object.keys(result)).toEqual(['active']);
  });

  it('reports finished, expired, and malformed broadcasts as inactive', () => {
    const now = 1_800_000_000_000;
    expect(publicWalkState({ receivedAt: now, status: 'finished' }, now)).toEqual({ active: false });
    expect(publicWalkState({ receivedAt: now - PUBLIC_WALK_EXPIRE_MS - 1 }, now)).toEqual({ active: false });
    expect(publicWalkState({ receivedAt: 'recent' }, now)).toEqual({ active: false });
    expect(publicWalkState(null, now)).toEqual({ active: false });
  });
});
