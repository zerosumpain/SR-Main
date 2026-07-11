// Pure tree-walking for the deck player. A deck's slides form a tree
// (parentSlideId); each parent's children are one ordered "plane". Linear
// navigation walks a plane's siblings; the end of a sub-plane spills out to
// the parent's next sibling (recursively) — the "zoom back out and carry on"
// gesture. Pure functions, no Svelte/DOM: unit-tested in navigation.test.ts.

export interface FlatSlide {
  id: string;
  parentSlideId: string | null;
  position: number;
}

export interface NavMove {
  id: string;
  move: 'sibling' | 'zoomOut';
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

/**
 * The slide after `current`: its next sibling, or — from the last slide of a
 * sub-plane — the parent plane's next slide (recursing upward). Null at the
 * very end of the deck.
 */
export function nextSlide(rows: FlatSlide[], current: string): NavMove | null {
  const planes = buildPlanes(rows);
  let id = current;
  let hops = 0;
  while (true) {
    const parent = parentOf(rows, id);
    const plane = planes.get(parent) ?? [];
    const idx = plane.indexOf(id);
    if (idx !== -1 && idx < plane.length - 1) {
      return { id: plane[idx + 1], move: hops === 0 ? 'sibling' : 'zoomOut' };
    }
    if (parent === null) return null; // end of the root plane
    id = parent; // spill out: continue from the parent's position
    hops++;
  }
}

/**
 * The slide before `current`: its previous sibling, or — from the first slide
 * of a sub-plane — the parent slide itself (zoom back out). Null at the first
 * root slide.
 */
export function prevSlide(rows: FlatSlide[], current: string): NavMove | null {
  const planes = buildPlanes(rows);
  const parent = parentOf(rows, current);
  const plane = planes.get(parent) ?? [];
  const idx = plane.indexOf(current);
  if (idx > 0) return { id: plane[idx - 1], move: 'sibling' };
  if (parent !== null) return { id: parent, move: 'zoomOut' };
  return null;
}

/** First child of `current`, or null on a leaf. */
export function zoomIn(rows: FlatSlide[], current: string): string | null {
  const planes = buildPlanes(rows);
  return planes.get(current)?.[0] ?? null;
}

/** Ancestor chain root-first, including `current` (drives the breadcrumb). */
export function breadcrumb(rows: FlatSlide[], current: string): string[] {
  const chain: string[] = [];
  let id: string | null = current;
  let guard = 0;
  while (id && guard++ < 100) {
    chain.unshift(id);
    id = parentOf(rows, id);
  }
  return chain;
}
