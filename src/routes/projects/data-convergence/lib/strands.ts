// Strand mathematics for the convergence timeline.
//
// Responsibilities:
//   * Validate the DAG of merges (no cycles, all targets exist, terminates at spine).
//   * Resolve a flat config into a tree layout with vertical offsets that scale by
//     subtree weight so confluences are visually clear and strands don't overlap.
//   * Produce per-frame strand geometry for the canvas renderer:
//       - centreline y(t) including ease-onto-parent near merge date,
//       - amplitude(t) tapering to zero near merge date,
//       - thickness given the playhead position (sum of merged constituents).
//
// All units are tunable from the top of the file.

import type {
  StrandConfig,
  ResolvedStrand,
  ResolvedModel,
  LayoutNode,
  ID,
  ValidationIssue,
} from './types';

// ------- Tunable constants -------
//
// We keep layout (vertical offsets) and visual weight (stroke thickness) on
// different curves so a 900-user strand doesn't dwarf an 80-user strand visually.

/** Vertical room each "unit of subtree weight" takes (in *layout pixels*).
 *  The renderer applies an additional fit-to-canvas scale on top of this so
 *  the whole composition always fits the available height. */
export const WEIGHT_TO_PX = 0.1;
/** Smallest band between sibling strands regardless of weight (layout px). */
export const MIN_SIBLING_GAP = 28;
/** Minimum stroke thickness in px (1 user). */
export const MIN_THICKNESS = 1.6;
/** Thickness scaling exponent (sqrt-ish — large sources stay readable). */
export const THICKNESS_EXP = 0.45;
/** Scale factor on top of the exponent — px per scaled-users unit. */
export const THICKNESS_SCALE = 0.55;
/** Spine's intrinsic baseline thickness (px) before any strands have merged in. */
export const SPINE_BASE_THICKNESS = 3;
/** Fraction of a strand's lifespan over which it converges onto its parent. */
export const CONVERGE_WINDOW = 0.32;
/** Wavelength scaling — px of canvas covered per oscillation period at 1/day. */
export const PX_PER_DAY_WAVE = 14;
/** Max amplitude (px) at the broadest oscillation. */
export const MAX_AMPLITUDE = 18;

// ------- Public API -------

