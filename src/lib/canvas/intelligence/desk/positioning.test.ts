import { describe, it, expect } from 'vitest';
import { effectivePosition, type PosCard } from './positioning';
import {
  scatterPosition,
  organisedLayout,
  organisedCorePxBounds,
  accumulationScatter,
} from './layout';

function card(p: Partial<PosCard> & { id: string }): PosCard {
  return {
    id: p.id,
    kind: p.kind ?? 'fact',
    phase: p.phase ?? 1,
    canvasX: p.canvasX ?? null,
    canvasY: p.canvasY ?? null,
    pinned: p.pinned ?? false,
    deskState: p.deskState ?? 'unfiled',
    deskCategory: p.deskCategory ?? null,
  };
}

describe('effectivePosition', () => {
  const organised = organisedLayout(
    [{ id: 'f1', kind: 'fact', categoryId: 'c1' }],
    [{ id: 'c1', title: 'C1' }],
  );
  const bounds = organisedCorePxBounds(organised);

  it('pinned/dragged cards keep canvasX/Y in BOTH modes', () => {
    const c = card({ id: 'f1', canvasX: 999, canvasY: 111, pinned: true, deskState: 'synthesized', deskCategory: 'c1' });
    expect(effectivePosition(c, 'gather', organised, bounds)).toEqual({ x: 999, y: 111 });
    expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual({ x: 999, y: 111 });
  });

  it('a non-pinned card with explicit canvasX/Y still honours it (user-dragged)', () => {
    const c = card({ id: 'f1', canvasX: 40, canvasY: 60, deskCategory: 'c1', deskState: 'synthesized' });
    expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual({ x: 40, y: 60 });
  });

  it('SYNTHESIZE: a filed card with no manual position takes its organised slot', () => {
    const c = card({ id: 'f1', deskCategory: 'c1', deskState: 'synthesized' });
    expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual(organised.get('f1'));
  });

  it('GATHER (sticky): a synthesized card STAYS at its organised slot, does not eject', () => {
    const c = card({ id: 'f1', deskCategory: 'c1', deskState: 'synthesized' });
    expect(effectivePosition(c, 'gather', organised, bounds)).toEqual(organised.get('f1'));
  });

  it('GATHER: an unfiled phase-1 card uses deterministic scatterPosition', () => {
    const c = card({ id: 'u1', deskState: 'unfiled', phase: 1 });
    expect(effectivePosition(c, 'gather', organised, bounds)).toEqual(scatterPosition('u1', 1));
  });

  it('GATHER: a NEW arrival (post-synthesis, phase 4) scatters AROUND the core', () => {
    const c = card({ id: 'late1', deskState: 'unfiled', phase: 4 });
    expect(effectivePosition(c, 'gather', organised, bounds)).toEqual(accumulationScatter('late1', bounds));
  });

  it('SYNTHESIZE: an unfiled post-synthesis card parks around the core, not over it', () => {
    const c = card({ id: 'late2', deskState: 'unfiled', phase: 4 });
    expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual(accumulationScatter('late2', bounds));
  });

  it('a filed card without an organised slot parks around the core, never (0,0)', () => {
    const c = card({ id: 'orphan', deskState: 'filed', deskCategory: 'cX' });
    const p = effectivePosition(c, 'synthesize', organised, bounds);
    expect(p).toEqual(accumulationScatter('orphan', bounds));
    expect(p).not.toEqual({ x: 0, y: 0 });
  });
});
