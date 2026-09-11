import { describe, it, expect } from 'vitest';
import {
  DECAY_TAU_DAYS,
  LOOP_WEIGHT,
  OUTING_ALPHA,
  TRAMPLE_WEIGHT,
  applyOutingWeights,
  captureEvents,
  decayFactor,
  dedupeEvents,
  resolveOwnership,
  utcDay,
  type CaptureEvent,
} from './ownership';
import { detectLoops } from './loops';
import { tileKeyOf } from './tiles';
import { square, walk } from './test-fixtures';

const NOW = new Date('2026-08-29T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ev = (
  subject: string,
  x: number,
  y: number,
  at: Date,
  weight = LOOP_WEIGHT,
  kind: 'loop' | 'trample' = 'loop',
): CaptureEvent => ({
  subject,
  tileX: x,
  tileY: y,
  day: utcDay(at),
  kind,
  weight,
  capturedAt: at,
});

describe('decay', () => {
  it('uses a 30-day half-life expressed as tau = 43.3 days', () => {
    expect(DECAY_TAU_DAYS).toBeCloseTo(43.3, 6);
    expect(decayFactor(0)).toBeCloseTo(1, 6);
    expect(decayFactor(7)).toBeCloseTo(0.85, 2);
    expect(decayFactor(30)).toBeCloseTo(0.5, 2);
    expect(decayFactor(120)).toBeCloseTo(0.06, 2);
  });

  it('never returns a negative age boost for a future event', () => {
    expect(decayFactor(-5)).toBe(1);
  });

  it('weights loops above tramples', () => {
    expect(LOOP_WEIGHT).toBe(3);
    expect(TRAMPLE_WEIGHT).toBe(1);
  });
});

