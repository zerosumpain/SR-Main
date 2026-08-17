// Route quality scoring.
//
// This is the half that openrouteservice does not do. ORS answers "give me a
// 10 km loop from here"; it has no opinion about whether that loop pads its
// distance by running 400 m down a dead-end lane and turning round. Deciding
// that is the whole point of /trails, so it is decided here, in pure functions
// over geometry, with no network and no API key needed to test it.

import { haversineM } from './track';

export type Coord = [number, number, number?]; // [lng, lat, elevation?]

// ——— Edge identity ————————————————————————————————————————————————

/**
 * Quantise a coordinate onto a grid so that two passes along the same lane
 * produce the same key despite GPS/graph jitter.
 *
 * 1e-4 degrees is ~11 m of latitude — coarse enough that a there-and-back on
 * one lane collapses onto itself, fine enough that two genuinely parallel
 * streets stay distinct.
 */
const GRID = 1e-4;

function cellKey(c: Coord): string {
  return `${Math.round(c[1] / GRID)}:${Math.round(c[0] / GRID)}`;
}

/** An undirected edge key — running a lane the other way is still the same lane. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface Segment {
  key: string;
  lengthM: number;
  index: number;
}

export function segments(coords: Coord[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = cellKey(coords[i - 1]);
    const b = cellKey(coords[i]);
    if (a === b) continue; // inside one cell — no movement worth counting
    out.push({
      key: edgeKey(a, b),
      lengthM: haversineM([coords[i - 1][0], coords[i - 1][1]], [coords[i][0], coords[i][1]]),
      index: i - 1,
    });
  }
  return out;
}

// ——— Overlap ——————————————————————————————————————————————————————

export interface OverlapResult {
  /** Share of total length that retraces ground already covered. 0 = none. */
  ratio: number;
  repeatedM: number;
  totalM: number;
}

export function overlap(coords: Coord[]): OverlapResult {
  const segs = segments(coords);
  const seen = new Set<string>();
  let repeatedM = 0;
  let totalM = 0;

  for (const seg of segs) {
    totalM += seg.lengthM;
    if (seen.has(seg.key)) repeatedM += seg.lengthM;
    else seen.add(seg.key);
  }

  return { ratio: totalM > 0 ? repeatedM / totalM : 0, repeatedM, totalM };
}

// ——— Spurs ————————————————————————————————————————————————————————

export interface Spur {
  /** Index into the coordinate array where the retraced run begins. */
  startIndex: number;
  endIndex: number;
  lengthM: number;
}

export interface SpurResult {
  spurs: Spur[];
  /** Total length of all out-and-back stubs. */
  totalM: number;
  longestM: number;
}

/**
 * Find out-and-back stubs — the artefact John named: a route that goes down a
 * lane and comes back up it to make the distance add up.
 *
 * A stub shows as a *consecutive run* of segments that have each been walked
 * before. One repeated segment is noise (a junction clipped twice); a run of
 * them is a return leg. Runs shorter than `minLengthM` are ignored so a
 * roundabout or a switchback does not read as a spur.
 */
export function findSpurs(coords: Coord[], minLengthM = 120): SpurResult {
  const segs = segments(coords);
  const seen = new Set<string>();
  const spurs: Spur[] = [];

  let runStart: number | null = null;
  let runLength = 0;
  let runEnd = 0;

  const closeRun = () => {
    if (runStart !== null && runLength >= minLengthM) {
      spurs.push({ startIndex: runStart, endIndex: runEnd, lengthM: runLength });
    }
    runStart = null;
    runLength = 0;
  };

  for (const seg of segs) {
    if (seen.has(seg.key)) {
      if (runStart === null) runStart = seg.index;
      runLength += seg.lengthM;
      runEnd = seg.index + 1;
    } else {
      seen.add(seg.key);
      closeRun();
    }
  }
  closeRun();

  return {
    spurs,
    totalM: spurs.reduce((sum, s) => sum + s.lengthM, 0),
    longestM: spurs.reduce((max, s) => Math.max(max, s.lengthM), 0),
  };
}

// ——— Terrain ——————————————————————————————————————————————————————

// ORS surface codes. Only the ones that change a decision are named.
const SEALED_SURFACES = new Set([1, 2, 3, 4, 5, 6]); // paved, asphalt, concrete family
const LOOSE_SURFACES = new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]); // gravel, ground, grass, dirt…

// ORS waytype codes.
const WAYTYPE_STATE_ROAD = 1;
const WAYTYPE_ROAD = 2;
const WAYTYPE_STREET = 3;
const WAYTYPE_PATH = 4;
const WAYTYPE_TRACK = 5;
const WAYTYPE_CYCLEWAY = 6;
const WAYTYPE_FOOTWAY = 7;
const WAYTYPE_STEPS = 8;

