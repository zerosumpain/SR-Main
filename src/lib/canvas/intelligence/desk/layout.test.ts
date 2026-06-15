import { describe, it, expect } from 'vitest';
import { hashId, scatterPosition, GRID, BAND, PHASE_TO_BAND, organisedLayout, ORG, SYNTHESIS_ZONE_GAP, SYNTHESIS_ZONE_ORIGIN, type LayoutArtefact, type LayoutCategory } from './layout';

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

// All symbols imported at the top of the file.

const cat = (id: string, title = id): LayoutCategory => ({ id, title });

describe('organisedLayout', () => {
  it('returns a position for every non-override artefact, keyed by id', () => {
    const cats = [cat('c1'), cat('c2')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c2' },
      { id: 'e1', kind: 'entity' },
    ];
    const map = organisedLayout(arts, cats);
    expect(map.size).toBe(3);
    for (const a of arts) expect(map.has(a.id)).toBe(true);
  });

  it('groups facts under their category into distinct columns', () => {
    const cats = [cat('c1'), cat('c2')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c1' },
      { id: 'g1', kind: 'fact', categoryId: 'c2' },
    ];
    const map = organisedLayout(arts, cats);
    const f1 = map.get('f1')!;
    const f2 = map.get('f2')!;
    const g1 = map.get('g1')!;
    // Same category -> same column X.
    expect(f1.x).toBe(f2.x);
    // Different category -> different (further right) column X.
    expect(g1.x).toBeGreaterThan(f1.x);
    // Stacked vertically within the column, header reserves the top slot.
    expect(f2.y).toBeGreaterThan(f1.y);
    expect(f1.y).toBeGreaterThan(map.get('__header_placeholder__')?.y ?? -Infinity);
  });

  it('places categories left-to-right in array order', () => {
    const cats = [cat('first'), cat('second'), cat('third')];
    const arts: LayoutArtefact[] = [
      { id: 'a', kind: 'fact', categoryId: 'third' },
      { id: 'b', kind: 'fact', categoryId: 'first' },
      { id: 'c', kind: 'fact', categoryId: 'second' },
    ];
    const map = organisedLayout(arts, cats);
    expect(map.get('b')!.x).toBeLessThan(map.get('c')!.x);
    expect(map.get('c')!.x).toBeLessThan(map.get('a')!.x);
  });

  it('sends unmatched / undefined categories to a trailing column', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'u1', kind: 'fact', categoryId: 'nope' },
      { id: 'u2', kind: 'fact' },
    ];
    const map = organisedLayout(arts, cats);
    // u1/u2 share the trailing uncategorised column, to the right of c1.
    expect(map.get('u1')!.x).toBe(map.get('u2')!.x);
    expect(map.get('u1')!.x).toBeGreaterThan(map.get('f1')!.x);
  });

  it('collects entities into the bottom rail, below all columns', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c1' },
      { id: 'e1', kind: 'entity', categoryId: 'c1' }, // categoryId ignored for entities
      { id: 'e2', kind: 'entity' },
    ];
    const map = organisedLayout(arts, cats);
    const railY = map.get('e1')!.y;
    expect(map.get('e2')!.y).toBe(railY); // same rail row
    // Rail sits below the fact stack.
    expect(railY).toBeGreaterThan(map.get('f2')!.y);
    // Entities are laid out horizontally on the rail.
    expect(map.get('e2')!.x).toBeGreaterThan(map.get('e1')!.x);
  });

  it('wraps the entity rail when it overflows railWidth', () => {
    const cats = [cat('c1')];
    const perRow = Math.floor(ORG.railWidth / ORG.entityStride);
    const arts: LayoutArtefact[] = [];
    for (let i = 0; i < perRow + 2; i++) arts.push({ id: `e${i}`, kind: 'entity' });
    const map = organisedLayout(arts, cats);
    const firstRowY = map.get('e0')!.y;
    const wrappedY = map.get(`e${perRow}`)!.y; // first entity past the row
    expect(wrappedY).toBeGreaterThan(firstRowY);
    // wrapped entity restarts at the rail's left edge
    expect(map.get(`e${perRow}`)!.x).toBe(map.get('e0')!.x);
  });

  it('respects non-null overrides verbatim (pinned cards never move)', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'pinned', kind: 'fact', categoryId: 'c1', override: { x: 1234, y: 5678 } },
      { id: 'free', kind: 'fact', categoryId: 'c1' },
    ];
    const map = organisedLayout(arts, cats);
    expect(map.get('pinned')).toEqual({ x: 1234, y: 5678 });
    // The free card still gets a computed (different) slot.
    expect(map.get('free')).not.toEqual({ x: 1234, y: 5678 });
  });

  it('does not let an override consume a column slot', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'pinned', kind: 'fact', categoryId: 'c1', override: { x: 999, y: 999 } },
      { id: 'a', kind: 'fact', categoryId: 'c1' },
      { id: 'b', kind: 'fact', categoryId: 'c1' },
    ];
    const map = organisedLayout(arts, cats);
    // a and b take the first two non-header rows; the pinned card didn't push them down.
    const gap = map.get('b')!.y - map.get('a')!.y;
    expect(gap).toBe(ORG.rowStride);
  });

  it('is deterministic and grid-snapped', () => {
    const cats = [cat('c1'), cat('c2')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c2' },
      { id: 'e1', kind: 'entity' },
    ];
    const a = organisedLayout(arts, cats);
    const b = organisedLayout(arts, cats);
    for (const id of ['f1', 'f2', 'e1']) {
      expect(a.get(id)).toEqual(b.get(id));
      expect(a.get(id)!.x % GRID).toBe(0);
      expect(a.get(id)!.y % GRID).toBe(0);
    }
  });

  it('handles an empty artefact list', () => {
    expect(organisedLayout([], [cat('c1')]).size).toBe(0);
  });

  // ——— synthesis zone spatial separation ———

  it('synthesis zone origin is below the scatter region with the required gap', () => {
    const scatterMaxY = BAND.originY + BAND.height; // 1600
    expect(SYNTHESIS_ZONE_ORIGIN.y).toBeGreaterThanOrEqual(scatterMaxY + SYNTHESIS_ZONE_GAP);
  });

  it('organised positions do NOT overlap the scatter region (minY ≥ scatterMaxY + gap)', () => {
    // A realistic layout: 3 categories × 4 facts + 3 entities.
    const cats = [cat('c1'), cat('c2'), cat('c3')];
    const arts: LayoutArtefact[] = [];
    for (let i = 0; i < 4; i++) arts.push({ id: `f1-${i}`, kind: 'fact', categoryId: 'c1' });
    for (let i = 0; i < 4; i++) arts.push({ id: `f2-${i}`, kind: 'fact', categoryId: 'c2' });
    for (let i = 0; i < 4; i++) arts.push({ id: `f3-${i}`, kind: 'fact', categoryId: 'c3' });
    for (let i = 0; i < 3; i++) arts.push({ id: `e-${i}`, kind: 'entity' });
    const map = organisedLayout(arts, cats);

    const scatterMaxY = BAND.originY + BAND.height; // 1600
    const scatterMaxX = BAND.originX + (Math.max(...Object.values({ 0: 0, 1: 1, 2: 2 })) + 1) * BAND.width; // 2160

    let minOrganisedY = Infinity;
    for (const pos of map.values()) {
      if (pos.y < minOrganisedY) minOrganisedY = pos.y;
    }
    // The synthesis zone must start below scatter + gap, not just at scatter boundary.
    expect(minOrganisedY).toBeGreaterThanOrEqual(scatterMaxY + SYNTHESIS_ZONE_GAP);
    // Sanity: the zone's X origin must also be within the scatter width (starts at 0).
    expect(ORG.originX).toBeGreaterThanOrEqual(0);
    expect(ORG.originX).toBeLessThanOrEqual(scatterMaxX);
  });

  it('ORG.originY matches SYNTHESIS_ZONE_ORIGIN.y', () => {
    expect(ORG.originY).toBe(SYNTHESIS_ZONE_ORIGIN.y);
  });
});
