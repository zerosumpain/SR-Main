// Per-edge styling for the planned route line: a band COLOUR by cumulative
// travel time (an isochrone read — "how far in 1h, 2h…") and a DASH pattern by
// the reach's speed limit. Colour and dash are orthogonal signals on one line.
// Pure, dependency-free (timing reuses the engine's edgeTimeS).
import type { GraphEdge, LatLng } from '$lib/broads-pilot/types';
import { edgeTimeS } from '$lib/broads-pilot/router';
import { haversine, projectToSegment } from '$lib/broads-pilot/geo';

export interface StyledEdge {
  edge: GraphEdge;
  /** cumulative seconds at the edge's start / end / midpoint (from the clock origin) */
  t0: number;
  t1: number;
  midT: number;
  /** true for edges behind the live position (already cruised) */
  passed: boolean;
}

export interface TimeBand {
  /** upper bound in hours, inclusive; null = open-ended final band */
  maxH: number | null;
  color: string;
  label: string;
}

// RdYlGn reversed — a legible near→far isochrone ramp, distinct from the
// pass/marginal/blocked verdict palette and the speed-limit layer colours.
export const TIME_BANDS: TimeBand[] = [
  { maxH: 1, color: '#1a9850', label: '≤1h' },
  { maxH: 2, color: '#91cf60', label: '1–2h' },
  { maxH: 3, color: '#fee08b', label: '2–3h' },
  { maxH: 4, color: '#fc8d59', label: '3–4h' },
  { maxH: null, color: '#d73027', label: '4h+' },
];

/** Warm grey for segments already cruised (live mode). */
export const PASSED_COLOR = '#9a8c7a';

/** Cumulative-time (s) → band colour. */
export function bandColor(t_s: number): string {
  const h = t_s / 3600;
  for (const b of TIME_BANDS) if (b.maxH === null || h <= b.maxH) return b.color;
  return TIME_BANDS[TIME_BANDS.length - 1].color;
}

// Graduated dash by posted speed: faster = solid (open water), slower = more
// broken. Mapbox dashArray strings; undefined = solid line.
export interface DashBand {
  maxMph: number; // applies to limits <= this (and > the previous band's)
  dash: string | undefined;
  label: string;
}
export const DASH_BANDS: DashBand[] = [
  { maxMph: 3, dash: '2 7', label: '≤3 mph' },
  { maxMph: 4, dash: '7 7', label: '4 mph' },
  { maxMph: 5, dash: '14 7', label: '5 mph' },
  { maxMph: Infinity, dash: undefined, label: '6 mph+' },
];

/** Speed limit (mph) → Mapbox dashArray (undefined = solid at 6 mph+). */
export function speedDash(limit_mph: number): string | undefined {
  for (const b of DASH_BANDS) if (limit_mph <= b.maxMph) return b.dash;
  return undefined;
}

export interface StyleOpts {
  /** live position; when set, the clock zeroes at the nearest route edge and
   *  earlier edges are flagged `passed`. Omit for time-from-start (planning). */
  from?: LatLng | null;
}

/** Nearest point on an edge's polyline to p: the perpendicular distance (m) and
 *  the fraction (0–1) of the edge's length consumed at the foot of perpendicular. */
function nearestOnEdge(p: LatLng, e: GraphEdge): { dist: number; frac: number } {
  const g = e.geometry;
  if (g.length < 2) return { dist: Infinity, frac: 0 };
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < g.length; i++) { const L = haversine(g[i - 1], g[i]); segLen.push(L); total += L; }
  let best = Infinity, along = 0, acc = 0;
  for (let i = 1; i < g.length; i++) {
    const { dist, t } = projectToSegment(p, g[i - 1], g[i]);
    if (dist < best) { best = dist; along = acc + t * segLen[i - 1]; }
    acc += segLen[i - 1];
  }
  return { dist: best, frac: total > 0 ? along / total : 0 };
}

/**
 * Walk the ordered legs' edges, summing per-edge travel time. Returns one
 * StyledEdge per edge with cumulative times and a `passed` flag. When `from`
 * is given, the nearest edge to it becomes the clock origin and earlier edges
 * are `passed`; the boat's position WITHIN the pivot edge is credited (only the
 * stretch ahead of it counts toward the clock). Otherwise the clock starts at
 * the route's first edge.
 *
 * Known live-mode limitations (planning-time colouring is exact): on an
 * out-and-back that retraces the same water, the pivot may snap to the outbound
 * copy of a shared edge; and a blocked middle leg (no edges) lets the clock
 * carry across the gap. Both only tint the live gradient, not the geometry.
 */
export function styleRoute(legs: { edges: GraphEdge[] }[], opts: StyleOpts = {}): StyledEdge[] {
  const edges: GraphEdge[] = [];
  for (const leg of legs) for (const e of leg.edges) edges.push(e);
  if (edges.length === 0) return [];

  let pivot = 0, pivotFrac = 0;
  if (opts.from) {
    let bd = Infinity;
    for (let i = 0; i < edges.length; i++) {
      const { dist, frac } = nearestOnEdge(opts.from, edges[i]);
      if (dist < bd) { bd = dist; pivot = i; pivotFrac = frac; }
    }
  }

  const out: StyledEdge[] = [];
  let t = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (i < pivot) {
      out.push({ edge: e, t0: 0, t1: 0, midT: 0, passed: true });
      continue;
    }
    const dt = edgeTimeS(e);
    // credit the already-cruised fraction of the pivot edge: only the part ahead
    // of the boat contributes to the clock.
    const span = i === pivot && opts.from ? dt * (1 - pivotFrac) : dt;
    const t0 = t;
    const t1 = t + span;
    out.push({ edge: e, t0, t1, midT: (t0 + t1) / 2, passed: false });
    t = t1;
  }
  return out;
}
