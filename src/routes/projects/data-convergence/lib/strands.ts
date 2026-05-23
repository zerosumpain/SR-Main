// Strand mathematics for the convergence timeline. V2.
//
// Resolves a flat list of StrandConfig + OutputConfig into a layered model the
// renderer can iterate. Validates the DAG (no cycles, no missing targets), lays
// strands out as a tree rooted at the spine, and pre-computes per-strand
// geometry hints (birth offset, ancestry, frequency-per-day, thickness).

import type {
  StrandConfig,
  OutputConfig,
  ResolvedStrand,
  ResolvedOutput,
  ResolvedModel,
  LayoutNode,
  ID,
  ValidationIssue,
  Cadence,
} from './types';

// ------- Tunable constants -------

/** Layout base offset (px from spine for the closest-merging strand). */
export const LAYOUT_BASE_OFFSET = 40;
/** Per-rank vertical stride within a side (above OR below). */
export const LAYOUT_RANK_STRIDE = 36;
/** Strands ease onto the spine over the LAST `CONVERGE_WINDOW` of their life
 *  — kept short so the fan-in pattern stays visible across most of the run. */
export const CONVERGE_WINDOW = 0.18;
/** Oscillation amplitude cap. */
export const MAX_AMPLITUDE = 14;

/** Thickness curve — wide dynamic range so 800-user sources read as ~5×
 *  thicker than 100-user sources. */
export const MIN_THICKNESS = 2;
export const THICKNESS_EXP = 0.62;
export const THICKNESS_SCALE = 0.42;

export const SPINE_BASE_THICKNESS = 4;

/** Outputs sit at this many px from the spine centreline (px, post-yScale). */
export const OUTPUT_OFFSET_PX = 170;

// Legacy constants (still imported by tests / older code paths).
export const WEIGHT_TO_PX = 0.06;
export const MIN_SIBLING_GAP = 32;

