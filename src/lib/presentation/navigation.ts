// Pure tree-walking for the deck player. A deck's slides form a tree
// (parentSlideId); each parent's children are one ordered "plane". Planes
// alternate axis by depth — the root plane runs left→right, a slide's
// children run downward (a vertical journey), THEIR children run rightward
// again, and so on. Arrows move along the current plane's axis; the free
// axis enters a branch (advertised by the pill) or climbs back out. No zoom,
// no spill-out. Pure functions, no Svelte/DOM: unit-tested in
// navigation.test.ts.

export interface FlatSlide {
  id: string;
  parentSlideId: string | null;
  position: number;
}

export type Axis = 'h' | 'v';
export type Travel = 'left' | 'right' | 'up' | 'down';
export type ArrowKey = 'left' | 'right' | 'up' | 'down';

export interface Move {
  id: string;
  /** Which way the camera travels — drives the glide transition. */
  travel: Travel;
}

/** parent id (null = root plane) → child ids ordered by position. */
export function buildPlanes(rows: FlatSlide[]): Map<string | null, string[]> {
  const planes = new Map<string | null, FlatSlide[]>();
  for (const row of rows) {
    const list = planes.get(row.parentSlideId) ?? [];
    list.push(row);
    planes.set(row.parentSlideId, list);
  }
  const out = new Map<string | null, string[]>();
  for (const [parent, list] of planes) {
    out.set(
      parent,
      list.sort((a, b) => a.position - b.position).map((s) => s.id),
    );
  }
  return out;
}

function parentOf(rows: FlatSlide[], id: string): string | null {
  return rows.find((r) => r.id === id)?.parentSlideId ?? null;
}

/** Ancestor chain root-first, including `current` (drives the nav map). */
export function pathTo(rows: FlatSlide[], current: string): string[] {
  const chain: string[] = [];
  let id: string | null = current;
  let guard = 0;
  while (id && guard++ < 100) {
    chain.unshift(id);
    id = parentOf(rows, id);
  }
  return chain;
}

/** Root plane is horizontal; each level down flips the axis. */
export function planeAxis(depth: number): Axis {
  return depth % 2 === 0 ? 'h' : 'v';
}

/**
 * Resolve an arrow key against the current position.
 *
 * On the plane's own axis the arrows walk siblings (back past the first slide
 * climbs out to the parent). The branch arrow (the free axis, forward) enters
 * the first child when one exists. The remaining arrow does nothing — exiting
 * a branch retraces the way you came (or Escape / the nav map).
 */
export function resolveArrow(rows: FlatSlide[], current: string, key: ArrowKey): Move | null {
  const planes = buildPlanes(rows);
  const chain = pathTo(rows, current);
  const depth = chain.length - 1;
  const axis = planeAxis(depth);
  const parent = chain.length > 1 ? chain[chain.length - 2] : null;
  const plane = planes.get(parent) ?? [];
  const idx = plane.indexOf(current);

  const forward = axis === 'h' ? 'right' : 'down';
  const back = axis === 'h' ? 'left' : 'up';
  const branch = axis === 'h' ? 'down' : 'right';

  if (key === forward) {
    return idx !== -1 && idx < plane.length - 1 ? { id: plane[idx + 1], travel: forward } : null;
  }
  if (key === back) {
    if (idx > 0) return { id: plane[idx - 1], travel: back };
    return parent ? { id: parent, travel: back } : null;
  }
  if (key === branch) {
    const child = planes.get(current)?.[0];
    return child ? { id: child, travel: branch } : null;
  }
  return null;
}

/** Escape / "back to the path": climb to the parent, travelling the way we
 *  originally branched in (up out of a vertical journey, left out of a
 *  horizontal one). Null on the root plane. */
export function exitBranch(rows: FlatSlide[], current: string): Move | null {
  const chain = pathTo(rows, current);
  if (chain.length < 2) return null;
  const axis = planeAxis(chain.length - 1);
  return { id: chain[chain.length - 2], travel: axis === 'v' ? 'up' : 'left' };
}

/** Direction of the pill on a slide that has children: where its journey
 *  starts. Down off horizontal planes, right off vertical ones. */
export function branchTravel(depth: number): 'down' | 'right' {
  return planeAxis(depth) === 'h' ? 'down' : 'right';
}

/** Travel for a nav-map jump: descend along the target's chain axis, rise
 *  along the current one; siblings glide on their plane axis. */
export function jumpTravel(rows: FlatSlide[], current: string, target: string): Travel {
  const from = pathTo(rows, current);
  const to = pathTo(rows, target);
  if (to.length > from.length) return branchTravel(to.length - 2);
  if (to.length < from.length) return planeAxis(from.length - 1) === 'v' ? 'up' : 'left';
  const axis = planeAxis(to.length - 1);
  const planes = buildPlanes(rows);
  const parent = to.length > 1 ? to[to.length - 2] : null;
  const plane = planes.get(parent) ?? [];
  const forward = plane.indexOf(target) >= plane.indexOf(current);
  if (axis === 'h') return forward ? 'right' : 'left';
  return forward ? 'down' : 'up';
}
