// src/lib/geo/weekly.ts
//
// The week Landgrab had, counted — and the plain sentence that reports it.
//
// This is the letter's factual half. Same bargain as the daydream weekly
// digest it is modelled on: the SUMMARY is deterministic, assembled by code
// from counted facts, and a quiet week says so plainly. A model may later
// phrase a narrative, but only over the fact lines below, and the summary
// ships with or without it.
//
// Two halves in one file, and the split is load-bearing:
//
//   • `gatherLandgrabWeek` and the three digest-row functions touch the
//     database. They are the only things here that do, and they do it INSIDE
//     the function body — nothing runs at import time, so a caller (or a test)
//     can import the pure half with `$lib/db` mocked to `{}`.
//   • everything else is pure: phrasing, fact lines, numeric stats and the
//     local-day helpers. Those are what the tests cover.
//
// It deliberately does NOT import `$lib/daydream`: the local-day helpers and
// the row IO are copied from `$lib/daydream/digest/weekly.ts` rather than
// shared, because `$lib/geo` must not depend on `$lib/daydream` (module
// boundary rule; daydream already carries two cycles of its own). `LOCAL_TZ`
// is re-declared here for the same reason.
//
// It also imports nothing from `src/routes` — `resolveContest` and `titleCase`
// both live beside the page, and a library that depends on a page cannot be
// reused or tested without the route tree. The contest fold is six lines and
// is inlined below; `titleCase` is one.

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDigests, geoCaptureEvents, geoClaims } from '$lib/db/schema';
import { findBattlegrounds } from './battlegrounds';
import { utcDay, type TileOwnership } from './ownership';
import { readVisitorSets, resolveFilteredOwnership } from './service';
import { tileAreaM2, tileCentre } from './tiles';

/** The `daydream_digests.subject` this stream writes under. A separate stream
 *  from 'weekly' and from the daily digest, both of which independently write
 *  the same calendar day and must not collide on the (subject, day) key. */
export const LANDGRAB_WEEKLY_SUBJECT = 'landgrab-weekly';

/** The page's DEFAULT_WINDOW, in days, so the letter and the page agree about
 *  who owns what. Duplicated rather than imported: DEFAULT_WINDOW lives in
 *  `src/routes/projects/landgrab/identity.ts` and `$lib` may not reach into
 *  routes. If the page's default moves, move this with it. */
export const WEEKLY_WINDOW_DAYS = 30;

/** Europe/London. Declared here, not imported from `$lib/daydream/types`. */
const LOCAL_TZ = 'Europe/London';

const MS_PER_DAY = 86_400_000;

/** How far back the streak scan reads. Long enough that a streak is never
 *  truncated by the lookback rather than by a missed day. */
const STREAK_LOOKBACK_DAYS = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerWeek {
  subject: string;
  cellsNow: number;
  cellsThen: number;
  gained: number;
  lost: number;
  net: number;
  areaNowM2: number;
  gainedM2: number;
  lostM2: number;
  activeDays: number;
  streak: number;
}

export interface WeekFacts {
  weekEnding: string;
  quiet: boolean;
  players: PlayerWeek[];
  takes: Array<{ from: string; to: string; cells: number; areaM2: number }>;
  biggestClaim: {
    subject: string;
    tiles: number;
    areaM2: number;
    activityType: string | null;
    day: string;
    victims: string[];
  } | null;
  /**
   * The contested board: holds THEN and holds NOW over the cells contested
   * NOW, and `visited` is how many of those cells this person has stood on.
   *
   * All three counts share one universe of cells — the cells with two or more
   * visitors under the CURRENT window. That is what makes `holdsThen/visited`
   * and `holdsNow/visited` two rates you may put either side of an arrow.
   * Counting `holdsThen` over the cells that were contested a week ago instead
   * would put cells in the numerator that are not in the denominator, because
   * the window slides — see the fold in `gatherLandgrabWeek`.
   */
  contested: Array<{ subject: string; holdsNow: number; holdsThen: number; visited: number }>;
  battleground: {
    name: string | null;
    centre: [number, number];
    handovers: number;
    holders: Array<{ subject: string; cells: number }>;
  } | null;
  cellAreaM2: number;
}

// ---------------------------------------------------------------------------
// Local day helpers (copied from $lib/daydream/digest/weekly.ts — see header)
// ---------------------------------------------------------------------------