/** Resolve a raw config list into the model used by every other module. */
export function resolveModel(config: StrandConfig[]): ResolvedModel {
  const issues: ValidationIssue[] = [];

  // Pass 1: parse dates, validate basic shape, build id map.
  const byId = new Map<ID, StrandConfig>();
  for (const s of config) {
    if (byId.has(s.id)) {
      issues.push({ level: 'error', strandId: s.id, message: `Duplicate id "${s.id}".` });
    }
    byId.set(s.id, s);
  }

  // Pass 2: merge target validity & date sanity.
  for (const s of config) {
    if (s.mergeInto !== 'spine' && !byId.has(s.mergeInto)) {
      issues.push({
        level: 'error',
        strandId: s.id,
        message: `"${s.name}" merges into unknown target "${s.mergeInto}".`,
      });
    }
    if (s.mergeInto === s.id) {
      issues.push({ level: 'error', strandId: s.id, message: `"${s.name}" merges into itself.` });
    }
    const start = Date.parse(s.startDate);
    const merge = Date.parse(s.mergeDate);
    if (!Number.isFinite(start) || !Number.isFinite(merge)) {
      issues.push({
        level: 'error',
        strandId: s.id,
        message: `"${s.name}" has an invalid date.`,
      });
    } else if (merge <= start) {
      issues.push({
        level: 'error',
        strandId: s.id,
        message: `"${s.name}" merges before (or as) it starts.`,
      });
    }
  }

  // Pass 3: cycle detection — DFS with grey/black colouring.
  const colour = new Map<ID, 0 | 1 | 2>();
  function visit(id: ID): boolean {
    const c = colour.get(id) ?? 0;
    if (c === 1) return false; // grey => cycle
    if (c === 2) return true;
    colour.set(id, 1);
    const node = byId.get(id);
    if (node && node.mergeInto !== 'spine' && byId.has(node.mergeInto)) {
      if (!visit(node.mergeInto)) return false;
    }
    colour.set(id, 2);
    return true;
  }
  for (const s of config) {
    if (!visit(s.id)) {
      issues.push({
        level: 'error',
        strandId: s.id,
        message: `"${s.name}" is part of a cycle.`,
      });
    }
  }

  // Pass 4: warn when a strand's merge date is after its target has merged on.
  for (const s of config) {
    if (s.mergeInto === 'spine') continue;
    const target = byId.get(s.mergeInto);
    if (!target) continue;
    const sMerge = Date.parse(s.mergeDate);
    const tMerge = Date.parse(target.mergeDate);
    if (Number.isFinite(sMerge) && Number.isFinite(tMerge) && sMerge > tMerge) {
      issues.push({
        level: 'warning',
        strandId: s.id,
        message: `"${s.name}" merges into "${target.name}" after that target itself has merged onward.`,
      });
    }
  }

  // Compute ancestry chains, ignoring strands that are part of broken graphs.
  const errorIds = new Set(
    issues.filter((i) => i.level === 'error' && i.strandId).map((i) => i.strandId as ID),
  );
  function ancestry(id: ID): (ID | 'spine')[] {
    const seen = new Set<ID>();
    const chain: (ID | 'spine')[] = [id];
    let cur: ID | 'spine' = id;
    while (cur !== 'spine') {
      if (seen.has(cur)) return chain; // belt-and-braces against cycles
      seen.add(cur);
      const n = byId.get(cur);
      if (!n) break;
      cur = n.mergeInto;
      chain.push(cur);
    }
    return chain;
  }

  // Layout: place strands as a tree rooted at the spine.
  // - Children of a node are ordered by start date (stable for the eye).
  // - Each child's offset = midpoint of its slice within the parent's slot,
  //   alternating above / below in proportion to its subtree weight.
  // - The spine itself sits at y = 0.

  // Build adjacency (only over strands that aren't in the error set).
  const children = new Map<ID | 'spine', ID[]>();
  children.set('spine', []);
  for (const s of config) {
    if (errorIds.has(s.id)) continue;
    children.set(s.id, []);
  }
  for (const s of config) {
    if (errorIds.has(s.id)) continue;
    const parent = s.mergeInto === 'spine' ? 'spine' : errorIds.has(s.mergeInto) ? 'spine' : s.mergeInto;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(s.id);
  }
  // Sort children by start date (earliest first).
  for (const [, kids] of children) {
    kids.sort((a, b) => Date.parse(byId.get(a)!.startDate) - Date.parse(byId.get(b)!.startDate));
  }

  // Subtree weight = sum of users in the subtree (own + descendants).
  const subtreeWeight = new Map<ID | 'spine', number>();
  function weight(id: ID | 'spine'): number {
    const cached = subtreeWeight.get(id);
    if (cached !== undefined) return cached;
    const own = id === 'spine' ? 0 : Math.max(1, byId.get(id)?.users ?? 0);
    let w = own;
    for (const c of children.get(id) ?? []) w += weight(c);
    subtreeWeight.set(id, w);
    return w;
  }
  weight('spine');

  // Assign offsets relative to parent. Alternate above/below, walking outward.
  // Each child takes up a band proportional to its subtree weight; its centre
  // becomes its offsetFromParent. This produces a balanced layout where heavy
  // sub-confluences get more vertical room.
  const layout = new Map<ID | 'spine', LayoutNode>();
  layout.set('spine', {
    id: 'spine',
    parent: null,
    children: children.get('spine') ?? [],
    offsetFromParent: 0,
    subtreeWeight: subtreeWeight.get('spine') ?? 0,
  });

  function assignChildren(parentId: ID | 'spine') {
    const kids = children.get(parentId) ?? [];
    if (kids.length === 0) return;
    // Split into two interleaved sides: zig-zag above/below.
    // Heavier children get placed first (further out), so smaller strands
    // can tuck in closer to the parent.
    const sorted = [...kids].sort(
      (a, b) => (subtreeWeight.get(b) ?? 0) - (subtreeWeight.get(a) ?? 0),
    );
    let aboveCursor = 0;
    let belowCursor = 0;
    sorted.forEach((id, i) => {
      const w = subtreeWeight.get(id) ?? 1;
      const band = Math.max(MIN_SIBLING_GAP, w * WEIGHT_TO_PX);
      const above = i % 2 === 0;
      let centre: number;
      if (above) {
        aboveCursor += band / 2;
        centre = -aboveCursor;
        aboveCursor += band / 2;
      } else {
        belowCursor += band / 2;
        centre = +belowCursor;
        belowCursor += band / 2;
      }
      layout.set(id, {
        id,
        parent: parentId,
        children: children.get(id) ?? [],
        offsetFromParent: centre,
        subtreeWeight: w,
      });
      assignChildren(id);
    });
  }
  assignChildren('spine');

  // Resolve each strand.
  const strands: ResolvedStrand[] = config
    .filter((s) => !errorIds.has(s.id) && layout.has(s.id))
    .map((s) => {
      const startMs = Date.parse(s.startDate);
      const mergeMs = Date.parse(s.mergeDate);
      const freqPerDay = normaliseFrequency(s.frequency, s.frequencyPeriod);
      const node = layout.get(s.id)!;
      // birthOffset is the cumulative offset from spine, summing each ancestor.
      let off = 0;
      let cur: ID | 'spine' = s.id;
      while (cur !== 'spine') {
        off += layout.get(cur)?.offsetFromParent ?? 0;
        cur = layout.get(cur)?.parent ?? 'spine';
      }
      return {
        ...s,
        startMs,
        mergeMs,
        freqPerDay,
        ancestry: ancestry(s.id),
        birthOffset: off,
        thickness: usersToThickness(s.users),
      } satisfies ResolvedStrand;
    });

  // Time window.
  const allTimes = strands.flatMap((s) => [s.startMs, s.mergeMs]);
  const tStart = allTimes.length ? Math.min(...allTimes) : Date.now() - 1;
  const tEnd = allTimes.length ? Math.max(...allTimes) : Date.now();

  // Compute the spine's max thickness — total users of all strands that ever
  // reach the spine (which is all strands, by definition of a valid DAG).
  const spineUsers = strands.reduce((sum, s) => sum + Math.max(1, s.users), 0);
  const spineMaxThickness = SPINE_BASE_THICKNESS + usersToThickness(spineUsers);

  return { strands, layout, tStart, tEnd, spineMaxThickness, issues };
}

