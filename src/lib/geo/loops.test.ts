import { describe, it, expect } from 'vitest';
import {
  GEO_THRESHOLDS,
  cleanJourney,
  detectLoops,
  extractRings,
  trampledTiles,
  type GeoFix,
} from './loops';
import { localProjection, tileAreaM2, tileAt, tileKeyOf, tileSideM } from './tiles';
import { isSimpleRing, ringArea, ringPerimeter, type Vec2 } from './rings';
import { ORIGIN, jitterFlower, square, walk } from './test-fixtures';

const proj = localProjection(ORIGIN.lat, ORIGIN.lon);
const metresOf = (f: { lat: number; lon: number }) => proj.toM(f.lat, f.lon);
const CELL_M2 = tileAreaM2(ORIGIN.lat);

/** N laps of the same block, retraced EXACTLY — no GPS wander to save us. */
function exactLaps(n: number, side = 200): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push([0, 0], [side, 0], [side, side], [0, side]);
  out.push([0, 0]);
  return out;
}

/**
 * A route whose OUTERMOST self-crossing pops a sub-path that still contains a
 * crossing of its own: seg 0 crosses seg 7, and inside that span seg 2 crosses
 * seg 4. `firstSelfCrossing` scans i ascending, so it finds the outer one first.
 */
const NESTED_CROSSINGS: Vec2[] = [
  [100, -50], [100, 600], [300, 500], [500, 700], [300, 700], [500, 500], [700, 600], [700, 50], [-50, 50],
];

/** A phone on a windowsill: 30-minute polling, no accuracy, no mode, wander. */
function stationaryWander(radiusM: number, fixes = 24): GeoFix[] {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: GeoFix[] = [];
  for (let i = 0; i < fixes; i++) {
    const a = rnd() * 2 * Math.PI;
    const r = radiusM * Math.sqrt(rnd());
    const { lat, lon } = proj.toLatLon([Math.cos(a) * r, Math.sin(a) * r]);
    out.push({
      lat,
      lon,
      ts: new Date(Date.UTC(2026, 7, 1, 20, 0, 0) + i * 30 * 60_000),
      accuracyM: null,
      mode: null,
      speedKmh: null,
    });
  }
  return out;
}

/** Gerono lemniscate — a figure-of-eight whose two strands genuinely cross. */
function lemniscate(a = 300, samples = 46): Vec2[] {
  const pts: Vec2[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = (2 * Math.PI * k) / samples;
    pts.push([a * Math.cos(t), (a / 2) * Math.sin(2 * t)]);
  }
  return pts;
}

/**
 * Out and back along one line, the return leg offset by 3 m of GPS wander.
 * Run on a real-world bearing rather than due east: a due-east fixture would sit
 * parallel to the tile lattice and the result would turn on lattice alignment.
 */
function outAndBack(lengthM = 600, offsetM = 3, bearingDeg = 65): Vec2[] {
  const r = (bearingDeg * Math.PI) / 180;
  const ux = Math.sin(r);
  const uy = Math.cos(r);
  // Perpendicular, for the return offset.
  const px = uy;
  const py = -ux;
  return [
    [0, 0],
    [ux * lengthM, uy * lengthM],
    [ux * lengthM + px * offsetM, uy * lengthM + py * offsetM],
    [px * offsetM, py * offsetM],
  ];
}

/** Stick out, big head, and the return leg cuts back across the outbound track. */
const LOLLIPOP: Vec2[] = [
  [0, 0],
  [400, 0],
  [400, 300],
  [700, 300],
  [700, -150],
  [300, -150],
  [380, 60], // crosses the stick at (357.1, 0)
  [150, 60],
];

