import { describe, expect, it } from 'vitest';
import { bidProblem } from './liars-dice';
import { bidWords, counts, defaultBid, facesAt, legalQuantities } from './liars-dice-view';

describe("the web table's bid picker", () => {
  it('offers exactly what the rules module accepts, for every standing bid on a small table', () => {
    for (const wild of [true, false]) {
      const standings = [null, { quantity: 1, face: 6 }, { quantity: 3, face: 2 }, { quantity: 6, face: 5 }];
      for (const standing of standings) {
        for (const q of legalQuantities(standing, 6, wild)) {
          for (const f of facesAt(q, standing, 6, wild)) {
            expect(f.legal).toBe(bidProblem({ quantity: q, face: f.face }, standing, 6, wild) === null);
          }
        }
      }
    }
  });

  it('starts on the smallest raise', () => {
    expect(defaultBid(null, 10, true)).toEqual({ quantity: 1, face: 2 });
    expect(defaultBid(null, 10, false)).toEqual({ quantity: 1, face: 1 });
    expect(defaultBid({ quantity: 3, face: 4 }, 10, true)).toEqual({ quantity: 3, face: 5 });
    expect(defaultBid({ quantity: 3, face: 6 }, 10, true)).toEqual({ quantity: 4, face: 2 });
    // Nothing left to bid: only "liar" remains.
    expect(defaultBid({ quantity: 10, face: 6 }, 10, true)).toBeNull();
    expect(legalQuantities({ quantity: 10, face: 6 }, 10, true)).toEqual([]);
  });

  it('counts a one towards any face only when ones are wild', () => {
    expect(counts(1, 4, true)).toBe(true);
    expect(counts(1, 4, false)).toBe(false);
    expect(counts(4, 4, false)).toBe(true);
  });

  it('says a bid the way a player would', () => {
    expect(bidWords({ quantity: 4, face: 3 })).toBe('four 3s');
    expect(bidWords({ quantity: 1, face: 6 })).toBe('one 6');
    expect(bidWords({ quantity: 12, face: 2 })).toBe('12 2s');
  });
});