export function resolveModel(
  config: StrandConfig[],
  outputs: OutputConfig[] = [],
): ResolvedModel {
  const issues: ValidationIssue[] = [];

  const byId = new Map<ID, StrandConfig>();
  for (const s of config) {
    if (byId.has(s.id)) {
      issues.push({ level: 'error', strandId: s.id, message: `Duplicate id "${s.id}".` });
    }
    byId.set(s.id, s);
  }

  // Basic validation.
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
      issues.push({ level: 'error', strandId: s.id, message: `"${s.name}" has an invalid date.` });
    } else if (merge <= start) {
      issues.push({ level: 'error', strandId: s.id, message: `"${s.name}" merges before (or as) it starts.` });
    }
  }

  // Cycle detection.
  const colour = new Map<ID, 0 | 1 | 2>();
  function visit(id: ID): boolean {
    const c = colour.get(id) ?? 0;
    if (c === 1) return false;
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
      issues.push({ level: 'error', strandId: s.id, message: `"${s.name}" is part of a cycle.` });
    }
  }

  // Late-merge warning.
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

  const errorIds = new Set(
    issues.filter((i) => i.level === 'error' && i.strandId).map((i) => i.strandId as ID),
  );

  function ancestry(id: ID): (ID | 'spine')[] {
    const seen = new Set<ID>();
    const chain: (ID | 'spine')[] = [id];
    let cur: ID | 'spine' = id;
    while (cur !== 'spine') {
      if (seen.has(cur)) return chain;
      seen.add(cur);
      const n = byId.get(cur);
      if (!n) break;
      cur = n.mergeInto;
      chain.push(cur);
    }
    return chain;
  }

  // Build adjacency.
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
  for (const [, kids] of children) {
    kids.sort((a, b) => Date.parse(byId.get(a)!.startDate) - Date.parse(byId.get(b)!.startDate));
  }

  // Subtree weight = sum of users in subtree.
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

  const layout = new Map<ID | 'spine', LayoutNode>();
  layout.set('spine', {
    id: 'spine', parent: null,
    children: children.get('spine') ?? [],
    offsetFromParent: 0,
    subtreeWeight: subtreeWeight.get('spine') ?? 0,
  });

  // V3 layout: for children of the spine, lay them out in rank order of merge
  // date — earliest mergers closest, latest mergers furthest. Sides alternate
  // above/below within rank-pairs. Non-reference strands and reference strands
  // both follow this scheme. (Intermediate confluences still use the old
  // subtree-weight layout under their own parent.)
  function assignChildren(parentId: ID | 'spine') {
    const kids = children.get(parentId) ?? [];
    if (kids.length === 0) return;

    if (parentId === 'spine') {
      // Rank by mergeMs ascending. Earliest first.
      const sorted = [...kids].sort(
        (a, b) => Date.parse(byId.get(a)!.mergeDate) - Date.parse(byId.get(b)!.mergeDate),
      );
      sorted.forEach((id, rank) => {
        const above = rank % 2 === 0;
        const pairIdx = Math.floor(rank / 2);
        const magnitude = LAYOUT_BASE_OFFSET + pairIdx * LAYOUT_RANK_STRIDE;
        const centre = above ? -magnitude : +magnitude;
        layout.set(id, {
          id, parent: parentId,
          children: children.get(id) ?? [],
          offsetFromParent: centre,
          subtreeWeight: subtreeWeight.get(id) ?? 1,
        });
        assignChildren(id);
      });
      return;
    }

    // Non-spine parent: keep the older subtree-weight layout for any
    // intermediate confluences a future scene might introduce.
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
        id, parent: parentId,
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
      const freqPerDay = cadenceToFreqPerDay(s.cadence);
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

  // Resolve outputs.
  const strandIdSet = new Set(strands.map((s) => s.id));
  let aboveIdx = 0;
  let belowIdx = 0;
  const resolvedOutputs: ResolvedOutput[] = outputs.map((o) => {
    const sourceIds = (Array.isArray((o as OutputConfig & { sources?: ID[] }).sources)
      ? (o as OutputConfig & { sources?: ID[] }).sources!
      : []
    ).filter((id) => strandIdSet.has(id));
    if (sourceIds.length === 0) {
      issues.push({ level: 'warning', outputId: o.id, message: `Output "${o.name}" has no recognised sources.` });
    }
    // Auto-balance side if not set.
    let side: 'above' | 'below';
    if (o.side === 'above' || o.side === 'below') side = o.side;
    else { side = aboveIdx <= belowIdx ? 'above' : 'below'; }
    if (side === 'above') aboveIdx++; else belowIdx++;

    let anchorMs: number;
    if (o.anchorDate && Number.isFinite(Date.parse(o.anchorDate))) {
      anchorMs = Date.parse(o.anchorDate);
    } else if (sourceIds.length) {
      anchorMs = Math.max(...sourceIds.map((sid) => {
        const s = strands.find((x) => x.id === sid);
        return s ? s.startMs : 0;
      }));
    } else {
      anchorMs = Date.now();
    }
    return {
      ...o,
      sourceIds,
      resolvedSide: side,
      anchorMs,
    } satisfies ResolvedOutput;
  });

  const allTimes = strands.flatMap((s) => [s.startMs, s.mergeMs]);
  const tStart = allTimes.length ? Math.min(...allTimes) : Date.now() - 1;
  const tEnd = allTimes.length ? Math.max(...allTimes) : Date.now();

  // Spine's max thickness for sizing the visual rope.
  const spineUsers = strands.reduce((sum, s) => sum + Math.max(1, s.users), 0);
  const spineMaxThickness = SPINE_BASE_THICKNESS + usersToThickness(spineUsers);

  return { strands, outputs: resolvedOutputs, layout, tStart, tEnd, spineMaxThickness, issues };
}

// ------- Cadence -> frequency mapping -------

export function cadenceToFreqPerDay(cadence: Cadence): number {
  switch (cadence) {
    case 'daily':       return 1;
    case 'termly':      return 3 / 365;
    case 'annual':      return 1 / 365;
    case 'biannual':    return 2 / 365;
    case 'adhoc':       return 0.5 / 365;
    case 'continuous':  return 24 / 365; // reference data ticks ~ twice a month
  }
}

/** Human-readable cadence label. */
export function cadenceLabel(cadence: Cadence): string {
  switch (cadence) {
    case 'daily':       return 'Daily';
    case 'termly':      return 'Termly';
    case 'annual':      return 'Annually';
    case 'biannual':    return 'Twice yearly';
    case 'adhoc':       return 'Ad-hoc';
    case 'continuous':  return 'Continuous feed';
  }
}

// ------- Geometry helpers used by the renderer -------

