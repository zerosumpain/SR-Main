import { describe, expect, it } from 'vitest';
import { PARTY_GAMES } from '$lib/games/party';
import { FALLBACK_ART, SR_MARK, TILE_ART, artFor, cells } from './pixel';

describe('pixel marks', () => {
  it('draws every party game its own art', () => {
    for (const game of PARTY_GAMES) expect(artFor(game), game).not.toBe(FALLBACK_ART);
  });

  it('keeps every grid rectangular and only cells or gaps', () => {
    for (const [id, { grid }] of Object.entries({ ...TILE_ART, sr: { grid: SR_MARK } })) {
      expect(new Set(grid.map((r) => r.length)).size, id).toBe(1);
      expect(grid.join(''), id).toMatch(/^[#.]+$/);
    }
  });

  it('lists the filled cells as column, row', () => {
    expect(cells(['#.', '.#'])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});