describe('thresholds', () => {
  it('exports the spec numbers as constants', () => {
    expect(GEO_THRESHOLDS.maxAccuracyM).toBe(75);
    expect(GEO_THRESHOLDS.maxSpeedKmh).toBe(25);
    expect(GEO_THRESHOLDS.jitterRadiusM).toBe(25);
    expect(GEO_THRESHOLDS.decimateM).toBe(10);
    expect(GEO_THRESHOLDS.minClosedPathM).toBe(400);
    expect(GEO_THRESHOLDS.endpointGapM).toBe(60);
    expect(GEO_THRESHOLDS.endpointGapFraction).toBe(0.05);
    expect(GEO_THRESHOLDS.maxClosingChordFraction).toBe(0.25);
    expect(GEO_THRESHOLDS.minEnclosedTiles).toBe(2);
    expect(GEO_THRESHOLDS.maxEnclosedTiles).toBe(1000);
    expect(GEO_THRESHOLDS.maxInterpolationM).toBe(300);
    expect(GEO_THRESHOLDS.maxInterpolationS).toBe(180);
    expect(GEO_THRESHOLDS.excludedModes).toContain('vehicle');
    expect(GEO_THRESHOLDS.excludedModes).toContain('rail');
  });

  it('carries the gates the review added, so a claim row records all of them', () => {
    // Cycling (Decision 7), the observation-gap and dwell halves of the
    // stationary defence, and the ring-width floor. Each is a number a Phase 5
    // retune will want, and each is only retunable without invalidating history
    // because it is persisted on the claim.
    expect(GEO_THRESHOLDS.excludedActivityTypes).toEqual(['ride', 'mtb']);
    expect(GEO_THRESHOLDS.maxObservationGapS).toBe(360);
    expect(GEO_THRESHOLDS.minMovingKmh).toBe(1);
    expect(GEO_THRESHOLDS.minRingWidthCells).toBe(0.5);
  });

  it('hands the caller back the set it used, for the claim row', () => {
    const r = detectLoops(walk(square(200)));
    expect(r.thresholds).toEqual(GEO_THRESHOLDS);
    expect(r.rings[0].closure.thresholds).toEqual(GEO_THRESHOLDS);
  });

  it('an override is honoured and reported, not silently ignored', () => {
    const r = detectLoops(walk(square(200)), { minEnclosedTiles: 500 });
    expect(r.thresholds.minEnclosedTiles).toBe(500);
    expect(r.rings).toHaveLength(0);
  });
});

describe('cleanJourney', () => {
  it('drops fixes worse than 75 m accuracy', () => {
    const fixes = walk(square(200));
    fixes[5] = { ...fixes[5], accuracyM: 120 };
    const clean = cleanJourney(fixes);
    expect(clean.dropped.accuracy).toBe(1);
  });

  it('drops vehicle and rail legs entirely', () => {
    const fixes = walk(square(2000), { mode: 'vehicle', speedKmh: 60 });
    const clean = cleanJourney(fixes);
    expect(clean.segments.flat()).toHaveLength(0);
    expect(clean.dropped.mode).toBeGreaterThan(0);
  });

  it('drops a leg whose implied speed exceeds 25 km/h even when the mode lies', () => {
    // 2 km in 45 s is 160 km/h; the mode column says "walking".
    const home = walk(square(200));
    const teleported: GeoFix[] = [
      ...home,
      {
        ...home[0],
        lat: home[0].lat + 0.02,
        ts: new Date(home[home.length - 1].ts.getTime() + 45_000),
      },
    ];
    const clean = cleanJourney(teleported);
    expect(clean.dropped.speed).toBeGreaterThan(0);
  });

  it('collapses a stationary jitter flower to nothing that could be a shape', () => {
    // Polled every 30 minutes, so every leg is a hole in the record: the run is
    // cut at each one and no surviving run has enough vertices to be a ring.
    const clean = cleanJourney(jitterFlower());
    expect(clean.dropped.gap).toBeGreaterThan(0);
    expect(clean.segments.every((seg) => seg.length < 4)).toBe(true);
  });

  it('keeps the shape of a real walk', () => {
    const clean = cleanJourney(walk(square(200)));
    const kept = clean.segments.flat();
    expect(kept.length).toBeGreaterThan(20);
    expect(kept.length).toBeLessThan(walk(square(200)).length);
  });
});

