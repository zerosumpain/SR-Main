import { describe, expect, it } from 'vitest';
import {
  branchTravel,
  buildPlanes,
  exitBranch,
  jumpTravel,
  pathTo,
  planeAxis,
  resolveArrow,
  windowStrip,
  type FlatSlide,
} from './navigation';

// Root row A B C; B has a vertical journey b1 b2; b2 has a horizontal
// sub-journey b2x b2y.
const rows: FlatSlide[] = [
  { id: 'A', parentSlideId: null, position: 0 },
  { id: 'B', parentSlideId: null, position: 1 },
  { id: 'C', parentSlideId: null, position: 2 },
  { id: 'b1', parentSlideId: 'B', position: 0 },
  { id: 'b2', parentSlideId: 'B', position: 1 },
  { id: 'b2x', parentSlideId: 'b2', position: 0 },
  { id: 'b2y', parentSlideId: 'b2', position: 1 },
];

describe('buildPlanes / pathTo / planeAxis', () => {
  it('orders planes by position', () => {
    const planes = buildPlanes(rows);
    expect(planes.get(null)).toEqual(['A', 'B', 'C']);
    expect(planes.get('B')).toEqual(['b1', 'b2']);
    expect(planes.get('b2')).toEqual(['b2x', 'b2y']);
  });

  it('pathTo returns the root-first chain', () => {
    expect(pathTo(rows, 'b2y')).toEqual(['B', 'b2', 'b2y']);
    expect(pathTo(rows, 'A')).toEqual(['A']);
  });

  it('axis alternates by depth', () => {
    expect(planeAxis(0)).toBe('h');
    expect(planeAxis(1)).toBe('v');
    expect(planeAxis(2)).toBe('h');
  });
});

describe('resolveArrow — root (horizontal) plane', () => {
  it('right/left walk siblings', () => {
    expect(resolveArrow(rows, 'A', 'right')).toEqual({ id: 'B', travel: 'right' });
    expect(resolveArrow(rows, 'B', 'left')).toEqual({ id: 'A', travel: 'left' });
  });

  it('no wrap at the ends, no exit above the root', () => {
    expect(resolveArrow(rows, 'C', 'right')).toBeNull();
    expect(resolveArrow(rows, 'A', 'left')).toBeNull();
    expect(resolveArrow(rows, 'A', 'up')).toBeNull();
  });

  it('down enters the branch only where one exists', () => {
    expect(resolveArrow(rows, 'B', 'down')).toEqual({ id: 'b1', travel: 'down' });
    expect(resolveArrow(rows, 'A', 'down')).toBeNull();
  });
});

describe('resolveArrow — vertical journey', () => {
  it('down/up walk the stack', () => {
    expect(resolveArrow(rows, 'b1', 'down')).toEqual({ id: 'b2', travel: 'down' });
    expect(resolveArrow(rows, 'b2', 'up')).toEqual({ id: 'b1', travel: 'up' });
  });

  it('up past the first slide climbs back to the parent', () => {
    expect(resolveArrow(rows, 'b1', 'up')).toEqual({ id: 'B', travel: 'up' });
  });

  it('right enters the sub-journey; left does nothing', () => {
    expect(resolveArrow(rows, 'b2', 'right')).toEqual({ id: 'b2x', travel: 'right' });
    expect(resolveArrow(rows, 'b1', 'right')).toBeNull();
    expect(resolveArrow(rows, 'b1', 'left')).toBeNull();
  });

  it('no forward past the end of the stack (no spill)', () => {
    expect(resolveArrow(rows, 'b2', 'down')).toBeNull();
  });
});

describe('resolveArrow — horizontal sub-journey', () => {
  it('right/left walk the sub-row; left at the first slide exits to the parent', () => {
    expect(resolveArrow(rows, 'b2x', 'right')).toEqual({ id: 'b2y', travel: 'right' });
    expect(resolveArrow(rows, 'b2y', 'left')).toEqual({ id: 'b2x', travel: 'left' });
    expect(resolveArrow(rows, 'b2x', 'left')).toEqual({ id: 'b2', travel: 'left' });
  });
});

describe('exitBranch', () => {
  it('climbs up out of a vertical journey, left out of a horizontal one', () => {
    expect(exitBranch(rows, 'b2')).toEqual({ id: 'B', travel: 'up' });
    expect(exitBranch(rows, 'b2y')).toEqual({ id: 'b2', travel: 'left' });
    expect(exitBranch(rows, 'A')).toBeNull();
  });
});

describe('branchTravel / jumpTravel', () => {
  it('pills point down off rows, right off columns', () => {
    expect(branchTravel(0)).toBe('down');
    expect(branchTravel(1)).toBe('right');
  });

  it('nav-map jumps pick a sensible travel', () => {
    expect(jumpTravel(rows, 'A', 'C')).toBe('right');
    expect(jumpTravel(rows, 'C', 'A')).toBe('left');
    expect(jumpTravel(rows, 'B', 'b2')).toBe('down');
    expect(jumpTravel(rows, 'b2y', 'b2')).toBe('left');
    expect(jumpTravel(rows, 'b2', 'B')).toBe('up');
    expect(jumpTravel(rows, 'b1', 'b2')).toBe('down');
  });
});

describe('windowStrip', () => {
  it('shows one behind, the active dot and the next four, with ellipses', () => {
    // 18-dot root plane, standing on dot 8
    expect(windowStrip(18, 8)).toEqual({ start: 7, end: 13, leading: true, trailing: true });
  });

  it('clamps at the start — no leading ellipsis on the first dots', () => {
    expect(windowStrip(18, 0)).toEqual({ start: 0, end: 5, leading: false, trailing: true });
    expect(windowStrip(18, 1)).toEqual({ start: 0, end: 6, leading: false, trailing: true });
  });

  it('clamps at the end — no trailing ellipsis on the last dots', () => {
    expect(windowStrip(18, 17)).toEqual({ start: 16, end: 18, leading: true, trailing: false });
  });

  it('short strips render whole', () => {
    expect(windowStrip(4, 2)).toEqual({ start: 1, end: 4, leading: true, trailing: false });
    expect(windowStrip(3, 0)).toEqual({ start: 0, end: 3, leading: false, trailing: false });
  });

  it('tolerates out-of-range active indices', () => {
    expect(windowStrip(5, -1).start).toBe(0);
    expect(windowStrip(5, 99).end).toBe(5);
  });
});