export function localDayStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isLocalSunday(d: Date): boolean {
  return (
    new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, weekday: 'short' }).format(d) === 'Sun'
  );
}

// ---------------------------------------------------------------------------
// The gather (database half)
// ---------------------------------------------------------------------------

/**
 * Everything the letter is allowed to say, counted off the ledger.
 *
 * `nameFor` is injected rather than imported: naming a battleground is a
 * geocode, and a geocode is the caller's dependency, not this module's.
 */
export async function gatherLandgrabWeek(
  now: Date,
  nameFor?: (centre: [number, number]) => Promise<string | null>,
): Promise<WeekFacts> {
  const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const windowFrom = (asOf: Date) => new Date(asOf.getTime() - WEEKLY_WINDOW_DAYS * MS_PER_DAY);

  // The board's one latitude, read the way `resolveBoard`
  // (`src/routes/projects/landgrab/query.server.ts`) reads it: off the middle
  // of the ledger's own extent. That function is the other writer of this
  // constant, and the two must agree — a hard-coded 54.52 here against a
  // derived centre there put the letter's km2 and the page's km2 a hundredth
  // apart on the same week. 54.52 survives only as the empty-ledger fallback,
  // which is the same fallback `resolveBoard` uses.
  const [extentRow] = await db
    .select({
      minX: sql<number | null>`min(${geoCaptureEvents.tileX})`,
      maxX: sql<number | null>`max(${geoCaptureEvents.tileX})`,
      minY: sql<number | null>`min(${geoCaptureEvents.tileY})`,
      maxY: sql<number | null>`max(${geoCaptureEvents.tileY})`,
    })
    .from(geoCaptureEvents);
  const centreLat =
    extentRow?.minX === null || extentRow?.minX === undefined
      ? 54.52
      : tileCentre(
          Math.round((Number(extentRow.minX) + Number(extentRow.maxX)) / 2),
          Math.round((Number(extentRow.minY) + Number(extentRow.maxY)) / 2),
        ).lat;
  const cellAreaM2 = tileAreaM2(centreLat);

  // Ownership now, and ownership AS AT a week ago — resolved with `now` set to
  // then, never with today's clock. The score decays with age, so "who owned
  // this last Sunday" asked today is a different question from the one last
  // Sunday answered. The window's own lower bound moves back with it, or "a
  // week ago under a 30-day window" would be a window of the wrong width.
  //
  // No `tileRange`: this is the whole ledger. That is the hourly job's scale,
  // not a page load's.
  const ownedNow: Map<string, TileOwnership> = await resolveFilteredOwnership({
    now,
    filter: { capturedFrom: windowFrom(now) },
  });
  const ownedThen: Map<string, TileOwnership> = await resolveFilteredOwnership({
    now: weekAgo,
    filter: { capturedFrom: windowFrom(weekAgo) },
  });
  // Only the NOW visitor set is read. The contest fold below reports both the
  // then and the now holds over these same cells — see the note there — and
  // `findBattlegrounds` takes the current contested clumps too, so a second
  // full-ledger read as at `weekAgo` would be work nothing consumes.
  const visitors = await readVisitorSets({ now, filter: { capturedFrom: windowFrom(now) } });

  const ownerByCell = new Map<string, string>();
  for (const [key, o] of ownedNow) ownerByCell.set(key, o.owner);
  const ownerThenByCell = new Map<string, string>();
  for (const [key, o] of ownedThen) ownerThenByCell.set(key, o.owner);

  // Boards. The (then, now) diff, exactly as the page computes it.
  const cellsNow = new Map<string, number>();
  for (const owner of ownerByCell.values()) cellsNow.set(owner, (cellsNow.get(owner) ?? 0) + 1);
  const cellsThen = new Map<string, number>();
  for (const owner of ownerThenByCell.values()) {
    cellsThen.set(owner, (cellsThen.get(owner) ?? 0) + 1);
  }

  const gained = new Map<string, number>();
  const lost = new Map<string, number>();
  // Keyed on the pair but CARRYING it, rather than joining the two names into
  // a string and splitting it back out: `subject` is free text off the trail
  // ingest, and the day one of them contains a space a split would quietly
  // attribute the take to the wrong pair of people.
  const takeCounts = new Map<string, { from: string; to: string; cells: number }>();
  for (const key of new Set([...ownerByCell.keys(), ...ownerThenByCell.keys()])) {
    const before = ownerThenByCell.get(key) ?? null;
    const after = ownerByCell.get(key) ?? null;
    if (before === after) continue;
    if (after) gained.set(after, (gained.get(after) ?? 0) + 1);
    if (before) lost.set(before, (lost.get(before) ?? 0) + 1);
    // A TAKE is a cell that changed hands between two NAMED people. Virgin
    // ground is a gain and not a take — "took 0.09 km2 off nobody" is noise.
    if (before && after) {
      const pair = `${before}>${after}`;
      const seen = takeCounts.get(pair);
      if (seen) seen.cells += 1;
      else takeCounts.set(pair, { from: before, to: after, cells: 1 });
    }
  }

  const takes = [...takeCounts.values()]
    .map((t) => ({ ...t, areaM2: t.cells * cellAreaM2 }))
    .sort((a, b) => b.cells - a.cells || (a.to < b.to ? -1 : 1))
    .slice(0, 5);

  // Days with at least one capture event. The week's set answers `activeDays`
  // and `quiet`; the 60-day set answers the streak. Two reads rather than one
  // filtered in memory, because `day` is the UTC calendar day and `capturedAt`
  // is the instant — narrowing the wider set by its `day` string would put the
  // week's boundary in a slightly different place from the page's.
  const weekDayRows = await db
    .select({ subject: geoCaptureEvents.subject, day: geoCaptureEvents.day })
    .from(geoCaptureEvents)
    .where(and(gte(geoCaptureEvents.capturedAt, weekAgo), lte(geoCaptureEvents.capturedAt, now)))
    .groupBy(geoCaptureEvents.subject, geoCaptureEvents.day);

  const activeDays = new Map<string, number>();
  for (const r of weekDayRows) activeDays.set(r.subject, (activeDays.get(r.subject) ?? 0) + 1);

  const streakFrom = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * MS_PER_DAY);
  const streakRows = await db
    .select({ subject: geoCaptureEvents.subject, day: geoCaptureEvents.day })
    .from(geoCaptureEvents)
    .where(and(gte(geoCaptureEvents.capturedAt, streakFrom), lte(geoCaptureEvents.capturedAt, now)))
    .groupBy(geoCaptureEvents.subject, geoCaptureEvents.day);

  const daysBySubject = new Map<string, Set<string>>();
  for (const r of streakRows) {
    const set = daysBySubject.get(r.subject);
    if (set) set.add(r.day);
    else daysBySubject.set(r.subject, new Set([r.day]));
  }

  const subjects = [...new Set([...cellsNow.keys(), ...cellsThen.keys()])].sort();
  const players: PlayerWeek[] = subjects
    .map((subject) => {
      const g = gained.get(subject) ?? 0;
      const l = lost.get(subject) ?? 0;
      const held = cellsNow.get(subject) ?? 0;
      return {
        subject,
        cellsNow: held,
        cellsThen: cellsThen.get(subject) ?? 0,
        gained: g,
        lost: l,
        net: g - l,
        areaNowM2: held * cellAreaM2,
        gainedM2: g * cellAreaM2,
        lostM2: l * cellAreaM2,
        activeDays: activeDays.get(subject) ?? 0,
        streak: streakOf(daysBySubject.get(subject) ?? new Set(), now),
      };
    })
    .sort((a, b) => b.cellsNow - a.cellsNow || (a.subject < b.subject ? -1 : 1));

  // The biggest single ring of the week.
  const [claim] = await db
    .select({
      subject: geoClaims.subject,
      tileCount: geoClaims.tileCount,
      activityType: geoClaims.activityType,
      day: geoClaims.day,
      tilesTaken: geoClaims.tilesTaken,
    })
    .from(geoClaims)
    .where(and(gte(geoClaims.capturedAt, weekAgo), lte(geoClaims.capturedAt, now)))
    .orderBy(desc(geoClaims.tileCount))
    .limit(1);

  const biggestClaim = claim
    ? {
        subject: claim.subject,
        tiles: claim.tileCount,
        // Cell count x the board constant, NOT `captured_area_m2`. The claim's
        // own figure is the ring's planar area, which includes ground the ring
        // enclosed but did not win; quoting it beside a board built from cells
        // would put two different numbers on the same week.
        areaM2: claim.tileCount * cellAreaM2,
        activityType: claim.activityType,
        day: claim.day,
        victims: Object.entries((claim.tilesTaken ?? {}) as Record<string, number>)
          .filter(([, n]) => (Number(n) || 0) > 0)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .map(([subject]) => subject),
      }
    : null;

  // The contest fold — the six lines from `resolveContest`, inlined because
  // that module lives beside the page. Contested ground is the only ground
  // that is actually a game: 91% of the map has one visitor and no scoring
  // rule can move it, so a board ranked on total area ranks how far somebody
  // roams. `visited` counts CONTESTED cells this person has stood on.
  //
  // ONE UNIVERSE OF CELLS, and it is the NOW-contested one. Both `holdsNow`
  // and `holdsThen` are folded over the same `visitors` set and both are
  // reported against the same `visited` denominator, so the "was 52%, now 58%"
  // sentence compares like with like.
  //
  // Folding `holdsThen` over `visitorsThen` instead — the obvious spelling,
  // and what this did first — is wrong because the 30-day window SLIDES: a
  // cell that two people had both visited under the earlier window can have
  // one visitor under the current one. Those cells are in the numerator and
  // not in the denominator, so the "was" figure is inflated, and in the limit
  // it prints a rate above 100%.
  const holdsNow = new Map<string, number>();
  const holdsThen = new Map<string, number>();
  const visited = new Map<string, number>();
  for (const [key, set] of visitors) {
    if (set.size < 2) continue;
    const owner = ownerByCell.get(key);
    if (owner) holdsNow.set(owner, (holdsNow.get(owner) ?? 0) + 1);
    const then = ownerThenByCell.get(key);
    if (then) holdsThen.set(then, (holdsThen.get(then) ?? 0) + 1);
    for (const s of set) visited.set(s, (visited.get(s) ?? 0) + 1);
  }
  const contested = [...new Set([...visited.keys(), ...holdsNow.keys(), ...holdsThen.keys()])]
    .map((subject) => ({
      subject,
      holdsNow: holdsNow.get(subject) ?? 0,
      holdsThen: holdsThen.get(subject) ?? 0,
      visited: visited.get(subject) ?? 0,
    }))
    .sort((a, b) => b.holdsNow - a.holdsNow || (a.subject < b.subject ? -1 : 1));

  // The clump that changed hands most. Ranked by handovers, then cells.
  const [top] = findBattlegrounds({ visitors, ownerByCell, ownerThenByCell });
  const battleground = top
    ? {
        name: nameFor ? await nameFor(top.centre).catch(() => null) : null,
        centre: top.centre,
        handovers: top.handovers,
        holders: top.holders,
      }
    : null;

  return {
    weekEnding: localDayStr(now),
    quiet: weekDayRows.length === 0,
    players,
    takes,
    biggestClaim,
    contested,
    battleground,
    cellAreaM2,
  };
}

