import { describe, it, expect } from 'vitest';
import {
  overlap,
  findSpurs,
  terrainFit,
  profileFit,
  distanceFit,
  scoreRoute,
  type Coord,
} from './scoring';

// ——— Route builders ————————————————————————————————————————————————
// Everything is built around 53.40N, -1.50E. At that latitude 0.009 deg of
// latitude is ~1000 m, and a degree of longitude is ~0.6 of a degree of
// latitude, so the east-west step is scaled to match.

const LAT0 = 53.4;
const LNG0 = -1.5;
const DEG_LAT_PER_KM = 0.008993;
const DEG_LNG_PER_KM = DEG_LAT_PER_KM / Math.cos((LAT0 * Math.PI) / 180);

function pt(kmEast: number, kmNorth: number, ele?: number): Coord {
  return [LNG0 + kmEast * DEG_LNG_PER_KM, LAT0 + kmNorth * DEG_LAT_PER_KM, ele];
}

/** Interpolate between two points so segments are ~25 m, like real graph output. */
function leg(from: Coord, to: Coord, steps = 40): Coord[] {
  const out: Coord[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ele =
      from[2] != null && to[2] != null ? from[2] + (to[2] - from[2]) * t : undefined;
    out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, ele]);
  }
  return out;
}

/** A clean 4 km square loop — the shape a good circular route has. */
function squareLoop(): Coord[] {
  const a = pt(0, 0);
  const b = pt(1, 0);
  const c = pt(1, 1);
  const d = pt(0, 1);
  return [a, ...leg(a, b), ...leg(b, c), ...leg(c, d), ...leg(d, a)];
}

/** Straight out and straight back — 100% retraced by construction. */
function outAndBack(): Coord[] {
  const a = pt(0, 0);
  const b = pt(2, 0);
  const outward = [a, ...leg(a, b, 80)];
  const back = [...outward].reverse().slice(1);
  return [...outward, ...back];
}

/**
 * A square loop that pads its distance by running 500 m down a lane and back —
 * the artefact John asked the planner to avoid.
 */
function loopWithSpur(): Coord[] {
  const a = pt(0, 0);
  const b = pt(1, 0);
  const c = pt(1, 1);
  const d = pt(0, 1);
  const laneEnd = pt(1.5, 0.5);

  const detourOut = leg(c, laneEnd, 20);
  const detourBack = [...detourOut].reverse().slice(1).concat([c]);

  return [
    a,
    ...leg(a, b),
    ...leg(b, c),
    ...detourOut,
    ...detourBack,
    ...leg(c, d),
    ...leg(d, a),
  ];
}

// ——— Overlap ——————————————————————————————————————————————————————

describe('overlap', () => {
  it('finds no retracing on a clean loop', () => {
    expect(overlap(squareLoop()).ratio).toBeLessThan(0.02);
  });

  it('finds roughly half of an out-and-back retraced', () => {
    const result = overlap(outAndBack());
    expect(result.ratio).toBeGreaterThan(0.45);
    expect(result.ratio).toBeLessThan(0.55);
  });

  it('does not care which direction the lane was run', () => {
    const forward = overlap(outAndBack()).ratio;
    const reversed = overlap([...outAndBack()].reverse()).ratio;
    expect(reversed).toBeCloseTo(forward, 2);
  });

  it('reports zero for a route too short to have segments', () => {
    expect(overlap([pt(0, 0)]).ratio).toBe(0);
    expect(overlap([]).ratio).toBe(0);
  });
});

// ——— Spurs ————————————————————————————————————————————————————————

describe('findSpurs', () => {
  it('finds nothing on a clean loop', () => {
    expect(findSpurs(squareLoop()).spurs).toHaveLength(0);
  });

  it('finds the lane a lollipop route runs down and back', () => {
    const result = findSpurs(loopWithSpur());
    expect(result.spurs.length).toBeGreaterThanOrEqual(1);
    // The detour is ~707 m each way; the retraced leg is what shows.
    expect(result.longestM).toBeGreaterThan(400);
    expect(result.longestM).toBeLessThan(900);
  });

  it('finds the return leg of a pure out-and-back', () => {
    const result = findSpurs(outAndBack());
    expect(result.spurs).toHaveLength(1);
    expect(result.totalM).toBeGreaterThan(1800);
  });

  it('ignores a stub too short to be a detour', () => {
    // A 30 m clipped junction is noise, not a spur.
    const a = pt(0, 0);
    const b = pt(1, 0);
    const nub = pt(1.03, 0);
    const route = [a, ...leg(a, b), ...leg(b, nub, 3), ...leg(nub, b, 3), ...leg(b, pt(1, 1))];
    expect(findSpurs(route, 120).spurs).toHaveLength(0);
  });

  it('honours a custom minimum length', () => {
    expect(findSpurs(loopWithSpur(), 10_000).spurs).toHaveLength(0);
  });
});