describe('dedupe — one qualifying event per (person, tile, day, kind)', () => {
  it('ten laps of the same garden loop in one day score once', () => {
    const laps: CaptureEvent[] = [];
    for (let lap = 0; lap < 10; lap++) {
      for (const t of [
        { x: 10, y: 20 },
        { x: 11, y: 20 },
      ]) {
        laps.push(ev('john', t.x, t.y, new Date(NOW.getTime() - lap * 600_000)));
      }
    }
    const deduped = dedupeEvents(laps);
    expect(deduped).toHaveLength(2);

    const owned = resolveOwnership(laps, NOW);
    const tile = owned.get(tileKeyOf(10, 20))!;
    expect(tile.owner).toBe('john');

    // Exactly the score of the FIRST lap alone — not ten times it, and not the
    // last lap's slightly fresher one. The first is what an append-only ledger
    // inserting ON CONFLICT DO NOTHING would have kept.
    const firstLapOnly = resolveOwnership([laps[laps.length - 2]], NOW);
    expect(tile.score).toBeCloseTo(firstLapOnly.get(tileKeyOf(10, 20))!.score, 12);
    expect(tile.score).toBeLessThan(LOOP_WEIGHT);
    expect(tile.score).toBeGreaterThan(LOOP_WEIGHT * 0.99);
  });

  it('keeps the highest weight when a day holds both a loop and a trample', () => {
    const deduped = dedupeEvents([
      ev('john', 1, 1, daysAgo(0), TRAMPLE_WEIGHT, 'trample'),
      ev('john', 1, 1, daysAgo(0), LOOP_WEIGHT, 'loop'),
    ]);
    // Different kinds are different rows — the uniqueness key includes kind.
    expect(deduped).toHaveLength(2);
    expect(deduped.map((d) => d.weight).sort()).toEqual([1, 3]);
  });

  it('a second day is a second event', () => {
    const deduped = dedupeEvents([
      ev('john', 1, 1, daysAgo(0)),
      ev('john', 1, 1, daysAgo(1)),
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe('resolveOwnership', () => {
  it('argmax of the decayed score wins the tile', () => {
    const owned = resolveOwnership(
      [
        ev('john', 5, 5, daysAgo(40)),
        ev('katie', 5, 5, daysAgo(2)),
      ],
      NOW,
    );
    expect(owned.get(tileKeyOf(5, 5))!.owner).toBe('katie');
  });

  it('breaks a tie on the most recent event', () => {
    const owned = resolveOwnership(
      [ev('john', 5, 5, daysAgo(10)), ev('rory', 5, 5, daysAgo(3)), ev('katie', 5, 5, daysAgo(2))],
      NOW,
    );
    expect(owned.get(tileKeyOf(5, 5))!.owner).toBe('katie');
  });

  it('is deterministic when two people are exactly level', () => {
    // Same weight, same instant: the answer must not depend on row order.
    const at = daysAgo(3);
    const a = resolveOwnership([ev('rory', 5, 5, at), ev('katie', 5, 5, at)], NOW);
    const b = resolveOwnership([ev('katie', 5, 5, at), ev('rory', 5, 5, at)], NOW);
    expect(a.get(tileKeyOf(5, 5))!.owner).toBe(b.get(tileKeyOf(5, 5))!.owner);
  });

  it('records owner_since as the moment ownership actually changed', () => {
    const taken = daysAgo(10);
    const owned = resolveOwnership(
      [ev('john', 5, 5, daysAgo(30)), ev('katie', 5, 5, taken)],
      NOW,
    );
    const t = owned.get(tileKeyOf(5, 5))!;
    expect(t.owner).toBe('katie');
    expect(t.ownerSince.getTime()).toBe(taken.getTime());
  });

  it('decay never self-flips ownership without a new visit', () => {
    const events = [
      ev('john', 5, 5, daysAgo(40)),
      ev('katie', 5, 5, daysAgo(2)),
      ev('john', 6, 5, daysAgo(1)),
      ev('katie', 6, 5, daysAgo(3)),
      ev('john', 7, 5, daysAgo(200), LOOP_WEIGHT),
      ev('katie', 7, 5, daysAgo(199), TRAMPLE_WEIGHT),
    ];
    const at = (d: Date) =>
      [...resolveOwnership(events, d).entries()]
        .map(([k, v]) => `${k}=${v.owner}`)
        .sort()
        .join(',');

    const base = at(NOW);
    expect(at(new Date(NOW.getTime() + 180 * 86_400_000))).toBe(base);
    expect(at(new Date(NOW.getTime() + 730 * 86_400_000))).toBe(base);
    expect(at(new Date(NOW.getTime() + 3650 * 86_400_000))).toBe(base);
  });

  it('scores are still shrinking even though ownership holds', () => {
    const events = [ev('john', 5, 5, daysAgo(0))];
    const soon = resolveOwnership(events, NOW).get(tileKeyOf(5, 5))!.score;
    const later = resolveOwnership(
      events,
      new Date(NOW.getTime() + 90 * 86_400_000),
    ).get(tileKeyOf(5, 5))!.score;
    expect(later).toBeLessThan(soon / 5);
  });
});

describe('nesting — the hard part of the brief', () => {
  it('only the inner tiles flip to katie', () => {
    const johnRing = detectLoops(walk(square(600))).rings[0];
    const katieRing = detectLoops(walk(square(150, [200, 200]))).rings[0];
    expect(johnRing).toBeDefined();
    expect(katieRing).toBeDefined();

    const johnTiles = new Set(johnRing.tiles.map((t) => tileKeyOf(t.x, t.y)));
    const katieTiles = katieRing.tiles.map((t) => tileKeyOf(t.x, t.y));
    expect(katieTiles.length).toBeGreaterThanOrEqual(2);
    // Katie's block walk is genuinely inside John's big loop.
    expect(katieTiles.every((k) => johnTiles.has(k))).toBe(true);
    expect(katieTiles.length).toBeLessThan(johnTiles.size / 4);

    const events: CaptureEvent[] = [
      ...captureEvents('john', johnRing.tiles, daysAgo(30)),
      ...[2, 4, 6, 8, 10].flatMap((d) =>
        captureEvents('katie', katieRing.tiles, daysAgo(d)),
      ),
    ];

    const owned = resolveOwnership(events, NOW);
    for (const k of katieTiles) expect(owned.get(k)!.owner).toBe('katie');
    for (const k of johnTiles) {
      if (!katieTiles.includes(k)) expect(owned.get(k)!.owner).toBe('john');
    }

    const byOwner = new Map<string, number>();
    for (const t of owned.values()) byOwner.set(t.owner, (byOwner.get(t.owner) ?? 0) + 1);
    expect(byOwner.get('katie')).toBe(katieTiles.length);
    expect(byOwner.get('john')).toBe(johnTiles.size - katieTiles.length);
  });
});

// ---------------------------------------------------------------------------
// As-of queries. `geo_daily_snapshot` exists precisely so the weekly board
// never replays a decayed ledger, which means reconstructing "who owned what
// last Sunday" over a ledger holding later events. And a Life360/HA fix carries
// the DEVICE clock, so one family phone a minute fast stamps an event in the
// future. Both used to throw, and the throw escaped the whole tile loop.
// ---------------------------------------------------------------------------

describe('resolveOwnership bounded by `now`', () => {
  it('an as-of query earlier than every event returns an empty map, not a crash', () => {
    const events = captureEvents('john', [{ x: 1, y: 1 }], new Date('2026-08-20T10:00:00Z'));
    expect(() => resolveOwnership(events, new Date('2026-08-10T00:00:00Z'))).not.toThrow();
    expect(resolveOwnership(events, new Date('2026-08-10T00:00:00Z')).size).toBe(0);
  });

  it('one clock-skewed fix does not abort ownership for every other tile', () => {
    const owned = resolveOwnership(
      [
        ev('katie', 5, 5, daysAgo(2)),
        // A phone 60 seconds fast, alone on its own tile.
        ev('john', 9, 9, new Date(NOW.getTime() + 60_000)),
      ],
      NOW,
    );
    expect(owned.get(tileKeyOf(5, 5))!.owner).toBe('katie');
    expect(owned.has(tileKeyOf(9, 9))).toBe(false);
  });

  it('owner_since can never post-date the moment being asked about', () => {
    // Katie owns it at `now`; john's event is in the future. The replay used to
    // run past `now`, hand back katie as owner and 2027 as owner_since — a
    // negative hold on the longest-held board.
    const owned = resolveOwnership(
      [
        ev('katie', 1, 1, new Date('2026-08-20T10:00:00Z')),
        ev('john', 1, 1, new Date('2027-01-01T10:00:00Z')),
      ],
      NOW,
    );
    const t = owned.get(tileKeyOf(1, 1))!;
    expect(t.owner).toBe('katie');
    expect(t.ownerSince.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(t.lastEventAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it('a historical as-of reports the state as it was, with no clock skew needed', () => {
    const day1 = daysAgo(20);
    const day10 = daysAgo(10);
    const events = [ev('katie', 2, 2, day1), ev('john', 2, 2, day10)];

    const asOfDay5 = resolveOwnership(events, daysAgo(15)).get(tileKeyOf(2, 2))!;
    expect(asOfDay5.owner).toBe('katie');
    expect(asOfDay5.ownerSince.getTime()).toBe(day1.getTime());
    expect(asOfDay5.lastEventAt.getTime()).toBe(day1.getTime());

    const asOfNow = resolveOwnership(events, NOW).get(tileKeyOf(2, 2))!;
    expect(asOfNow.owner).toBe('john');
    expect(asOfNow.ownerSince.getTime()).toBe(day10.getTime());
  });
});

// ---------------------------------------------------------------------------
// Per-outing weighting
// ---------------------------------------------------------------------------

describe('applyOutingWeights', () => {
  const at = new Date('2026-09-01T09:00:00Z');
  const ev = (subject: string, sourceRef: string, x: number, kind: 'loop' | 'trample') => ({
    ...captureEvents(subject, [{ x, y: 0 }], at, kind)[0],
    sourceRef,
  });

  it('divides an outing by its own size, not by the whole run', () => {
    const rows = [
      ...[0, 1, 2, 3].map((x) => ev('katie', 'walk-1', x, 'trample')),
      ...[0, 1].map((x) => ev('john', 'run-1', x, 'trample')),
    ];
    applyOutingWeights(rows);
    for (const r of rows.filter((r) => r.subject === 'katie')) expect(r.weight).toBe(1 / 4);
    for (const r of rows.filter((r) => r.subject === 'john')) expect(r.weight).toBe(1 / 2);
  });

  it('makes one outing worth one claim however far it went', () => {
    const short = [0, 1].map((x) => ev('katie', 'walk-1', x, 'trample'));
    const long = Array.from({ length: 200 }, (_, x) => ev('john', 'run-1', x, 'trample'));
    applyOutingWeights(short);
    applyOutingWeights(long);
    const total = (rows: { weight: number }[]) => rows.reduce((a, r) => a + r.weight, 0);
    // This is the property the whole change exists for: the runner's 200-cell
    // outing no longer out-claims the walker's two-cell one 100 to 1.
    expect(total(short)).toBeCloseTo(total(long), 10);
  });

  it('keeps the loop bonus — enclosing still beats crossing, within an outing', () => {
    const rows = [ev('john', 'run-1', 0, 'loop'), ev('john', 'run-1', 1, 'trample')];
    applyOutingWeights(rows);
    expect(rows[0].weight / rows[1].weight).toBe(LOOP_WEIGHT / TRAMPLE_WEIGHT);
  });

  it('separates outings by subject as well as by reference', () => {
    // Two people's journeys can carry the same source ref — a shared trail id —
    // and pooling them would halve both.
    const rows = [ev('katie', 'trail-9', 0, 'trample'), ev('john', 'trail-9', 1, 'trample')];
    applyOutingWeights(rows);
    for (const r of rows) expect(r.weight).toBe(TRAMPLE_WEIGHT);
  });

  it('mutates in place, because the ingest holds these rows in several lists', () => {
    const rows = [0, 1].map((x) => ev('katie', 'walk-1', x, 'trample'));
    const alias = rows[0];
    const returned = applyOutingWeights(rows);
    expect(returned).toBe(rows);
    expect(alias.weight).toBe(1 / 2);
  });

  it('is a no-op at alpha 0, which is the pre-2026-09-11 scheme', () => {
    const rows = [0, 1, 2].map((x) => ev('katie', 'walk-1', x, 'trample'));
    applyOutingWeights(rows, 0);
    for (const r of rows) expect(r.weight).toBe(TRAMPLE_WEIGHT);
  });

  it('ships at alpha 1 — one outing, one claim', () => {
    expect(OUTING_ALPHA).toBe(1);
  });

  it('leaves a single-event outing alone', () => {
    const rows = [ev('rory', 'walk-1', 0, 'loop')];
    applyOutingWeights(rows);
    expect(rows[0].weight).toBe(LOOP_WEIGHT);
  });
});

describe('per-outing weighting, end to end through resolveOwnership', () => {
  it('hands a cell to the short-circuit walker over the long-run regular', () => {
    // The household's complaint in miniature, and deliberately stacked AGAINST
    // the answer: John crosses the cell on FOUR separate days, Katie on three.
    // He is there more often. But his outings paint a hundred cells each and
    // hers paint six, so one outing's claim spread over a hundred cells is
    // thinner on any one of them than the same claim spread over six.
    const cell = { x: 10, y: 10 };
    const rows: (CaptureEvent & { sourceRef: string })[] = [];
    const outing = (
      subject: string,
      ref: string,
      daysAgo: number,
      size: number,
      offset: number,
    ) => {
      const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
      const rowsOut = Array.from({ length: size }, (_, i) => ({
        ...captureEvents(subject, [i === 0 ? cell : { x: offset + i, y: 0 }], at, 'trample')[0],
        sourceRef: ref,
      }));
      applyOutingWeights(rowsOut);
      rows.push(...rowsOut);
    };
    for (const d of [1, 4, 8, 12]) outing('john', `run-${d}`, d, 100, 1000 + d * 200);
    for (const d of [2, 6, 9]) outing('katie', `walk-${d}`, d, 6, 100 + d * 20);

    expect(resolveOwnership(rows, NOW).get(tileKeyOf(cell.x, cell.y))?.owner).toBe('katie');

    // Under the old constant weights the same evidence gave it to John, purely
    // on the extra outing — which is the ranking this change exists to undo.
    const flat = rows.map((r) => ({ ...r, weight: TRAMPLE_WEIGHT }));
    expect(resolveOwnership(flat, NOW).get(tileKeyOf(cell.x, cell.y))?.owner).toBe('john');
  });
});