/**
 * Consecutive UTC days with at least one capture event, ending today or
 * yesterday.
 *
 * Yesterday counts because the day is not over: a run at 21:00 last night and
 * nothing yet this morning is still a live streak, and breaking it at midnight
 * would make the number depend on the hour the letter happened to be written.
 */
function streakOf(days: Set<string>, now: Date): number {
  const today = utcDay(now);
  const yesterday = utcDay(new Date(now.getTime() - MS_PER_DAY));
  const start = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (!start) return 0;
  let at = new Date(`${start}T00:00:00.000Z`);
  let run = 0;
  while (days.has(utcDay(at))) {
    run += 1;
    at = new Date(at.getTime() - MS_PER_DAY);
  }
  return run;
}

// ---------------------------------------------------------------------------
// Phrasing (PURE)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Sun 13 Sep" from "2026-09-13".
 *
 * NOT `Intl.DateTimeFormat('en-GB', { month: 'short' })`, which is the obvious
 * spelling and is not stable: CLDR 42 changed en-GB's abbreviated September
 * from "Sep" to "Sept", so the same code prints a different string depending
 * on the ICU built into the running Node — measured here, Node prints
 * "Tue 8 Sept". A letter that reads "Sept" on the VPS and "Sep" in CI is a
 * diff nobody can explain. The two tables are three lines and cannot drift.
 */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const titleCase = (subject: string): string =>
  subject.length ? subject.charAt(0).toUpperCase() + subject.slice(1) : subject;