// ——— Terrain ——————————————————————————————————————————————————————

const SURFACE_MOSTLY_DIRT = [
  { value: 3, distance: 1000, amount: 20 }, // asphalt
  { value: 8, distance: 4000, amount: 80 }, // ground
];
const SURFACE_MOSTLY_SEALED = [
  { value: 3, distance: 4500, amount: 90 },
  { value: 8, distance: 500, amount: 10 },
];
const WAYTYPE_TRAILS = [
  { value: 4, distance: 3000, amount: 60 }, // path
  { value: 5, distance: 2000, amount: 40 }, // track
];
const WAYTYPE_ROADS = [
  { value: 3, distance: 4000, amount: 80 }, // street
  { value: 6, distance: 1000, amount: 20 }, // cycleway
];
const WAYTYPE_WITH_STEPS = [
  { value: 3, distance: 4000, amount: 80 },
  { value: 8, distance: 1000, amount: 20 }, // steps
];

describe('terrainFit', () => {
  it('rates dirt and track highly for mountain biking', () => {
    const good = terrainFit('mtb', SURFACE_MOSTLY_DIRT, WAYTYPE_TRAILS);
    const bad = terrainFit('mtb', SURFACE_MOSTLY_SEALED, WAYTYPE_ROADS);
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.offRoadShare).toBeCloseTo(0.8, 2);
  });

  it('rates sealed roads highly for road cycling', () => {
    const good = terrainFit('ride', SURFACE_MOSTLY_SEALED, WAYTYPE_ROADS);
    const bad = terrainFit('ride', SURFACE_MOSTLY_DIRT, WAYTYPE_TRAILS);
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it('punishes steps for a cyclist — they mean carrying the bike', () => {
    const clean = terrainFit('ride', SURFACE_MOSTLY_SEALED, WAYTYPE_ROADS);
    const steps = terrainFit('ride', SURFACE_MOSTLY_SEALED, WAYTYPE_WITH_STEPS);
    expect(steps.score).toBeLessThan(clean.score);
    expect(steps.stepsShare).toBeCloseTo(0.2, 2);
  });

  it('punishes main roads for everyone', () => {
    const mainRoad = [{ value: 1, distance: 5000, amount: 100 }];
    const street = [{ value: 3, distance: 5000, amount: 100 }];
    expect(terrainFit('run', SURFACE_MOSTLY_SEALED, mainRoad).score).toBeLessThan(
      terrainFit('run', SURFACE_MOSTLY_SEALED, street).score,
    );
  });

  it('never returns a score outside 0..1', () => {
    const awful = terrainFit('ride', SURFACE_MOSTLY_DIRT, [
      { value: 1, distance: 3000, amount: 60 },
      { value: 8, distance: 2000, amount: 40 },
    ]);
    expect(awful.score).toBeGreaterThanOrEqual(0);
    expect(awful.score).toBeLessThanOrEqual(1);
  });

  it('copes with an empty terrain breakdown', () => {
    const fit = terrainFit('run', [], []);
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.offRoadShare).toBe(0);
  });
});

// ——— Elevation profile ————————————————————————————————————————————