describe('closure', () => {
  it('a square walk closes on the endpoint test', () => {
    const r = detectLoops(walk(square(200)));
    expect(r.rings).toHaveLength(1);
    expect(r.rings[0].closure.method).toBe('endpoint');
    expect(r.rings[0].closure.gapM).toBeLessThan(GEO_THRESHOLDS.endpointGapM);
    // 200 m square is 40,000 m2, ~20 z19 cells.
    expect(r.rings[0].areaM2).toBeGreaterThan(35_000);
    expect(r.rings[0].areaM2).toBeLessThan(45_000);
    expect(r.rings[0].tiles.length).toBeGreaterThanOrEqual(15);
    expect(r.rings[0].tiles.length).toBeLessThanOrEqual(28);
  });

  it('a loop shorter than 400 m does not close on endpoints', () => {
    const r = detectLoops(walk(square(80)));
    expect(r.rings).toHaveLength(0);
  });

  it('an out-and-back tramples only and produces NO claim', () => {
    const fixes = walk(outAndBack());
    const r = detectLoops(fixes);
    expect(r.rings).toHaveLength(0);
    // The path itself survives cleaning, so trample capture still has something
    // to rasterise — "tramples only", not "discarded".
    expect(r.segments.flat().length).toBeGreaterThan(10);
    // And it was rejected on the size floor, not by failing to close.
    expect(r.rejected.length).toBeGreaterThan(0);
    expect(['too-few-tiles', 'too-small']).toContain(r.rejected[0].reason);
  });

  it('a figure-of-eight yields both lobes', () => {
    const r = detectLoops(walk(lemniscate(), { stepM: 10_000 }));
    expect(r.rings).toHaveLength(2);

    const centroidX = r.rings.map((ring) => {
      const xs = ring.ring.map((c) => metresOf({ lon: c[0], lat: c[1] })[0]);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    });
    expect(Math.min(...centroidX)).toBeLessThan(-50);
    expect(Math.max(...centroidX)).toBeGreaterThan(50);

    // At least one lobe had to come from the crossing; both lobes cannot be
    // reached by endpoint proximity alone.
    expect(r.rings.map((x) => x.closure.method)).toContain('self-intersection');

    // Lobes are disjoint ground.
    const a = new Set(r.rings[0].tiles.map((t) => tileKeyOf(t.x, t.y)));
    const b = r.rings[1].tiles.map((t) => tileKeyOf(t.x, t.y));
    expect(b.some((k) => a.has(k))).toBe(false);
  });

  it('a lollipop closes via self-intersection, not endpoint proximity', () => {
    const r = detectLoops(walk(LOLLIPOP));
    expect(r.rings).toHaveLength(1);
    expect(r.rings[0].closure.method).toBe('self-intersection');

    // Prove the endpoint test could never have seen it: the walk ends 160 m
    // from where it started.
    const clean = cleanJourney(walk(LOLLIPOP)).segments.flat();
    const first = metresOf(clean[0]);
    const last = metresOf(clean[clean.length - 1]);
    expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeGreaterThan(100);

    // The head is ~300 x 450 m.
    expect(r.rings[0].areaM2).toBeGreaterThan(100_000);
    expect(r.rings[0].areaM2).toBeLessThan(170_000);
  });
});

