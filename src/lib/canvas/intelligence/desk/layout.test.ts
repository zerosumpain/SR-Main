import { describe, it, expect } from 'vitest';
import { hashId, scatterPosition, GRID, BAND, PHASE_TO_BAND } from './layout';

describe('hashId', () => {
  it('is deterministic for the same input', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('source-42')).toBe(hashId('source-42'));
  });

  it('returns a non-negative 32-bit integer', () => {
    for (const id of ['', 'a', 'fact-1', 'a-very-long-uuid-0123456789abcdef']) {
      const h = hashId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('differs for single-character changes (no trivial collisions)', () => {
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(hashId('abc')).not.toBe(hashId('cba'));
    expect(hashId('fact-1')).not.toBe(hashId('fact-2'));
  });

  it('is well distributed across a large id set (low collision rate)', () => {
    const seen = new Set<number>();
    const N = 2000;
    for (let i = 0; i < N; i++) seen.add(hashId(`artefact-${i}`));
    // Allow a tiny number of collisions but demand near-injectivity.
    expect(seen.size).toBeGreaterThan(N * 0.999);
  });
});

describe('scatterPosition', () => {
  it('is deterministic: same (id, phase) -> same position', () => {
    expect(scatterPosition('fact-7', 2)).toEqual(scatterPosition('fact-7', 2));
    expect(scatterPosition('source-x', 1)).toEqual(scatterPosition('source-x', 1));
  });

  it('snaps both coordinates to the grid', () => {
    for (const id of ['a', 'b', 'long-artefact-id-123', 'zzz']) {
      for (const phase of [1, 2, 3] as const) {
        const p = scatterPosition(id, phase);
        expect(p.x % GRID).toBe(0);
        expect(p.y % GRID).toBe(0);
      }
    }
  });

  it('places each phase inside its own horizontal band (no cross-band bleed)', () => {
    for (const phase of [1, 2, 3] as const) {
      const band = PHASE_TO_BAND[phase];
      const lo = BAND.originX + band * BAND.width;
      const hi = lo + BAND.width;
      for (let i = 0; i < 400; i++) {
        const { x } = scatterPosition(`p${phase}-${i}`, phase);
        expect(x).toBeGreaterThanOrEqual(lo);
        // card body must fit within the band, not just its origin
        expect(x + BAND.cardW).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("treats 'post' as the phase-3 band", () => {
    const band = PHASE_TO_BAND['post'];
    const lo = BAND.originX + band * BAND.width;
    const hi = lo + BAND.width;
    for (let i = 0; i < 100; i++) {
      const { x } = scatterPosition(`post-${i}`, 'post' as unknown as number);
      expect(x).toBeGreaterThanOrEqual(lo);
      expect(x + BAND.cardW).toBeLessThanOrEqual(hi);
    }
  });

  it('keeps Y within the band envelope', () => {
    for (let i = 0; i < 400; i++) {
      const { y } = scatterPosition(`y-${i}`, 2);
      expect(y).toBeGreaterThanOrEqual(BAND.originY);
      expect(y + BAND.cardH).toBeLessThanOrEqual(BAND.originY + BAND.height);
    }
  });

  it('avoids pathological overlap within a single band (distinct grid cells dominate)', () => {
    // Map 300 distinct ids in one band and assert most land on distinct
    // grid cells — proves the jitter spreads them, not a single hot spot.
    const cells = new Set<string>();
    const N = 300;
    for (let i = 0; i < N; i++) {
      const p = scatterPosition(`band-test-${i}`, 1);
      cells.add(`${p.x},${p.y}`);
    }
    expect(cells.size).toBeGreaterThan(N * 0.9);
  });

  it('different phases for the same id generally differ horizontally', () => {
    const a = scatterPosition('same-id', 1);
    const b = scatterPosition('same-id', 3);
    expect(a.x).not.toBe(b.x);
  });
});