describe('profileFit', () => {
  /** 4 km with `gain` metres spread evenly. */
  function steadyClimb(gain: number): Coord[] {
    const a = pt(0, 0, 100);
    const b = pt(4, 0, 100 + gain);
    return [a, ...leg(a, b, 160)];
  }

  /** 4 km, flat except one short wall of `gain` metres. */
  function oneWall(gain: number): Coord[] {
    const a = pt(0, 0, 100);
    const b = pt(1.9, 0, 100);
    const c = pt(2.1, 0, 100 + gain);
    const d = pt(4, 0, 100 + gain);
    return [a, ...leg(a, b, 76), ...leg(b, c, 8), ...leg(c, d, 76)];
  }

  it('measures climb per kilometre', () => {
    const fit = profileFit(steadyClimb(200));
    expect(fit.gainPerKm).toBeGreaterThan(45);
    expect(fit.gainPerKm).toBeLessThan(55);
  });

  it('separates a steady drag from a single wall', () => {
    expect(profileFit(oneWall(200)).concentration).toBeGreaterThan(
      profileFit(steadyClimb(200)).concentration,
    );
  });

  it('prefers the steady route when steady was asked for', () => {
    const steady = profileFit(steadyClimb(200), { targetGainPerKm: 50, prefer: 'steady' });
    const wall = profileFit(oneWall(200), { targetGainPerKm: 50, prefer: 'steady' });
    expect(steady.score).toBeGreaterThan(wall.score);
  });

  it('scores a route near the target higher than one far off it', () => {
    const onTarget = profileFit(steadyClimb(200), { targetGainPerKm: 50 });
    const tooFlat = profileFit(steadyClimb(20), { targetGainPerKm: 50 });
    expect(onTarget.score).toBeGreaterThan(tooFlat.score);
  });

  it('does not fall over when the route has no elevation data', () => {
    const fit = profileFit(squareLoop());
    expect(fit.gainPerKm).toBe(0);
    expect(Number.isFinite(fit.score)).toBe(true);
  });
});

// ——— Distance ————————————————————————————————————————————————————

describe('distanceFit', () => {
  it('gives full marks within 10% of target', () => {
    expect(distanceFit(10_000, 10_000)).toBe(1);
    expect(distanceFit(10_500, 10_000)).toBe(1);
  });

  it('tapers as the route drifts from the ask', () => {
    expect(distanceFit(12_000, 10_000)).toBeGreaterThan(0);
    expect(distanceFit(12_000, 10_000)).toBeLessThan(1);
  });

  it('scores nothing for a wildly wrong distance', () => {
    expect(distanceFit(20_000, 10_000)).toBe(0);
  });
});

// ——— The combined verdict ————————————————————————————————————————

describe('scoreRoute', () => {
  const base = {
    sport: 'run',
    targetDistanceM: 4000,
    surface: SURFACE_MOSTLY_SEALED,
    waytype: WAYTYPE_ROADS,
  };

  it('prefers a clean loop over the same distance with a spur', () => {
    const clean = scoreRoute({ ...base, coordinates: squareLoop(), distanceM: 4000 });
    const spurred = scoreRoute({ ...base, coordinates: loopWithSpur(), distanceM: 4000 });
    expect(clean.total).toBeGreaterThan(spurred.total);
  });

  it('prefers a clean loop over an out-and-back', () => {
    const clean = scoreRoute({ ...base, coordinates: squareLoop(), distanceM: 4000 });
    const there = scoreRoute({ ...base, coordinates: outAndBack(), distanceM: 4000 });
    expect(clean.total).toBeGreaterThan(there.total);
  });

  it('stops penalising retracing when an out-and-back was requested', () => {
    const penalised = scoreRoute({ ...base, coordinates: outAndBack(), distanceM: 4000 });
    const allowed = scoreRoute({
      ...base,
      coordinates: outAndBack(),
      distanceM: 4000,
      allowOutAndBack: true,
    });
    expect(allowed.total).toBeGreaterThan(penalised.total);
  });

  it('explains itself in words, not just a number', () => {
    const spurred = scoreRoute({ ...base, coordinates: loopWithSpur(), distanceM: 4000 });
    expect(spurred.notes.join(' ')).toMatch(/out-and-back/);
    expect(spurred.notes.join(' ')).toMatch(/retraces/);
  });

  it('keeps the total inside 0..1', () => {
    for (const coords of [squareLoop(), outAndBack(), loopWithSpur()]) {
      const s = scoreRoute({ ...base, coordinates: coords, distanceM: 4000 });
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.total).toBeLessThanOrEqual(1);
    }
  });

  it('marks a route down for being the wrong length', () => {
    const right = scoreRoute({ ...base, coordinates: squareLoop(), distanceM: 4000 });
    const wrong = scoreRoute({ ...base, coordinates: squareLoop(), distanceM: 9000 });
    expect(wrong.total).toBeLessThan(right.total);
  });
});
