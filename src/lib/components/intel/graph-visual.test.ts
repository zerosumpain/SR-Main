import { describe, it, expect } from 'vitest';
import {
  STALE_FLOOR,
  RELEVANCE_SIZE_FLOOR,
  PAGE_BG,
  recencyFade,
  clusterColour,
  nodeRelevance,
  relevanceScale,
  relevancePhrase,
  washOut,
  weightRamp,
  edgeWidth,
  edgeEmphasis,
  edgeDistanceScale,
  edgeForceStrength,
} from './graph-visual';
import { RECENCY_FLOOR } from '$lib/jkai/intel/staleness';

// These are the rules BOTH graph views draw by, and the whole point of the
// module is that the two cannot disagree. Testing them here rather than through
// either component means the invariant is checked without a DOM, a WebGL context
// or a force simulation.

describe('recencyFade', () => {
  it('is 1 for current material and the floor for the stalest', () => {
    expect(recencyFade(1)).toBe(1);
    expect(recencyFade(RECENCY_FLOOR)).toBeCloseTo(STALE_FLOOR, 6);
  });

  it('never fades anything out of existence', () => {
    for (const r of [0, -1, RECENCY_FLOOR / 2]) {
      expect(recencyFade(r)).toBeGreaterThanOrEqual(STALE_FLOOR);
    }
  });

  it('leaves a node alone when nothing dated it', () => {
    expect(recencyFade(undefined)).toBe(1);
    expect(recencyFade(null)).toBe(1);
    expect(recencyFade(Number.NaN)).toBe(1);
  });
});

describe('nodeRelevance', () => {
  it('prefers the server-computed relevance', () => {
    expect(nodeRelevance({ relevance: 0.3, recency: 0.9 })).toBe(0.3);
  });

  it('falls back to recency for a payload from before the field existed', () => {
    expect(nodeRelevance({ recency: 0.42 })).toBe(0.42);
  });

  it('treats a payload with neither as fully relevant rather than dormant', () => {
    // The opposite default would draw an entire pre-deploy payload as stale,
    // which is a lie about the data rather than a missing enhancement.
    expect(nodeRelevance({})).toBe(1);
  });

  it('clamps out-of-range values', () => {
    expect(nodeRelevance({ relevance: 4 })).toBe(1);
    expect(nodeRelevance({ relevance: -2 })).toBe(0);
  });
});

describe('relevanceScale', () => {
  it('spans the floor to full size', () => {
    expect(relevanceScale(1)).toBe(1);
    expect(relevanceScale(0)).toBeCloseTo(RELEVANCE_SIZE_FLOOR, 6);
  });

  it('never shrinks a node away entirely', () => {
    for (const r of [0, 0.1, 0.5, 1]) {
      expect(relevanceScale(r)).toBeGreaterThanOrEqual(RELEVANCE_SIZE_FLOOR);
    }
  });

  it('is monotonic, so more relevant is never smaller', () => {
    let prev = -Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const s = relevanceScale(r);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe('relevancePhrase', () => {
  // The cuts are quartiles of the measured production distribution:
  // min 0.181 · p25 0.416 · p50 0.510 · p75 0.614 · max 0.920.
  it('splits the real distribution into four non-empty bands', () => {
    expect(relevancePhrase(0.92)).toBe('current');
    expect(relevancePhrase(0.614)).toBe('current');
    expect(relevancePhrase(0.51)).toBe('recent');
    expect(relevancePhrase(0.416)).toBe('recent');
    expect(relevancePhrase(0.3)).toBe('cooling');
    expect(relevancePhrase(0.181)).toBe('dormant');
  });
});

describe('washOut', () => {
  it('leaves a fully relevant colour untouched', () => {
    expect(washOut('#0e5b66', 1)).toBe('#0e5b66');
  });

  it('moves a dormant colour towards the page without reaching it', () => {
    const washed = washOut('#0e5b66', 0);
    expect(washed).not.toBe('#0e5b66');
    expect(washed).not.toBe(PAGE_BG);
    // Towards the cream, so every channel rises.
    const [r, g, b] = channels(washed);
    expect(r).toBeGreaterThan(0x0e);
    expect(g).toBeGreaterThan(0x5b);
    expect(b).toBeGreaterThan(0x66);
  });

  it('keeps clusters distinguishable at every age', () => {
    // The reason the wash is towards the background rather than to grey: two
    // clusters must not converge on the same colour just because both went
    // quiet, or the picture stops saying which is which.
    const a = washOut(clusterColour(0), 0);
    const b = washOut(clusterColour(1), 0);
    expect(a).not.toBe(b);
  });

  it('accepts a caller-supplied background, as the 3D view passes', () => {
    expect(washOut('#000000', 0, '#ffffff')).not.toBe(washOut('#000000', 0, '#000000'));
    expect(washOut('#000000', 0, '#000000')).toBe('#000000');
  });

  it('returns the input unchanged rather than throwing on a colour it cannot parse', () => {
    expect(washOut('not-a-colour', 0)).toBe('not-a-colour');
  });

  function channels(hex: string): [number, number, number] {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
});

describe('edge weight encodings', () => {
  it('ramps across the range the data actually occupies', () => {
    expect(weightRamp(0.25)).toBe(0);
    expect(weightRamp(0.5)).toBeCloseTo(0.5, 6);
    expect(weightRamp(0.75)).toBe(1);
    // Beyond the observed mass, clamped rather than extrapolated.
    expect(weightRamp(0.99)).toBe(1);
    expect(weightRamp(0)).toBe(0);
  });

  it('separates the three values 96% of the real graph sits on', () => {
    // 0.40 (965 edges), 0.55 (3,234) and 0.75+ (95) all rendered at the same
    // width under the old three-value `strength` bucket. They must not now.
    const widths = [0.4, 0.55, 0.8].map(edgeWidth);
    expect(new Set(widths.map((w) => w.toFixed(2))).size).toBe(3);
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
  });

  it('keeps widths in roughly the range the views were drawn at', () => {
    expect(edgeWidth(0.25)).toBeCloseTo(0.6, 6);
    expect(edgeWidth(0.75)).toBeCloseTo(2.8, 6);
  });

  it('never makes a weak link invisible', () => {
    expect(edgeEmphasis(0)).toBeGreaterThan(0.5);
    expect(edgeEmphasis(1)).toBeCloseTo(1, 6);
  });

  it('pulls well-corroborated pairs closer and harder', () => {
    expect(edgeDistanceScale(0.75)).toBeLessThan(edgeDistanceScale(0.25));
    expect(edgeForceStrength(0.75)).toBeGreaterThan(edgeForceStrength(0.25));
    // Still a spring, not a weld — a strength of 1 would collapse the layout.
    expect(edgeForceStrength(1)).toBeLessThan(0.6);
  });

  it('treats a missing weight as the middle rather than the weakest', () => {
    // An edge with no weight is unknown, not badly evidenced; drawing it at the
    // floor would assert something the data does not say.
    expect(weightRamp(undefined)).toBe(0.5);
    expect(weightRamp(null)).toBe(0.5);
  });
});