export interface ExtraSummary {
  value: number;
  distance: number;
  amount: number;
}

export interface TerrainFit {
  score: number; // 0..1
  offRoadShare: number;
  sealedShare: number;
  stepsShare: number;
  mainRoadShare: number;
}

/**
 * How well the ground matches the sport.
 *
 * Mountain biking wants dirt and tracks; road cycling wants sealed surfaces
 * and hates steps; running wants a mix but should not be sent up a staircase
 * or along a trunk road.
 */
export function terrainFit(
  sport: string,
  surface: ExtraSummary[],
  waytype: ExtraSummary[],
): TerrainFit {
  const shareOf = (rows: ExtraSummary[], match: (v: number) => boolean): number => {
    const total = rows.reduce((s, r) => s + r.distance, 0);
    if (total <= 0) return 0;
    return rows.filter((r) => match(r.value)).reduce((s, r) => s + r.distance, 0) / total;
  };

  const sealedShare = shareOf(surface, (v) => SEALED_SURFACES.has(v));
  const offRoadShare = shareOf(surface, (v) => LOOSE_SURFACES.has(v));
  const stepsShare = shareOf(waytype, (v) => v === WAYTYPE_STEPS);
  const mainRoadShare = shareOf(waytype, (v) => v === WAYTYPE_STATE_ROAD);
  const trailShare = shareOf(waytype, (v) => v === WAYTYPE_PATH || v === WAYTYPE_TRACK);
  const cycleShare = shareOf(
    waytype,
    (v) => v === WAYTYPE_CYCLEWAY || v === WAYTYPE_ROAD || v === WAYTYPE_STREET,
  );

  let score: number;
  switch (sport) {
    case 'mtb':
      // Dirt and trail are the point; tarmac is transit between the good bits.
      score = 0.6 * offRoadShare + 0.4 * trailShare;
      break;
    case 'ride':
      // Sealed and continuous. Steps mean carrying the bike.
      score = 0.6 * sealedShare + 0.4 * cycleShare - 0.5 * stepsShare;
      break;
    case 'trail_run':
      score = 0.5 * offRoadShare + 0.5 * trailShare;
      break;
    case 'run':
    default:
      // A mix reads best: some path, some pavement, no staircases, no A-roads.
      score = 0.5 * Math.min(1, trailShare * 2) + 0.5 * (1 - mainRoadShare) - 0.3 * stepsShare;
      break;
  }

  // Main roads are unpleasant on foot or bike alike.
  score -= 0.3 * mainRoadShare;

  return {
    score: Math.max(0, Math.min(1, score)),
    offRoadShare,
    sealedShare,
    stepsShare,
    mainRoadShare,
  };
}

// ——— Elevation profile ————————————————————————————————————————————

export interface ProfileFit {
  score: number; // 0..1
  gainPerKm: number;
  /** 0 = evenly spread climbing, 1 = all the climb in one wall. */
  concentration: number;
}

/**
 * How well the climbing matches the ask — in amount AND in shape.
 *
 * Two routes can both have 300 m of climb over 10 km and be completely
 * different runs: one is a steady drag, the other is flat with a wall in the
 * middle. `concentration` separates them, so "steady" can beat "spiky" when
 * that is what was asked for.
 */
export function profileFit(
  coords: Coord[],
  opts: { targetGainPerKm?: number; prefer?: 'steady' | 'spiky' | 'any' } = {},
): ProfileFit {
  const { targetGainPerKm, prefer = 'any' } = opts;

  let totalM = 0;
  let gainM = 0;
  const climbs: Array<{ lengthM: number; gainM: number }> = [];

  for (let i = 1; i < coords.length; i++) {
    const lengthM = haversineM(
      [coords[i - 1][0], coords[i - 1][1]],
      [coords[i][0], coords[i][1]],
    );
    totalM += lengthM;
    const a = coords[i - 1][2];
    const b = coords[i][2];
    if (typeof a === 'number' && typeof b === 'number' && b > a && lengthM > 0) {
      gainM += b - a;
      climbs.push({ lengthM, gainM: b - a });
    }
  }

  const km = totalM / 1000;
  const gainPerKm = km > 0 ? gainM / km : 0;

  // Concentration: the share of all climbing packed into the steepest tenth of
  // the route BY DISTANCE. Measured against distance rather than against a
  // count of segments, because a count is an artefact of how finely the router
  // happened to sample the line — a wall described by 8 points and a drag
  // described by 160 would otherwise look equally even.
  //
  // 0.1 is perfectly even; 1.0 means every metre of climb is in one wall.
  let concentration = 0;
  if (climbs.length > 1 && gainM > 0 && totalM > 0) {
    const steepestFirst = [...climbs].sort((a, b) => b.gainM / b.lengthM - a.gainM / a.lengthM);
    const budgetM = totalM * 0.1;
    let usedM = 0;
    let capturedGain = 0;
    for (const c of steepestFirst) {
      if (usedM >= budgetM) break;
      const take = Math.min(c.lengthM, budgetM - usedM);
      capturedGain += c.gainM * (take / c.lengthM);
      usedM += take;
    }
    concentration = capturedGain / gainM;
  }

  let score = 1;
  if (targetGainPerKm != null && targetGainPerKm > 0) {
    // Full marks within 25% of target, tapering to zero at 3x off.
    const ratio = gainPerKm / targetGainPerKm;
    const deviation = Math.abs(Math.log2(ratio || 0.01));
    score = Math.max(0, 1 - deviation / 1.6);
  }

  if (prefer === 'steady') score *= 1 - Math.min(0.6, Math.max(0, concentration - 0.15));
  else if (prefer === 'spiky') score *= 0.6 + 0.4 * Math.min(1, concentration * 2);

  return { score: Math.max(0, Math.min(1, score)), gainPerKm, concentration };
}