const km2 = (m2: number): string => (m2 / 1e6).toFixed(2);

/** "+0.22" / "−0.30". A true minus sign, not a hyphen: the letter is
 *  prose, and a hyphen against a digit reads as a range. */
const signedKm2 = (m2: number): string => `${m2 < 0 ? '−' : '+'}${km2(Math.abs(m2))}`;

const signedInt = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

const pct = (part: number, whole: number): number => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * PURE. The deterministic summary — true with or without a model.
 *
 * A quiet week says so in one sentence rather than printing a table of zeroes:
 * a letter that only reads as a letter when there is news cannot be trusted
 * when it is silent.
 */
export function phraseLandgrabWeek(f: WeekFacts): string {
  const opening = `Week to ${dayLabel(f.weekEnding)}.`;
  if (f.quiet) return `${opening} Nobody captured any ground. The map is as it was.`;

  const byNet = [...f.players].sort((a, b) => b.net - a.net || (a.subject < b.subject ? -1 : 1));
  const sentences: string[] = [opening];

  const movers = byNet.filter((p) => p.gained > 0 || p.lost > 0);
  if (movers.length) {
    sentences.push(
      `${movers
        .map((p) => {
          const took = f.takes
            .filter((t) => t.to === p.subject)
            .map((t) => `took ${km2(t.areaM2)} km² off ${titleCase(t.from)}`);
          const head = `${titleCase(p.subject)} ${signedKm2(p.net * f.cellAreaM2)} km²`;
          return took.length ? `${head} (${took.join(' and ')})` : head;
        })
        .join(', ')}.`,
    );
  }

  if (f.biggestClaim) {
    const c = f.biggestClaim;
    const how = c.activityType ? ` by ${c.activityType}` : '';
    sentences.push(
      `Biggest claim: ${titleCase(c.subject)}, ${km2(c.areaM2)} km²${how} on ${dayLabel(c.day)}.`,
    );
  }

  // Only the people whose share of contested ground actually moved. A rate
  // quoted unchanged is a number the reader has to check to learn nothing.
  const order = new Map(byNet.map((p, i) => [p.subject, i]));
  const shifted = f.contested
    .filter((c) => pct(c.holdsNow, c.visited) !== pct(c.holdsThen, c.visited))
    .sort((a, b) => (order.get(a.subject) ?? 999) - (order.get(b.subject) ?? 999));
  if (shifted.length) {
    sentences.push(
      `Contested ground: ${shifted
        .map(
          (c) =>
            `${titleCase(c.subject)} ${pct(c.holdsThen, c.visited)}% → ${pct(c.holdsNow, c.visited)}%`,
        )
        .join(', ')}.`,
    );
  }

  if (f.battleground && f.battleground.handovers > 0) {
    const b = f.battleground;
    const where = b.name ?? `${b.centre[0].toFixed(4)}, ${b.centre[1].toFixed(4)}`;
    sentences.push(
      `Battleground of the week: ${where}, ${b.handovers} cell${
        b.handovers === 1 ? '' : 's'
      } changed hands.`,
    );
  }

  // One streak, the longest, and only when it is long enough to be one.
  const best = byNet.filter((p) => p.streak >= 3).sort((a, b) => b.streak - a.streak)[0];
  if (best) sentences.push(`Streak: ${titleCase(best.subject)} ${best.streak} days.`);

  return sentences.join(' ');
}