describe('qualification', () => {
  it('a stationary jitter flower is rejected', () => {
    expect(detectLoops(jitterFlower()).rings).toHaveLength(0);
    // Even with the jitter collapse switched off, it is under the size floor.
    expect(
      detectLoops(jitterFlower(), { jitterRadiusM: 0, decimateM: 0 }).rings,
    ).toHaveLength(0);
  });

  it('rejects a ribbon on the area floor even when it catches enough centroids', () => {
    // The out-and-back sliver is 1,755 m2. Drop the cell floor to one so the
    // COUNT gate cannot fire, and the area form of the same floor must still
    // stop it — which is what makes the sliver trap deterministic instead of a
    // question of where the tile lattice happens to sit.
    const r = detectLoops(walk(outAndBack()), { minEnclosedTiles: 1 });
    expect(r.rings).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('too-small');
    expect(r.rejected[0].areaM2).toBeLessThan(4000);
    expect(r.rejected[0].tileCount).toBeGreaterThanOrEqual(1);
  });

  it('an oversized drive ring is rejected by the 1000-tile ceiling', () => {
    // 3 km square, walked slowly enough that the speed and mode gates never
    // fire — so the ceiling is demonstrably the thing that stops it.
    const fixes = walk(square(3000), { stepM: 100, speedMps: 1.4, mode: 'walking' });
    const clean = cleanJourney(fixes);
    expect(clean.dropped.mode).toBe(0);
    expect(clean.dropped.speed).toBe(0);

    const r = detectLoops(fixes);
    expect(r.rings).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('too-many-tiles');
    expect(r.rejected[0].tileCount).toBeGreaterThan(GEO_THRESHOLDS.maxEnclosedTiles);
  });
});

// ---------------------------------------------------------------------------
// Regressions from the adversarial review of the geometry core (2026-08-29).
// Every one of these was a reproduced defect before the fix beside it.
// ---------------------------------------------------------------------------

describe('winding — capture must not depend on the lap count', () => {
  it('two laps of the same block claim the same ground as one lap', () => {
    // Exactly-retraced laps never cross transversally, so nothing pops and the
    // whole doubly-wound path closes as ONE ring. Under an even-odd fill every
    // interior centroid counted two crossings and the walk captured NOTHING —
    // capture flipped on the parity of the lap count.
    const one = detectLoops(walk(exactLaps(1), { stepM: 20 }));
    expect(one.rings).toHaveLength(1);
    const ground = new Set(one.rings[0].tiles.map((t) => tileKeyOf(t.x, t.y)));
    expect(ground.size).toBeGreaterThanOrEqual(15);

    for (const n of [2, 3, 4, 10]) {
      const r = detectLoops(walk(exactLaps(n), { stepM: 20 }));
      const got = new Set(r.rings.flatMap((x) => x.tiles.map((t) => tileKeyOf(t.x, t.y))));
      expect([...got].sort(), `${n} laps`).toEqual([...ground].sort());
    }
  });

  it('a block walked three times records the area of ONE lap', () => {
    // Found while fixing the parity bug above, in the same family: the shoelace
    // of a triply-wound ring is three times the ground it covers, and that
    // number is what `geo_claims.area_m2` stores and Phase 2 hand-checks.
    const one = detectLoops(walk(exactLaps(1), { stepM: 20 })).rings[0];
    for (const n of [2, 3, 10]) {
      const r = detectLoops(walk(exactLaps(n), { stepM: 20 }));
      expect(r.rings, `${n} laps`).toHaveLength(1);
      expect(r.rings[0].areaM2 / one.areaM2, `${n} laps`).toBeCloseTo(1, 2);
      expect(r.rings[0].capturedAreaM2, `${n} laps`).toBeCloseTo(one.capturedAreaM2, 6);
    }
  });

  it('holds at every sampling rate, not just the lucky one', () => {
    for (const stepM of [20, 40, 80]) {
      for (const n of [1, 2, 3]) {
        const r = detectLoops(walk(exactLaps(n), { stepM }));
        const got = r.rings.flatMap((x) => x.tiles).length;
        expect(got, `${n} laps at ${stepM} m`).toBeGreaterThanOrEqual(15);
      }
    }
  });
});

