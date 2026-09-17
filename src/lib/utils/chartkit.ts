// chartkit — library-free scale/tick geometry for the deck Chart block.
// Copied from src/routes/projects/policy-engine/lib/chartkit.ts (the house
// bespoke-SVG chart helper); policy-engine's copy stays route-scoped and
// untouched. Pure functions only — no Svelte, no DOM.

/** A linear scale domain→range, with a few conveniences. */
export interface LinScale {
  (v: number): number;
  invert: (px: number) => number;
  domain: [number, number];
  range: [number, number];
}

/** Build a clamped-free linear scale. */
export function linScale(domain: [number, number], range: [number, number]): LinScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dspan = d1 - d0 || 1;
  const fn = ((v: number) => r0 + ((v - d0) / dspan) * (r1 - r0)) as LinScale;
  fn.invert = (px: number) => d0 + ((px - r0) / (r1 - r0 || 1)) * dspan;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** "Nice" round tick values spanning [lo, hi] with about `count` divisions. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const ticks: number[] = [];
  const start = Math.ceil(lo / step) * step;
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Min/max of a set of series, padded by `pad` fraction; optionally zero-anchored. */
export function extent(values: number[], pad = 0.08, zeroBased = false): { lo: number; hi: number } {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of values)
    if (isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  if (!isFinite(lo) || !isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (zeroBased) lo = Math.min(lo, 0);
  if (lo === hi) hi = lo + 1;
  const p = (hi - lo) * pad;
  return { lo: zeroBased ? lo : lo - p, hi: hi + p };
}

/** Build an SVG path "M..L.." from (x,y) point pairs, skipping non-finite y. */
export function polyline(xs: number[], ys: number[]): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) {
    if (!isFinite(ys[i])) continue;
    d += `${d === '' ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)} `;
  }
  return d.trim();
}

/** Format a number with fixed dp, en-GB grouping. */
export function fmt(v: number, dp = 1): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// --- donut -----------------------------------------------------------------

export interface DonutSeg {
  /** Ring-segment path (annulus slice) around (cx, cy). */
  path: string;
  /** Fraction of the whole (0..1). */
  frac: number;
  /** Mid-angle label anchor, just outside the ring. */
  lx: number;
  ly: number;
}

/** Annulus-slice paths for labelled shares. Starts at 12 o'clock, clockwise. */
export function donutSegments(
  values: number[],
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  gapRad = 0.02,
): DonutSeg[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0) || 1;
  const segs: DonutSeg[] = [];
  let a0 = -Math.PI / 2;
  for (const v of values) {
    const frac = Math.max(0, v) / total;
    const a1 = a0 + frac * Math.PI * 2;
    const s = a0 + gapRad / 2;
    const e = Math.max(s, a1 - gapRad / 2);
    const large = e - s > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    const mid = (s + e) / 2;
    segs.push({
      path:
        `M${p(rOuter, s)} A${rOuter},${rOuter} 0 ${large} 1 ${p(rOuter, e)} ` +
        `L${p(rInner, e)} A${rInner},${rInner} 0 ${large} 0 ${p(rInner, s)} Z`,
      frac,
      lx: cx + (rOuter + 16) * Math.cos(mid),
      ly: cy + (rOuter + 16) * Math.sin(mid),
    });
    a0 = a1;
  }
  return segs;
}

// --- sankey ----------------------------------------------------------------

export interface SankeyFlow {
  from: string;
  to: string;
  value: number;
}