/** PURE. The facts block a narrative may draw on — and nothing else. */
export function weekFactLines(f: WeekFacts): string[] {
  const lines = [`Week ending ${f.weekEnding}.`];
  if (f.quiet) lines.push('No capture events at all this week.');
  for (const p of f.players) {
    lines.push(
      `${p.subject}: holds ${p.cellsNow} cells (${km2(p.areaNowM2)} km²), ` +
        `gained ${p.gained}, lost ${p.lost}, net ${signedInt(p.net)}, ` +
        `active ${p.activeDays} days, streak ${p.streak}`,
    );
  }
  for (const t of f.takes) {
    lines.push(`take: ${t.to} took ${t.cells} cells (${km2(t.areaM2)} km²) off ${t.from}`);
  }
  if (f.biggestClaim) {
    const c = f.biggestClaim;
    lines.push(
      `biggest claim: ${c.subject}, ${c.tiles} cells (${km2(c.areaM2)} km²) by ` +
        `${c.activityType ?? 'untyped'} on ${c.day}, taken from ${c.victims.join(', ') || 'nobody'}`,
    );
  }
  for (const c of f.contested) {
    lines.push(
      `contested: ${c.subject} holds ${c.holdsNow} of the ${c.visited} contested cells ` +
        `they have stood on (was ${c.holdsThen})`,
    );
  }
  if (f.battleground) {
    const b = f.battleground;
    lines.push(
      `battleground: ${b.name ?? `${b.centre[0].toFixed(4)}, ${b.centre[1].toFixed(4)}`}, ` +
        `${b.handovers} cells changed hands, held by ` +
        `${b.holders.map((h) => `${h.subject} ${h.cells}`).join(', ') || 'nobody'}`,
    );
  }
  lines.push(`One cell is ${Math.round(f.cellAreaM2)} m².`);
  return lines;
}