// ——— Distance fit ————————————————————————————————————————————————

export function distanceFit(actualM: number, targetM: number): number {
  if (!targetM) return 1;
  const ratio = actualM / targetM;
  // Within 10% is full marks; 40% out scores nothing.
  const off = Math.abs(ratio - 1);
  return Math.max(0, Math.min(1, 1 - (off - 0.1) / 0.3));
}

// ——— The combined verdict ————————————————————————————————————————

export interface ScoreInput {
  coordinates: Coord[];
  distanceM: number;
  sport: string;
  targetDistanceM: number;
  targetGainPerKm?: number;
  prefer?: 'steady' | 'spiky' | 'any';
  surface?: ExtraSummary[];
  waytype?: ExtraSummary[];
  /** When the user actually wants an out-and-back, stop penalising it. */
  allowOutAndBack?: boolean;
}

export interface RouteScore {
  total: number;
  overlap: OverlapResult;
  spurs: SpurResult;
  terrain: TerrainFit;
  profile: ProfileFit;
  distanceScore: number;
  /** Plain-language reasons, shown to the user rather than kept as a number. */
  notes: string[];
}

export function scoreRoute(input: ScoreInput): RouteScore {
  const ov = overlap(input.coordinates);
  const sp = findSpurs(input.coordinates);
  const terrain = terrainFit(input.sport, input.surface ?? [], input.waytype ?? []);
  const profile = profileFit(input.coordinates, {
    targetGainPerKm: input.targetGainPerKm,
    prefer: input.prefer,
  });
  const distanceScore = distanceFit(input.distanceM, input.targetDistanceM);

  const notes: string[] = [];

  // Overlap and spurs are the two things that make a "loop" not a loop, so
  // they are weighted hardest — unless the user asked for an out-and-back,
  // in which case retracing is the request, not a defect.
  let loopScore = 1;
  if (!input.allowOutAndBack) {
    loopScore = 1 - Math.min(1, ov.ratio / 0.35);
    if (sp.spurs.length) {
      const spurPenalty = Math.min(0.8, sp.totalM / Math.max(1, input.distanceM) / 0.15);
      loopScore = Math.max(0, loopScore - spurPenalty);
      notes.push(
        `${sp.spurs.length} out-and-back ${sp.spurs.length === 1 ? 'section' : 'sections'}, longest ${Math.round(sp.longestM)} m`,
      );
    }
    if (ov.ratio > 0.02) notes.push(`${Math.round(ov.ratio * 100)}% of the route retraces itself`);
  } else if (ov.ratio > 0.02) {
    notes.push(`${Math.round(ov.ratio * 100)}% retraced (out-and-back allowed)`);
  }

  if (terrain.stepsShare > 0.01) {
    notes.push(`${Math.round(terrain.stepsShare * 100)}% steps`);
  }
  if (terrain.mainRoadShare > 0.05) {
    notes.push(`${Math.round(terrain.mainRoadShare * 100)}% main road`);
  }
  if (profile.gainPerKm > 0) {
    notes.push(`${Math.round(profile.gainPerKm)} m climb per km`);
  }
  if (profile.concentration > 0.5) {
    notes.push('climbing is concentrated in one steep section');
  }

  const total =
    0.4 * loopScore + 0.25 * distanceScore + 0.2 * terrain.score + 0.15 * profile.score;

  return {
    total: Math.max(0, Math.min(1, total)),
    overlap: ov,
    spurs: sp,
    terrain,
    profile,
    distanceScore,
    notes,
  };
}