// ------- Geometry helpers used by the renderer -------

/** A strand's centreline y at world-time `t` (relative to spine = 0). */
export function strandCentreY(strand: ResolvedStrand, model: ResolvedModel, t: number): number {
  // Before birth: pretend it sits at its birthOffset (won't be drawn).
  if (t <= strand.startMs) return strand.birthOffset;
  // After merge: take on the parent's y at this moment.
  const parentId = strand.mergeInto === 'spine' ? 'spine' : strand.mergeInto;
  const parentY = parentCentreY(parentId, model, t);
  if (t >= strand.mergeMs) return parentY;
  // Live: ease from its own birth offset onto the parent's current y as we
  // approach the merge.
  const e = convergenceProgress(strand, t);
  // Self's "free" y is birthOffset away from spine; parent's y is parentY.
  const selfY = strand.birthOffset;
  return selfY + (parentY - selfY) * e;
}

/** Convergence ease-in 0..1 — 0 well before merge, 1 at the merge instant. */
export function convergenceProgress(strand: ResolvedStrand, t: number): number {
  const span = Math.max(1, strand.mergeMs - strand.startMs);
  const tail = span * CONVERGE_WINDOW;
  const windowStart = strand.mergeMs - tail;
  if (t <= windowStart) return 0;
  if (t >= strand.mergeMs) return 1;
  const x = (t - windowStart) / tail;
  // smoothstep (cubic): 3x² − 2x³
  return x * x * (3 - 2 * x);
}

/** Oscillation amplitude for a strand at time t — taper to zero near merge. */
export function strandAmplitude(strand: ResolvedStrand, t: number): number {
  const base = Math.min(MAX_AMPLITUDE, Math.max(6, Math.sqrt(strand.users) * 2.4));
  const e = convergenceProgress(strand, t);
  return base * (1 - e);
}

/** Centre-y of a node at time t, recursively chasing merges. */
function parentCentreY(id: ID | 'spine', model: ResolvedModel, t: number): number {
  if (id === 'spine') return 0;
  const s = model.strands.find((x) => x.id === id);
  if (!s) return 0;
  return strandCentreY(s, model, t);
}

/** Map users -> pixel thickness with a gentle sqrt-ish curve. */
export function usersToThickness(users: number): number {
  const u = Math.max(0, users);
  return MIN_THICKNESS + Math.pow(u, THICKNESS_EXP) * THICKNESS_SCALE;
}

/** Spine thickness at time t: base + thickness of every strand that has merged in by t. */
export function spineThicknessAt(model: ResolvedModel, t: number): number {
  let extra = 0;
  for (const s of model.strands) {
    if (s.mergeMs <= t && s.ancestry.includes('spine')) {
      extra += usersToThickness(s.users);
    }
  }
  return SPINE_BASE_THICKNESS + extra;
}

/** Constituents currently flowing inside a strand (or the spine) at time t.
 *  Returns leaf-level strands (real data sources, not intermediate confluences). */
export function constituentsInside(
  parentId: ID | 'spine',
  model: ResolvedModel,
  t: number,
): ResolvedStrand[] {
  // Walk descendants: any strand whose ancestry includes parentId and whose
  // mergeMs <= t has flowed into this parent by time t.
  const out: ResolvedStrand[] = [];
  for (const s of model.strands) {
    if (parentId !== 'spine' && !s.ancestry.includes(parentId as ID)) continue;
    if (s.mergeMs <= t) out.push(s);
  }
  return out;
}

/** Total thickness of a strand at time t — own contribution plus everything that has flowed in. */
export function strandTotalThickness(strand: ResolvedStrand, model: ResolvedModel, t: number): number {
  if (t < strand.startMs) return 0;
  if (t > strand.mergeMs) return 0; // strand no longer exists as an entity
  // Own thickness + every descendant that has already merged into it.
  let total = usersToThickness(strand.users);
  for (const s of model.strands) {
    if (s.id === strand.id) continue;
    if (!s.ancestry.includes(strand.id)) continue;
    if (s.mergeMs <= t) total += usersToThickness(s.users);
  }
  return total;
}

function normaliseFrequency(value: number, period: StrandConfig['frequencyPeriod']): number {
  const v = Math.max(0.001, value);
  switch (period) {
    case 'day': return v;
    case 'week': return v / 7;
    case 'month': return v / 30.44;
    case 'quarter': return v / 91.31;
  }
}