export function strandCentreY(strand: ResolvedStrand, model: ResolvedModel, t: number): number {
  if (t <= strand.startMs) return strand.birthOffset;
  const parentId = strand.mergeInto === 'spine' ? 'spine' : strand.mergeInto;
  const parentY = parentCentreY(parentId, model, t);
  if (t >= strand.mergeMs) return parentY;
  const e = convergenceProgress(strand, t);
  return strand.birthOffset + (parentY - strand.birthOffset) * e;
}

export function convergenceProgress(strand: ResolvedStrand, t: number): number {
  const span = Math.max(1, strand.mergeMs - strand.startMs);
  const tail = span * CONVERGE_WINDOW;
  const windowStart = strand.mergeMs - tail;
  if (t <= windowStart) return 0;
  if (t >= strand.mergeMs) return 1;
  const x = (t - windowStart) / tail;
  return x * x * (3 - 2 * x);
}

export function strandAmplitude(strand: ResolvedStrand, t: number): number {
  const base = Math.min(MAX_AMPLITUDE, Math.max(6, Math.sqrt(strand.users) * 1.4));
  const e = convergenceProgress(strand, t);
  return base * (1 - e);
}

function parentCentreY(id: ID | 'spine', model: ResolvedModel, t: number): number {
  if (id === 'spine') return 0;
  const s = model.strands.find((x) => x.id === id);
  if (!s) return 0;
  return strandCentreY(s, model, t);
}

export function usersToThickness(users: number): number {
  const u = Math.max(0, users);
  return MIN_THICKNESS + Math.pow(u, THICKNESS_EXP) * THICKNESS_SCALE;
}

/** Sum of thicknesses for all strands that have merged into the spine by time t. */
export function spineThicknessAt(model: ResolvedModel, t: number): number {
  let extra = 0;
  for (const s of model.strands) {
    if (s.mergeMs <= t && s.ancestry.includes('spine')) {
      // Reference feeds contribute continuously rather than as a step.
      if (s.isReference) {
        // Once the feed has started, count a fraction (1.0 at startMs+1y, ramping up).
        const ramp = Math.min(1, (t - s.startMs) / (1000 * 60 * 60 * 24 * 365));
        if (ramp <= 0) continue;
        extra += usersToThickness(s.users) * ramp;
      } else {
        extra += usersToThickness(s.users);
      }
    } else if (s.isReference && s.ancestry.includes('spine')) {
      // Reference feed still flowing — partial contribution proportional to t.
      if (t >= s.startMs && t < s.mergeMs) {
        const span = Math.max(1, s.mergeMs - s.startMs);
        const ramp = Math.min(1, (t - s.startMs) / span);
        extra += usersToThickness(s.users) * ramp;
      }
    }
  }
  return SPINE_BASE_THICKNESS + extra;
}

/** Stripe colours currently flowing through `parentId` at time t — used to
 *  draw the rainbow spine. Leaf-level strands only; intermediates contribute
 *  their constituents instead of themselves. */
export function spineStripeColoursAt(
  parentId: ID | 'spine',
  model: ResolvedModel,
  t: number,
): { strand: ResolvedStrand; ramp: number }[] {
  const out: { strand: ResolvedStrand; ramp: number }[] = [];
  for (const s of model.strands) {
    if (parentId !== 'spine' && !s.ancestry.includes(parentId as ID)) continue;
    // Walk ancestry between s and parentId — all intermediates must have merged
    // by t for s's colour to be flowing inside parentId.
    const ancestry = s.ancestry;
    const idx = ancestry.indexOf(parentId);
    if (idx <= 0) continue;
    let ok = true;
    for (let i = 1; i < idx; i++) {
      const mid = ancestry[i];
      if (mid === 'spine') break;
      const midStrand = model.strands.find((x) => x.id === mid);
      if (!midStrand || midStrand.mergeMs > t) { ok = false; break; }
    }
    if (!ok) continue;
    if (s.isReference) {
      // Reference contributes from startMs onward, ramping up.
      if (t < s.startMs) continue;
      const span = Math.max(1, s.mergeMs - s.startMs);
      const ramp = Math.min(1, (t - s.startMs) / span);
      if (ramp > 0) out.push({ strand: s, ramp });
    } else {
      if (s.mergeMs > t) continue;
      out.push({ strand: s, ramp: 1 });
    }
  }
  return out;
}