export interface SankeyNode {
  id: string;
  depth: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface SankeyLink {
  from: string;
  to: string;
  value: number;
  /** Filled ribbon path from the source node's right edge to the target's left. */
  path: string;
}

export interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/** Longest-path depth per node id, or null when the flows contain a cycle.
 *  Pure sinks are pushed to the last column (the classic sankey look). */
export function sankeyDepths(flows: SankeyFlow[]): Map<string, number> | null {
  const ids = [...new Set(flows.flatMap((f) => [f.from, f.to]))];
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const f of flows) {
    out.get(f.from)!.push(f.to);
    indeg.set(f.to, (indeg.get(f.to) ?? 0) + 1);
  }
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const t of out.get(id) ?? []) {
      depth.set(t, Math.max(depth.get(t)!, depth.get(id)! + 1));
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  if (visited !== ids.length) return null; // cycle
  const maxDepth = Math.max(...depth.values(), 0);
  for (const id of ids) if ((out.get(id) ?? []).length === 0) depth.set(id, maxDepth);
  return depth;
}

/** Lay out an acyclic flow set inside [0,0,W,H]. Returns null on a cycle. */
export function sankeyLayout(
  flows: SankeyFlow[],
  W: number,
  H: number,
  pad = { l: 8, r: 8, t: 8, b: 8 },
  nodeW = 14,
  nodeGap = 12,
): SankeyGraph | null {
  const depths = sankeyDepths(flows);
  if (!depths) return null;
  const ids = [...depths.keys()];
  const maxDepth = Math.max(...depths.values(), 0);

  // Node magnitude = max(inflow, outflow); column scale fits the tallest column.
  const mag = new Map<string, number>();
  for (const id of ids) {
    let inV = 0,
      outV = 0;
    for (const f of flows) {
      if (f.to === id) inV += f.value;
      if (f.from === id) outV += f.value;
    }
    mag.set(id, Math.max(inV, outV, 1e-9));
  }
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const d = depths.get(id)!;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(id);
  }
  const availH = H - pad.t - pad.b;
  let k = Infinity;
  for (const col of columns.values()) {
    const sum = col.reduce((a, id) => a + mag.get(id)!, 0);
    const free = availH - (col.length - 1) * nodeGap;
    k = Math.min(k, free / sum);
  }
  if (!isFinite(k) || k <= 0) k = 1;

  const span = W - pad.l - pad.r - nodeW;
  const nodes = new Map<string, SankeyNode>();
  for (const [d, col] of columns) {
    const colH = col.reduce((a, id) => a + mag.get(id)! * k, 0) + (col.length - 1) * nodeGap;
    let y = pad.t + (availH - colH) / 2;
    const x0 = pad.l + (maxDepth === 0 ? 0 : (span * d) / maxDepth);
    for (const id of col) {
      const h = mag.get(id)! * k;
      nodes.set(id, { id, depth: d, x0, x1: x0 + nodeW, y0: y, y1: y + h });
      y += h + nodeGap;
    }
  }

  // Ribbons: stack per-node link offsets in flow order.
  const outY = new Map<string, number>(ids.map((id) => [id, nodes.get(id)!.y0]));
  const inY = new Map<string, number>(ids.map((id) => [id, nodes.get(id)!.y0]));
  const links: SankeyLink[] = flows.map((f) => {
    const s = nodes.get(f.from)!;
    const t = nodes.get(f.to)!;
    const w = f.value * k;
    const sy0 = outY.get(f.from)!;
    const ty0 = inY.get(f.to)!;
    outY.set(f.from, sy0 + w);
    inY.set(f.to, ty0 + w);
    const x1 = s.x1;
    const x2 = t.x0;
    const mx = (x1 + x2) / 2;
    const path =
      `M${x1.toFixed(1)},${sy0.toFixed(1)} C${mx.toFixed(1)},${sy0.toFixed(1)} ${mx.toFixed(1)},${ty0.toFixed(1)} ${x2.toFixed(1)},${ty0.toFixed(1)} ` +
      `L${x2.toFixed(1)},${(ty0 + w).toFixed(1)} C${mx.toFixed(1)},${(ty0 + w).toFixed(1)} ${mx.toFixed(1)},${(sy0 + w).toFixed(1)} ${x1.toFixed(1)},${(sy0 + w).toFixed(1)} Z`;
    return { from: f.from, to: f.to, value: f.value, path };
  });

  return { nodes: [...nodes.values()], links };
}
