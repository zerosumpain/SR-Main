// Find stretches of ground that appear in more than one trace.
//
// The shape of the problem: given every GPS trace of one activity type, find
// every contiguous run of ≥ 500 m that two or more traces both cover, staying
// within 20 m of each other throughout. Repeats WITHIN one trace count — four
// laps of a park loop are four efforts, not one.
//
// Segments are DIRECTIONAL. A reverse traversal produces a correspondence that
// runs backwards, and the scanner only accepts forward ones, so the other
// direction simply never matches. That is deliberate: a climb and its descent
// are not comparable efforts, and merging them would make every leaderboard on
// a hill meaningless.
//
// Pure and deterministic — no database, no network, no clock. Everything is
// tested on synthetic traces in matcher.test.ts.

import { haversineM } from '../track';
import { makeCorridor, corridorMatch, type Corridor, type LngLat } from './corridor';
import { spanDistanceM, spanElevation, STEP_M, type ResampledTrack } from './resample';

export interface SegmentSource {
  activityId: string;
  activityType: string;
  /** Unix seconds, the activity's own start. */
  startDate: number;
  track: ResampledTrack;
}

export interface MatchOptions {
  /** How far apart two traces may be and still count as the same ground. */
  toleranceM?: number;
  /** Shortest stretch worth calling a segment. */
  minLengthM?: number;
  /** Efforts needed before a stretch is a segment at all. */
  minEfforts?: number;
  /** How many times a single trace may re-cover the same ground (laps). */
  maxPasses?: number;
  /** Consecutive unmatched points a run may bridge before it is severed.
   *  Eight is 80 m — a dropped fix, or stepping round a parked car — while
   *  still far short of leaving the path and coming back. */
  maxMiss?: number;
  /** Most the partner may advance per reference point, in points. */
  maxStep?: number;
  /** Nearest a self-match may be, in points, to the point matching itself. */
  minSelfGapM?: number;
  /** Fraction of a candidate a run must cover to count as an effort on it. */
  coverage?: number;
  /** Overlap above which two candidates are the same piece of ground. */
  mergeOverlap?: number;
  /** Most segments to return; the weakest are dropped and reported. */
  maxSegments?: number;
}

const DEFAULTS: Required<MatchOptions> = {
  toleranceM: 20,
  minLengthM: 500,
  minEfforts: 2,
  maxPasses: 4,
  maxMiss: 8,
  maxStep: 4,
  minSelfGapM: 300,
  coverage: 0.9,
  mergeOverlap: 0.8,
  maxSegments: 600,
};

export interface DiscoveredEffort {
  activityId: string;
  /** Resampled index range on that source's own track. */
  from: number;
  to: number;
  startS: number;
  endS: number;
  distanceM: number;
  elevationGainM: number;
}

export interface DiscoveredSegment {
  activityType: string;
  /** Geometry, taken from the reference trace: [lng, lat, ele|null, metresFromStart]. */
  coordinates: Array<[number, number, number | null, number]>;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  efforts: DiscoveredEffort[];
}

export interface DiscoveryReport {
  segments: DiscoveredSegment[];
  /** Non-fatal facts worth printing rather than swallowing. */
  notes: string[];
}

// --- projection -------------------------------------------------------------

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG_EQ = 111320;

/**
 * Equirectangular metres about a local origin.
 *
 * Accurate to well under a metre over a day's travel, and roughly ten times
 * cheaper than haversine — which matters, because the inner loop runs it
 * millions of times. Reported distances still go through `haversineM`; this
 * projection only ever decides "are these two points within 20 m".
 */
function makeProjection(sources: SegmentSource[]) {
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;
  for (const s of sources) {
    for (let i = 0; i < s.track.n; i++) {
      sumLat += s.track.lat[i];
      sumLng += s.track.lng[i];
      n++;
    }
  }
  const lat0 = n ? sumLat / n : 0;
  const lng0 = n ? sumLng / n : 0;
  const kx = M_PER_DEG_LNG_EQ * Math.cos((lat0 * Math.PI) / 180);
  return {
    x: (lng: number) => (lng - lng0) * kx,
    y: (lat: number) => (lat - lat0) * M_PER_DEG_LAT,
  };
}