describe('popped rings are simple, so their area is honest', () => {
  it('extractRings never returns a ring that crosses itself', () => {
    const cut = extractRings(NESTED_CROSSINGS, GEO_THRESHOLDS);
    expect(cut.length).toBeGreaterThan(0);
    for (const c of cut) expect(isSimpleRing(c.ring), c.method).toBe(true);
  });

  it('the shoelace of a popped ring no longer cancels its own lobes', () => {
    // Before the split the outermost pop handed back a bowtie whose opposite
    // lobes cancelled in the signed area — the number stored as claims.area_m2
    // and the number the size floor is keyed on.
    const cut = extractRings(NESTED_CROSSINGS, GEO_THRESHOLDS);
    const total = cut.reduce((a, c) => a + ringArea(c.ring), 0);
    // The outer rectangle alone is 600 x 550.
    expect(total).toBeGreaterThan(300_000);
  });

  it('a claimed ring measures within a few percent of the ground it is paid for', () => {
    // The spec hand-checks claims.area_m2 in Phase 2. Ring area and cell-count
    // area are two different models and must agree on a compact shape.
    const r = detectLoops(walk(square(600)));
    const ring = r.rings[0];
    // Cell area is taken at the RING's centre latitude, not the fixture origin,
    // so these agree to a part in ten thousand rather than exactly.
    expect(ring.capturedAreaM2 / (ring.tiles.length * CELL_M2)).toBeCloseTo(1, 3);
    // 6.9% apart on a 600 m square, which is the grid's own coarseness showing
    // (a 44 m cell against a 600 m side) and not a bug in either number. What
    // matters is that they no longer differ by 40x, as they did when a popped
    // ring's opposite lobes cancelled in the shoelace.
    expect(Math.abs(ring.areaM2 - ring.capturedAreaM2) / ring.areaM2).toBeLessThan(0.1);
  });
});

describe('thinness — a there-and-back is not a loop', () => {
  it('rejects a return leg one road width off the outbound one', () => {
    // 10-20 m of cross-track separation is one carriageway, or two people on
    // opposite pavements. It used to close on the endpoint test and be paid
    // loop weight 3 on every street the family walks down and back.
    for (const sep of [10, 12, 20]) {
      const r = detectLoops(walk(outAndBack(600, sep)));
      expect(r.rings, `${sep} m separation`).toHaveLength(0);
      expect(r.rejected.map((x) => x.reason), `${sep} m separation`).toContain('too-thin');
      // Still tramples: the path survives cleaning.
      expect(r.segments.flat().length).toBeGreaterThan(10);
    }
  });

  it('the bar does not move when the same shape gets longer or is walked twice', () => {
    // The reason the gate is a WIDTH and not the isoperimetric quotient it was
    // first written as. That ratio halves when a block gets longer and falls by
    // ten when the walker goes round ten times, so it condemned shapes for
    // being long or for being repeated rather than for being narrow — the same
    // lap-parity class of bug as the even-odd fill.
    const measure = (fixes: ReturnType<typeof walk>) => {
      const r = detectLoops(fixes);
      const ring = r.rings[0] ?? r.rejected[0];
      const m = (r.rings[0]?.ring ?? []).map((c): Vec2 => proj.toM(c[1], c[0]));
      return {
        widthM: ring.widthM,
        quotient: m.length ? (4 * Math.PI * ringArea(m)) / ringPerimeter(m) ** 2 : NaN,
      };
    };
    const block = (long: number, short: number): Vec2[] => [
      [0, 0], [long, 0], [long, short], [0, short], [0, 0],
    ];
    const bar = GEO_THRESHOLDS.minRingWidthCells * tileSideM(ORIGIN.lat);

    // Same 40 m width at two lengths: the width proxy moves 6%, the quotient 58%.
    const short = measure(walk(block(400, 40)));
    const long = measure(walk(block(1000, 40)));
    expect(Math.abs(short.widthM - long.widthM) / short.widthM).toBeLessThan(0.1);
    expect(Math.abs(short.quotient - long.quotient) / short.quotient).toBeGreaterThan(0.4);
    expect(short.widthM).toBeGreaterThan(bar);
    expect(long.widthM).toBeGreaterThan(bar);

    // Same shape, walked twice.
    const once = measure(walk(block(600, 100)));
    const twice = measure(walk([...block(600, 100), ...block(600, 100)]));
    expect(twice.widthM).toBeCloseTo(once.widthM, 0);
    expect(twice.quotient).toBeLessThan(once.quotient / 1.8);
    expect(twice.widthM).toBeGreaterThan(bar);
  });

  it('keeps a genuine block walk — down one street and back the next', () => {
    // The shape the gate must NOT eat, and the reason the threshold is not
    // simply "reject anything long and narrow". A 600 x 100 m block is what a
    // family walk round the houses actually looks like; a 400 x 40 m one is the
    // narrowest real block in Darlington and is still 8 cells of ground.
    //
    // (An out-and-back cannot be used for this: the endpoint gap allowance is
    // max(60 m, 5% of path), so a separation over ~65 m never closes anyway.
    // Everything the thinness gate can reach is one road width or less.)
    for (const [long, short] of [[600, 100], [400, 40]]) {
      const block: Vec2[] = [[0, 0], [long, 0], [long, short], [0, short], [0, 0]];
      const r = detectLoops(walk(block));
      expect(r.rings, `${long} x ${short}`).toHaveLength(1);
      expect(r.rings[0].tiles.length).toBeGreaterThanOrEqual(GEO_THRESHOLDS.minEnclosedTiles);
    }
  });

  it('leaves compact shapes alone', () => {
    for (const fixes of [walk(square(200)), walk(square(600)), walk(LOLLIPOP)]) {
      const r = detectLoops(fixes);
      expect(r.rings.length).toBeGreaterThan(0);
      for (const ring of r.rings) {
        const m = ring.ring.map((c): Vec2 => proj.toM(c[1], c[0]));
        expect((2 * ringArea(m)) / ringPerimeter(m)).toBeGreaterThan(
          GEO_THRESHOLDS.minRingWidthCells * tileSideM(ORIGIN.lat),
        );
      }
    }
  });
});