/** The digests `stats` column is numbers-only by type; strings live in the
 *  summary. Keyed `<subject>.<measure>` so a chart can pick a player out. */
export function numericStats(f: WeekFacts): Record<string, number> {
  const stats: Record<string, number> = {
    quiet: f.quiet ? 1 : 0,
    players: f.players.length,
    takes: f.takes.length,
    cellAreaM2: f.cellAreaM2,
  };
  for (const p of f.players) {
    stats[`${p.subject}.cellsNow`] = p.cellsNow;
    stats[`${p.subject}.cellsThen`] = p.cellsThen;
    stats[`${p.subject}.gained`] = p.gained;
    stats[`${p.subject}.lost`] = p.lost;
    stats[`${p.subject}.net`] = p.net;
    stats[`${p.subject}.areaNowM2`] = p.areaNowM2;
    stats[`${p.subject}.activeDays`] = p.activeDays;
    stats[`${p.subject}.streak`] = p.streak;
  }
  for (const c of f.contested) {
    stats[`${c.subject}.contestedHolds`] = c.holdsNow;
    stats[`${c.subject}.contestedHoldsThen`] = c.holdsThen;
    stats[`${c.subject}.contestedVisited`] = c.visited;
  }
  if (f.biggestClaim) stats['biggestClaim.tiles'] = f.biggestClaim.tiles;
  if (f.battleground) {
    stats['battleground.handovers'] = f.battleground.handovers;
    stats['battleground.cells'] = f.battleground.holders.reduce((n, h) => n + h.cells, 0);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Row IO — daydream_digests under LANDGRAB_WEEKLY_SUBJECT
// ---------------------------------------------------------------------------

export async function landgrabWeeklyExists(day: string): Promise<boolean> {
  const [row] = await db
    .select({ id: daydreamDigests.id })
    .from(daydreamDigests)
    .where(and(eq(daydreamDigests.subject, LANDGRAB_WEEKLY_SUBJECT), eq(daydreamDigests.day, day)))
    .limit(1);
  return row != null;
}

export async function saveLandgrabWeekly(
  day: string,
  summary: string,
  narrative: string | null,
  verified: boolean | null,
  stats: Record<string, number>,
): Promise<void> {
  await db
    .insert(daydreamDigests)
    .values({ subject: LANDGRAB_WEEKLY_SUBJECT, day, summary, narrative, verified, stats })
    .onConflictDoUpdate({
      target: [daydreamDigests.subject, daydreamDigests.day],
      set: { summary, narrative, verified, stats },
    });
}

/** The most recent letter, for the page's "last week's letter" panel. */
export async function latestLandgrabWeekly(): Promise<{
  weekEnding: string;
  summary: string;
  narrative: string | null;
  verified: boolean | null;
} | null> {
  const [row] = await db
    .select({
      day: daydreamDigests.day,
      summary: daydreamDigests.summary,
      narrative: daydreamDigests.narrative,
      verified: daydreamDigests.verified,
    })
    .from(daydreamDigests)
    .where(eq(daydreamDigests.subject, LANDGRAB_WEEKLY_SUBJECT))
    .orderBy(desc(daydreamDigests.day))
    .limit(1);
  if (!row) return null;
  return {
    weekEnding: String(row.day),
    summary: row.summary,
    narrative: row.narrative,
    verified: row.verified,
  };
}