// --- spatial grid -----------------------------------------------------------

/** Cell coordinates are offset so negatives still key cleanly into one number. */
const CELL_OFFSET = 1_000_000;
const CELL_STRIDE = 4_000_000;

interface Grid {
  cellM: number;
  cells: Map<number, number[]>;
}

function cellKey(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET);
}

function buildGrid(gx: Float64Array, gy: Float64Array, count: number, cellM: number): Grid {
  const cells = new Map<number, number[]>();
  for (let g = 0; g < count; g++) {
    const key = cellKey(Math.floor(gx[g] / cellM), Math.floor(gy[g] / cellM));
    const bucket = cells.get(key);
    if (bucket) bucket.push(g);
    else cells.set(key, [g]);
  }
  return { cellM, cells };
}

/** Visit every point within one cell of (x, y). Cell size = tolerance, so the
 *  3×3 neighbourhood is guaranteed to contain everything in range. */
function eachNear(grid: Grid, x: number, y: number, visit: (g: number) => void): void {
  const cx = Math.floor(x / grid.cellM);
  const cy = Math.floor(y / grid.cellM);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.cells.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const g of bucket) visit(g);
    }
  }
}

// --- correspondence ---------------------------------------------------------

/**
 * Up to K nearest partner points per reference point, one per index cluster.
 *
 * The per-cluster rule is what makes laps work. A 20 m radius catches four or
 * five consecutive partner points, so "the four nearest" would all come from
 * the same pass. Clustering by index first means the four kept candidates are
 * the four different times the partner came past this spot.
 */
const REPS_PER_POINT = 4;
const CLUSTER_GAP_POINTS = 30;

/**
 * How far two headings may differ and still be the same direction of travel:
 * cos 60°. Loose enough to survive GPS wobble and a slightly different line
 * round a corner, tight enough that a reversal (cos 180° = −1) never passes.
 *
 * This, not the monotonic index check, is what actually keeps directions apart.
 * At the turnaround of an out-and-back the outbound and return points are
 * neighbours, indistinguishable by index and 180° apart by heading.
 */
const HEADING_COS = 0.5;

interface Reps {
  /** n × REPS_PER_POINT, -1 for empty. */
  j: Int32Array;
  /** n × REPS_PER_POINT, Infinity for empty. */
  d2: Float64Array;
}

function makeReps(n: number): Reps {
  const j = new Int32Array(n * REPS_PER_POINT).fill(-1);
  const d2 = new Float64Array(n * REPS_PER_POINT).fill(Infinity);
  return { j, d2 };
}

function offerRep(reps: Reps, i: number, j: number, d2: number): void {
  const base = i * REPS_PER_POINT;

  // Same pass past this spot? Keep only its closest point.
  for (let k = 0; k < REPS_PER_POINT; k++) {
    const existing = reps.j[base + k];
    if (existing >= 0 && Math.abs(existing - j) <= CLUSTER_GAP_POINTS) {
      if (d2 < reps.d2[base + k]) {
        reps.j[base + k] = j;
        reps.d2[base + k] = d2;
      }
      return;
    }
  }

  // A pass we have not seen yet: take a free slot.
  for (let k = 0; k < REPS_PER_POINT; k++) {
    if (reps.j[base + k] < 0) {
      reps.j[base + k] = j;
      reps.d2[base + k] = d2;
      return;
    }
  }

  // Full: displace the furthest, if this is nearer.
  let worst = 0;
  for (let k = 1; k < REPS_PER_POINT; k++) {
    if (reps.d2[base + k] > reps.d2[base + worst]) worst = k;
  }
  if (d2 < reps.d2[base + worst]) {
    reps.j[base + worst] = j;
    reps.d2[base + worst] = d2;
  }
}