describe('a phone that never moved captures nothing', () => {
  it('a night on the windowsill forms no ring at all', () => {
    // 24 fixes over 12 hours at Life360's 30-minute still cadence, with no
    // accuracy and no mode — both of the gates that would have caught it are
    // inert on the real family corpus. The 25 m jitter collapse drops nothing
    // because consecutive wander steps are further apart than 25 m.
    for (const radius of [90, 200, 400]) {
      const r = detectLoops(stationaryWander(radius));
      expect(r.rings, `${radius} m wander`).toHaveLength(0);
      expect(r.dropped.gap, `${radius} m wander`).toBeGreaterThan(0);
      expect(r.segments.every((seg) => seg.length < 4), `${radius} m wander`).toBe(true);
    }
  });

  it('does not eat a real family walk at the corpus cadence', () => {
    // Life360 polls a MOVING phone every 45-120 s; 30 minutes is the still
    // cadence. A walk sampled every 168 m (two minutes at 1.4 m/s) must pass
    // both stationary gates untouched.
    const r = detectLoops(walk(square(600), { stepM: 168, speedMps: 1.4 }));
    expect(r.dropped.dwell).toBe(0);
    expect(r.dropped.gap).toBe(0);
    expect(r.rings).toHaveLength(1);
  });

  it('a phone wandering slowly inside the observation gap is still dwell', () => {
    // The gap cut does the heavy lifting at 30-minute polling. This is the same
    // phone polled every three minutes: inside the gap, far outside the 25 m
    // jitter radius, and still nowhere near walking pace.
    const slow = stationaryWander(90).map((f, i) => ({
      ...f,
      ts: new Date(Date.UTC(2026, 7, 1, 20, 0, 0) + i * 3 * 60_000),
    }));
    const r = detectLoops(slow);
    expect(r.dropped.gap).toBe(0);
    expect(r.dropped.dwell).toBeGreaterThan(0);
    expect(r.rings).toHaveLength(0);
  });

  it('a self-intersection ring shorter than the closed-path floor is rejected', () => {
    // The endpoint branch has always required 400 m. The self-intersection
    // branch applied no length gate at all, which is the front door a
    // stationary phone walked through.
    const r = detectLoops(walk(LOLLIPOP, { origin: ORIGIN }), { minClosedPathM: 5000 });
    expect(r.rings).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toContain('too-short');
  });
});

