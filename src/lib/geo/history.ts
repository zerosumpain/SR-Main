// A region's past, from the ledger alone.
//
// Pure. Takes the events on a set of cells and returns what the drill draws:
// cells held per player at every day something changed hands, the handovers
// themselves, and a battle row per player. Ownership can only change at an
// event (decay preserves ratios), so `ownershipTimeline` is the whole story
// and this is O(events).

import { dedupeEvents, ownershipTimeline, utcDay, type CaptureEvent } from './ownership';
import { tileKeyOf } from './tiles';

export interface TimelinePoint {
  /** UTC day. */
  day: string;
  /** Cells held over the region, by subject. */
  cells: Record<string, number>;
}

export interface FlipLine {
  day: string;
  /** null — taken from open ground. */
  from: string | null;
  to: string;
  cells: number;
}

export interface BattleRow {
  subject: string;
  events: number;
  loops: number;
  tramples: number;
  fills: number;
  activeDays: number;
  cellsNow: number;
  cellsPeak: number;
  /** Cells taken off somebody (never from open ground). */
  took: number;
  lost: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface RegionHistoryCore {
  timeline: TimelinePoint[];
  flips: FlipLine[];
  battle: BattleRow[];
  handovers: number;
}

export function regionHistory(
  events: CaptureEvent[],
  cells: ReadonlySet<string>,
  now: Date,
): RegionHistoryCore {
  // DEDUPED, because a battle row's `events` count has to agree with the
  // ledger's own (subject, cell, day, kind) uniqueness — ten laps of the same
  // loop in one afternoon are one event, here as everywhere else.
  const inRegion = dedupeEvents(events).filter((e) => cells.has(tileKeyOf(e.tileX, e.tileY)));
  if (!inRegion.length) return { timeline: [], flips: [], battle: [], handovers: 0 };

  const flips = ownershipTimeline(inRegion, now);

  // Cells held, replayed flip by flip; one point per day that had a flip.
  const held = new Map<string, number>();
  const peak = new Map<string, number>();
  const took = new Map<string, number>();
  const lost = new Map<string, number>();
  const timeline: TimelinePoint[] = [];
  const perDay = new Map<string, Map<string, FlipLine>>();
  let handovers = 0;

  const snapshot = (day: string) => {
    const cellsNow: Record<string, number> = {};
    for (const [s, n] of held) if (n > 0) cellsNow[s] = n;
    timeline.push({ day, cells: cellsNow });
  };

  let currentDay: string | null = null;
  for (const f of flips) {
    if (currentDay !== null && f.day !== currentDay) snapshot(currentDay);
    currentDay = f.day;
    if (f.from) {
      held.set(f.from, (held.get(f.from) ?? 0) - 1);
      lost.set(f.from, (lost.get(f.from) ?? 0) + 1);
      took.set(f.to, (took.get(f.to) ?? 0) + 1);
      handovers += 1;
    }
    held.set(f.to, (held.get(f.to) ?? 0) + 1);
    peak.set(f.to, Math.max(peak.get(f.to) ?? 0, held.get(f.to) ?? 0));
    const pairKey = `${f.from ?? ''}>${f.to}`;
    const day = perDay.get(f.day) ?? new Map<string, FlipLine>();
    const line = day.get(pairKey) ?? { day: f.day, from: f.from, to: f.to, cells: 0 };
    line.cells += 1;
    day.set(pairKey, line);
    perDay.set(f.day, day);
  }
  if (currentDay !== null) snapshot(currentDay);
  const horizon = utcDay(now);
  if (timeline.length && timeline[timeline.length - 1].day !== horizon) snapshot(horizon);

  const flipLines: FlipLine[] = [];
  for (const day of [...perDay.keys()].sort()) {
    for (const line of perDay.get(day)!.values()) flipLines.push(line);
  }

  // Battle rows from the deduped events themselves.
  const rows = new Map<string, BattleRow & { days: Set<string>; first: number; last: number }>();
  for (const e of inRegion.filter((e) => e.capturedAt.getTime() <= now.getTime())) {
    const r = rows.get(e.subject) ?? {
      subject: e.subject,
      events: 0,
      loops: 0,
      tramples: 0,
      fills: 0,
      activeDays: 0,
      cellsNow: 0,
      cellsPeak: 0,
      took: 0,
      lost: 0,
      firstAt: null,
      lastAt: null,
      days: new Set<string>(),
      first: Infinity,
      last: -Infinity,
    };
    r.events += 1;
    if (e.kind === 'loop') r.loops += 1;
    else if (e.kind === 'trample') r.tramples += 1;
    else r.fills += 1;
    r.days.add(e.day);
    const t = e.capturedAt.getTime();
    r.first = Math.min(r.first, t);
    r.last = Math.max(r.last, t);
    rows.set(e.subject, r);
  }
  const battle: BattleRow[] = [...rows.values()]
    .map(({ days, first, last, ...r }) => ({
      ...r,
      activeDays: days.size,
      cellsNow: held.get(r.subject) ?? 0,
      cellsPeak: peak.get(r.subject) ?? 0,
      took: took.get(r.subject) ?? 0,
      lost: lost.get(r.subject) ?? 0,
      firstAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
      lastAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
    }))
    .sort(
      (a, b) => b.cellsNow - a.cellsNow || b.events - a.events || (a.subject < b.subject ? -1 : 1),
    );

  return { timeline, flips: flipLines, battle, handovers };
}