interface Run {
  /** Reference index range. */
  from: number;
  to: number;
  /** Partner index for every reference index in [from, to]. */
  jmap: Int32Array;
  partner: number;
}

/**
 * Points needed to span `metres`.
 *
 * N points enclose N−1 steps, so the +1 is not decoration: without it a 500 m
 * threshold admits 49 steps of 10 m and the shortest "500 m" segment is 490.
 */
function minPointsFor(metres: number): number {
  return Math.ceil(metres / STEP_M) + 1;
}

/**
 * Extend one seed correspondence forwards as far as it holds.
 *
 * At each step the partner point chosen is the nearest one that still moves
 * FORWARDS and does not leap more than `maxStep` points per reference point.
 * Choosing per step rather than committing to a single nearest-partner array
 * is what makes laps work: where two passes overlap, the nearest partner point
 * is a coin toss, and a coin toss ends the run.
 *
 * Up to `maxMiss` unmatched points are bridged — one dropped GPS fix must not
 * sever a two-kilometre stretch.
 */
function extendFrom(
  reps: Reps,
  consumed: Set<number>,
  n: number,
  from: number,
  slot: number,
  opts: Required<MatchOptions>,
): { to: number; pairs: number[] } | null {
  const seed = reps.j[from * REPS_PER_POINT + slot];
  if (seed < 0 || consumed.has(seed)) return null;

  let lastI = from;
  let lastJ = seed;
  const pairs: number[] = [from, seed];

  let k = from + 1;
  let miss = 0;
  while (k < n && miss <= opts.maxMiss) {
    const base = k * REPS_PER_POINT;
    let bestJ = -1;
    let bestD2 = Infinity;
    for (let sl = 0; sl < REPS_PER_POINT; sl++) {
      const j = reps.j[base + sl];
      if (j < 0 || consumed.has(j)) continue;
      if (j < lastJ || j - lastJ > opts.maxStep * (k - lastI)) continue;
      if (reps.d2[base + sl] < bestD2) {
        bestD2 = reps.d2[base + sl];
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      pairs.push(k, bestJ);
      lastI = k;
      lastJ = bestJ;
      miss = 0;
    } else {
      miss++;
    }
    k++;
  }

  return { to: lastI, pairs };
}

/**
 * Every maximal forward run between a reference and one partner.
 *
 * Each starting point is tried from all of its candidate partner points and the
 * longest resulting run wins — on a two-lap loop the nearest candidate at the
 * start line is as likely to be the END of the other lap, which extends
 * nowhere.
 */
function scanRuns(
  reps: Reps,
  consumed: Set<number>,
  n: number,
  partner: number,
  opts: Required<MatchOptions>,
): Run[] {
  const runs: Run[] = [];
  const minPoints = minPointsFor(opts.minLengthM);

  let i = 0;
  while (i < n) {
    let best: { to: number; pairs: number[] } | null = null;
    for (let slot = 0; slot < REPS_PER_POINT; slot++) {
      const run = extendFrom(reps, consumed, n, i, slot, opts);
      if (run && (!best || run.to > best.to)) best = run;
    }
    if (!best) {
      i++;
      continue;
    }

    const from = i;
    const startJ = best.pairs[1];
    const endJ = best.pairs[best.pairs.length - 1];
    const iSpan = best.to - from;
    const jSpan = endJ - startJ;
    // A partner that barely moved while the reference covered a kilometre is
    // not co-traversing anything; it is standing near the path. The ratio is
    // loose because a longer line round the same corner is normal.
    const plausible = iSpan > 0 && jSpan >= iSpan * 0.5 && jSpan <= iSpan * 2;

    if (iSpan + 1 >= minPoints && plausible) {
      runs.push({ from, to: best.to, jmap: densify(best.pairs, from, best.to), partner });
    }
    i = best.to + 1;
  }

  return runs;
}

/** Fill the bridged gaps so a run can answer "which partner index sits at
 *  reference index i" for any i in range, not only the matched ones. */
function densify(pairs: number[], from: number, to: number): Int32Array {
  const out = new Int32Array(to - from + 1);
  let p = 0;
  for (let i = from; i <= to; i++) {
    while (p + 2 < pairs.length && pairs[p + 2] <= i) p += 2;
    const i0 = pairs[p];
    const j0 = pairs[p + 1];
    if (p + 2 < pairs.length) {
      const i1 = pairs[p + 2];
      const j1 = pairs[p + 3];
      out[i - from] = i1 === i0 ? j0 : Math.round(j0 + ((j1 - j0) * (i - i0)) / (i1 - i0));
    } else {
      out[i - from] = j0 + (i - i0);
    }
  }
  return out;
}

// --- candidates -------------------------------------------------------------

interface Candidate {
  referenceIndex: number;
  from: number;
  to: number;
  runs: Run[];
  lengthPoints: number;
  effortCount: number;
}

/**
 * Turn a reference's runs into candidate stretches.
 *
 * Every run proposes the stretch it covers, and the proposal is then asked how
 * many OTHER runs cover essentially all of it. That is what produces both
 * readings of the same ground without having to choose between them: the two
 * kilometres you and one other outing share, and the six hundred metres of it
 * that eight outings share, are different proposals, each with its own crowd.
 *
 * Longest first, so a proposal is only kept when it is materially shorter than
 * an overlapping one already held — otherwise the same lane arrives once per
 * partner and the list fills with near-identical copies.
 *
 * (The obvious alternative — count how many runs cover each point and cut at
 * the level sets — is wrong in a way that is easy to miss: two runs that abut
 * without overlapping produce one long interval that NEITHER of them covers,
 * and the stretch vanishes. Laps of a loop are exactly that shape.)
 */
function candidatesFor(
  referenceIndex: number,
  runs: Run[],
  opts: Required<MatchOptions>,
): Candidate[] {
  if (!runs.length) return [];
  const minPoints = minPointsFor(opts.minLengthM);

  const proposals = runs
    .filter((r) => r.to - r.from + 1 >= minPoints)
    .map((r) => ({ from: r.from, to: r.to, lengthPoints: r.to - r.from + 1 }))
    .sort((a, b) => b.lengthPoints - a.lengthPoints);

  const kept: Candidate[] = [];
  for (const proposal of proposals) {
    const { from, to, lengthPoints } = proposal;

    const duplicate = kept.some((c) => {
      const overlap = Math.min(c.to, to) - Math.max(c.from, from) + 1;
      return (
        overlap >= lengthPoints * opts.mergeOverlap &&
        lengthPoints >= c.lengthPoints * opts.mergeOverlap
      );
    });
    if (duplicate) continue;

    const efforts = runs.filter(
      (r) => Math.min(r.to, to) - Math.max(r.from, from) + 1 >= lengthPoints * opts.coverage,
    );
    // +1 for the reference's own traversal, which always counts.
    if (efforts.length + 1 < opts.minEfforts) continue;

    kept.push({
      referenceIndex,
      from,
      to,
      runs: efforts,
      lengthPoints,
      effortCount: efforts.length + 1,
    });
  }

  return kept;
}

// --- deduplication ----------------------------------------------------------

interface Accepted {
  candidate: Candidate;
  corridor: Corridor;
  points: LngLat[];
}

// --- entry point ------------------------------------------------------------

/**
 * Discover every repeated stretch, one activity type at a time.
 *
 * Ordering within a type is by trace length, longest first, so the longest stretches are
 * found on the traces best able to carry them; shorter traces then contribute
 * efforts to those rather than proposing near-identical stretches of their own.
 */
export function discoverSegments(
  sources: SegmentSource[],
  options: MatchOptions = {},
): DiscoveryReport {
  const opts = { ...DEFAULTS, ...options };

  // Activity types never mix. Running a lane and cycling it are not the same
  // effort, and putting them on one leaderboard would rank the bike first
  // every time and tell you nothing.
  const byType = new Map<string, SegmentSource[]>();
  for (const source of sources) {
    const group = byType.get(source.activityType);
    if (group) group.push(source);
    else byType.set(source.activityType, [source]);
  }

  const segments: DiscoveredSegment[] = [];
  const notes: string[] = [];
  for (const [type, group] of byType) {
    const report = discoverWithinType(group, opts);
    segments.push(...report.segments);
    for (const note of report.notes) notes.push(`${type}: ${note}`);
  }
  return { segments, notes };
}

/** One activity type's worth of traces. The cap applies per type, so a year of
 *  walks cannot crowd out the handful of rides. */
function discoverWithinType(
  sources: SegmentSource[],
  opts: Required<MatchOptions>,
): DiscoveryReport {
  const notes: string[] = [];
  const usable = sources.filter((s) => s.track.n >= Math.ceil(opts.minLengthM / STEP_M));
  if (usable.length < 1) return { segments: [], notes };

  const order = usable
    .map((_, i) => i)
    .sort((a, b) => usable[b].track.n - usable[a].track.n);

  // One flat array of every point of every trace, plus the grid over it.
  const project = makeProjection(usable);
  let total = 0;
  for (const s of usable) total += s.track.n;

  const gx = new Float64Array(total);
  const gy = new Float64Array(total);
  const gSrc = new Int32Array(total);
  const gIdx = new Int32Array(total);
  const offsets = new Int32Array(usable.length);

  let cursor = 0;
  for (let s = 0; s < usable.length; s++) {
    offsets[s] = cursor;
    const track = usable[s].track;
    for (let i = 0; i < track.n; i++) {
      gx[cursor] = project.x(track.lng[i]);
      gy[cursor] = project.y(track.lat[i]);
      gSrc[cursor] = s;
      gIdx[cursor] = i;
      cursor++;
    }
  }

  const gh = new Float64Array(total);
  for (let s = 0; s < usable.length; s++) {
    const track = usable[s].track;
    for (let i = 0; i < track.n; i++) gh[offsets[s] + i] = track.heading[i];
  }

  const grid = buildGrid(gx, gy, total, opts.toleranceM);
  const tol2 = opts.toleranceM * opts.toleranceM;
  const minSelfGap = Math.ceil(opts.minSelfGapM / STEP_M);

  const candidates: Candidate[] = [];

  for (const ref of order) {
    const track = usable[ref].track;
    const base = offsets[ref];
    const repsBySource = new Map<number, Reps>();

    for (let i = 0; i < track.n; i++) {
      const x = gx[base + i];
      const y = gy[base + i];
      const h = gh[base + i];
      eachNear(grid, x, y, (g) => {
        const src = gSrc[g];
        const j = gIdx[g];
        // A point matching its own neighbourhood is not a second traversal.
        if (src === ref && Math.abs(j - i) < minSelfGap) return;
        const dx = gx[g] - x;
        const dy = gy[g] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > tol2) return;
        // Same ground, opposite way round: a different segment entirely.
        if (Math.cos(gh[g] - h) < HEADING_COS) return;
        let reps = repsBySource.get(src);
        if (!reps) {
          reps = makeReps(track.n);
          repsBySource.set(src, reps);
        }
        offerRep(reps, i, j, d2);
      });
    }

    const runs: Run[] = [];
    for (const [src, reps] of repsBySource) {
      const consumed = new Set<number>();
      for (let pass = 0; pass < opts.maxPasses; pass++) {
        const found = scanRuns(reps, consumed, track.n, src, opts);
        if (!found.length) break;
        runs.push(...found);
        // Retire the partner points this pass used, plus their immediate
        // neighbours: at 10 m spacing and 20 m tolerance the next pass would
        // otherwise re-find the same lap one point over.
        for (const run of found) {
          for (const j of run.jmap) {
            for (let d = -2; d <= 2; d++) consumed.add(j + d);
          }
        }
      }
    }

    candidates.push(...candidatesFor(ref, runs, opts));
  }

  // Best first, so a duplicate is always the weaker of the pair.
  candidates.sort((a, b) => b.effortCount - a.effortCount || b.lengthPoints - a.lengthPoints);

  const accepted: Accepted[] = [];
  let dropped = 0;
  for (const candidate of candidates) {
    const track = usable[candidate.referenceIndex].track;
    const points: LngLat[] = [];
    for (let i = candidate.from; i <= candidate.to; i++) points.push([track.lng[i], track.lat[i]]);

    // Two candidates are the same segment when they cover the same ground, in
    // the same direction, at roughly the same length. The length clause is not
    // optional: without it a 600 m core sitting inside a 2 km stretch would
    // swallow the longer one, and the long shared lane you actually walk would
    // vanish in favour of its busiest 600 m.
    let duplicate = false;
    for (const a of accepted) {
      const ratio =
        Math.min(a.points.length, points.length) / Math.max(a.points.length, points.length);
      if (ratio < opts.mergeOverlap) continue;
      const match = corridorMatch(a.corridor, points);
      if (match.fraction >= opts.mergeOverlap && match.forward) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    if (accepted.length >= opts.maxSegments) {
      dropped++;
      continue;
    }

    accepted.push({ candidate, points, corridor: makeCorridor(points, opts.toleranceM) });
  }

  if (dropped) {
    notes.push(
      `${dropped} further stretches met the thresholds but were dropped at the ${opts.maxSegments}-segment cap.`,
    );
  }

  // Point counts bound the along-path length; the distance actually REPORTED is
  // the sum of chords between resampled points, which reads slightly short on
  // twisty ground. Enforce the threshold on the number that gets stored and
  // shown, so "at least 500 m" is true of the figure on the page and not just
  // of an intermediate the reader never sees.
  const built = accepted.map((a) => buildSegment(a.candidate, usable));
  const segments = built.filter((s) => s.distanceM >= opts.minLengthM);
  const short = built.length - segments.length;
  if (short) {
    notes.push(`${short} stretches measured just under ${opts.minLengthM} m once drawn and were dropped.`);
  }

  return { segments, notes };
}

function buildSegment(candidate: Candidate, sources: SegmentSource[]): DiscoveredSegment {
  const ref = sources[candidate.referenceIndex];
  const track = ref.track;

  const coordinates: DiscoveredSegment['coordinates'] = [];
  let running = 0;
  for (let i = candidate.from; i <= candidate.to; i++) {
    if (i > candidate.from) {
      running += haversineM([track.lng[i - 1], track.lat[i - 1]], [track.lng[i], track.lat[i]]);
    }
    const ele = track.ele[i];
    coordinates.push([track.lng[i], track.lat[i], Number.isNaN(ele) ? null : ele, running]);
  }

  const refElevation = spanElevation(track, candidate.from, candidate.to);

  const efforts: DiscoveredEffort[] = [effortFrom(ref, candidate.from, candidate.to)];

  for (const run of candidate.runs) {
    const from = Math.max(run.from, candidate.from);
    const to = Math.min(run.to, candidate.to);
    if (to <= from) continue;
    const jFrom = run.jmap[from - run.from];
    const jTo = run.jmap[to - run.from];
    const partner = sources[run.partner];
    if (jTo <= jFrom || jTo >= partner.track.n) continue;
    efforts.push(effortFrom(partner, jFrom, jTo));
  }

  return {
    activityType: ref.activityType,
    coordinates,
    distanceM: running,
    elevationGainM: refElevation.gainM,
    elevationLossM: refElevation.lossM,
    efforts,
  };
}

function effortFrom(source: SegmentSource, from: number, to: number): DiscoveredEffort {
  return {
    activityId: source.activityId,
    from,
    to,
    startS: source.track.t[from],
    endS: source.track.t[to],
    distanceM: spanDistanceM(source.track, from, to),
    elevationGainM: spanElevation(source.track, from, to).gainM,
  };
}