describe('cycling is excluded, as Decision 7 says', () => {
  it('a ride does not capture, and the type comes from the workout, not the speed', () => {
    const ride = walk(square(1200), { stepM: 50, speedMps: 15 / 3.6, mode: 'active' }).map(
      (f): GeoFix => ({ ...f, activityType: 'ride' }),
    );
    const r = detectLoops(ride);
    expect(r.rings).toHaveLength(0);
    expect(r.dropped.activityType).toBeGreaterThan(0);
    expect(GEO_THRESHOLDS.excludedActivityTypes).toContain('ride');
    expect(GEO_THRESHOLDS.excludedActivityTypes).toContain('mtb');
  });

  it('a run at the same speed still captures — GPS speed cannot tell them apart', () => {
    const run = walk(square(600), { stepM: 50, speedMps: 15 / 3.6, mode: 'active' }).map(
      (f): GeoFix => ({ ...f, activityType: 'run' }),
    );
    expect(detectLoops(run).rings).toHaveLength(1);
  });
});

describe('trample rasterisation', () => {
  it('paints a continuous line, not a dotted one', () => {
    // 45-120 s sampling puts consecutive fixes several cells apart. Stamping
    // only the fixes' own cells would draw a dashed map.
    const fixes = walk([[0, 0], [500, 0]], { stepM: 120 });
    const t = trampledTiles(fixes, GEO_THRESHOLDS);
    const cells = new Set(t.tiles.map((c) => tileKeyOf(c.x, c.y)));

    // Stamping only the fixes' own cells would give at most one cell per fix.
    const fixCells = new Set(fixes.map((f) => tileKeyOf(tileAt(f.lat, f.lon).x, tileAt(f.lat, f.lon).y)));
    expect(cells.size).toBeGreaterThan(fixCells.size);

    // Unbroken: the run of x columns has no gap in it.
    const xs = [...cells].map((k) => Number(k.split(':')[0])).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(1);
    expect(t.refusedLegs).toBe(0);
  });

  it('refuses to interpolate across a GPS teleport, so it cannot stripe the county', () => {
    const a: GeoFix = { lat: ORIGIN.lat, lon: ORIGIN.lon, ts: new Date('2026-08-01T09:00:00Z') };
    const b: GeoFix = {
      lat: ORIGIN.lat + 0.108, // ~12 km north
      lon: ORIGIN.lon,
      ts: new Date('2026-08-01T09:35:00Z'), // 35 min later: 20.6 km/h implied, UNDER the speed gate
      };
    const t = trampledTiles([a, b], GEO_THRESHOLDS);
    expect(t.refusedLegs).toBe(1);
    // Both endpoints are still stamped; the 12 km between them is not.
    expect(t.tiles).toHaveLength(2);
  });

  it('refuses a leg sampled further apart than maxInterpolationS even when it is short', () => {
    const a: GeoFix = { lat: ORIGIN.lat, lon: ORIGIN.lon, ts: new Date('2026-08-01T09:00:00Z') };
    const b: GeoFix = {
      lat: ORIGIN.lat + 0.0018, // ~200 m, inside maxInterpolationM
      lon: ORIGIN.lon,
      ts: new Date('2026-08-01T09:10:00Z'), // 600 s, outside maxInterpolationS
    };
    expect(trampledTiles([a, b], GEO_THRESHOLDS).refusedLegs).toBe(1);
  });

  it('consumes the two interpolation constants the claim row records', () => {
    const fixes = walk([[0, 0], [500, 0]], { stepM: 120 });
    const tight = trampledTiles(fixes, { ...GEO_THRESHOLDS, maxInterpolationM: 10 });
    expect(tight.refusedLegs).toBeGreaterThan(0);
    expect(tight.tiles.length).toBeLessThan(trampledTiles(fixes, GEO_THRESHOLDS).tiles.length);
  });
});
