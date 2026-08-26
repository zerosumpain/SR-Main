// src/lib/daydream/digest/build.ts
//
// One card a morning, covering the quiet parts.
//
// The problem this solves is structural, not cosmetic. `budget.ts` already
// declares that spare budget buys thinking rather than talking, but that could
// not be true while the only route to the owner was an interruption capped at
// four a day: raising thinking volume fifty-fold just produced fifty times more
// rows nobody read.
//
// A digest is somewhere quiet output can land. Two rules follow from that:
//
//   IT REPORTS THE NOTHING. A morning that says "18 tests, nothing survived,
//   three questions still short of data" is honest and useful. A digest that
//   only appears when there is news cannot be trusted when it is silent —
//   absence stops meaning anything.
//
//   THE SUMMARY IS DETERMINISTIC. It is assembled from counts, always present,
//   and a model may only rephrase it. If the model path failed permanently the
//   digest would still be readable, which is the same rule compose.ts follows.

import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamDayFeatures,
  daydreamDigests,
  daydreamHypotheses,
  daydreamPlaces,
  daydreamThoughts,
} from '$lib/db/schema';
import { DEFAULT_SUBJECT, LOCAL_TZ, errMsg } from '../types';

export interface DigestStats {
  questionsAsked: number;
  questionsAnswered: number;
  held: number;
  refuted: number;
  backwards: number;
  underpowered: number;
  thoughtsRaised: number;
  thoughtsDelivered: number;
  placesNamed: number;
  placesWaiting: number;
  daysOfData: number;
}

export interface BuiltDigest {
  day: string;
  summary: string;
  stats: DigestStats;
}

/** The local day a digest covers — yesterday, by default. */
export function digestDay(now: Date, offsetDays = 1, tz = LOCAL_TZ): string {
  const d = new Date(now.getTime() - offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Assemble the counts for one day.
 *
 * Every number here is a count of rows, not an estimate, because the digest's
 * whole claim on the owner's attention is that it is an accurate account of
 * what happened rather than an impression of it.
 */
export async function gatherStats(
  day: string,
  subject = DEFAULT_SUBJECT,
): Promise<DigestStats> {
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(from.getTime() + 86_400_000);

  const count = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;

  const [
    questionsAsked,
    questionsAnswered,
    held,
    refuted,
    backwards,
    underpowered,
    thoughtsRaised,
    thoughtsDelivered,
    placesNamed,
    placesWaiting,
    daysOfData,
  ] = await Promise.all([
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamHypotheses)
        .where(and(gte(daydreamHypotheses.proposedAt, from), lt(daydreamHypotheses.proposedAt, to))),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamHypotheses)
        .where(and(gte(daydreamHypotheses.testedAt, from), lt(daydreamHypotheses.testedAt, to))),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamHypotheses)
        .where(eq(daydreamHypotheses.verdict, 'supported')),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamHypotheses)
        .where(eq(daydreamHypotheses.verdict, 'refuted')),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamHypotheses)
        .where(eq(daydreamHypotheses.verdict, 'wrong_direction')),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamHypotheses)
        .where(eq(daydreamHypotheses.verdict, 'underpowered')),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamThoughts)
        .where(and(gte(daydreamThoughts.createdAt, from), lt(daydreamThoughts.createdAt, to))),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamThoughts)
        .where(and(gte(daydreamThoughts.deliveredAt, from), lt(daydreamThoughts.deliveredAt, to))),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamPlaces)
        .where(and(isNotNull(daydreamPlaces.label), eq(daydreamPlaces.status, 'active'))),
    ),
    count(
      db.select({ n: sql<number>`count(*)::int` }).from(daydreamPlaces)
        .where(and(sql`${daydreamPlaces.label} is null`, eq(daydreamPlaces.status, 'active'))),
    ),
    count(db.select({ n: sql<number>`count(*)::int` }).from(daydreamDayFeatures)),
  ]);

  return {
    questionsAsked,
    questionsAnswered,
    held,
    refuted,
    backwards,
    underpowered,
    thoughtsRaised,
    thoughtsDelivered,
    placesNamed,
    placesWaiting,
    daysOfData,
  };
}

/**
 * The deterministic sentence.
 *
 * Written so that a completely uneventful day still produces something worth
 * three seconds — the state of the ledger — rather than an empty card that
 * trains the owner to stop opening it.
 */
export function phrase(stats: DigestStats): string {
  const bits: string[] = [];

  if (stats.questionsAsked) {
    bits.push(`Asked ${stats.questionsAsked} new question${stats.questionsAsked === 1 ? '' : 's'}`);
  }
  if (stats.questionsAnswered) {
    const parts: string[] = [];
    if (stats.held) parts.push(`${stats.held} holding`);
    if (stats.refuted) parts.push(`${stats.refuted} came back empty`);
    if (stats.backwards) parts.push(`${stats.backwards} the other way round`);
    if (stats.underpowered) parts.push(`${stats.underpowered} still short of data`);
    bits.push(
      `answered ${stats.questionsAnswered}${parts.length ? ` — ${parts.join(', ')}` : ''}`,
    );
  }
  if (stats.thoughtsRaised) {
    bits.push(
      `noticed ${stats.thoughtsRaised} thing${stats.thoughtsRaised === 1 ? '' : 's'}` +
        (stats.thoughtsDelivered ? `, said ${stats.thoughtsDelivered}` : ', said nothing'),
    );
  }

  if (bits.length === 0) {
    // The honest quiet day. Still names the state of the ledger, so silence is
    // legible rather than ambiguous.
    return (
      `Nothing new yesterday. ${stats.daysOfData} days of data on file, ` +
      `${stats.placesNamed} places named and ${stats.placesWaiting} still waiting.`
    );
  }

  const head = bits.join('; ');
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}.`;
}

/** Build and store one day's digest. Idempotent per (subject, day). */
export async function buildDigest(
  opts: { now?: Date; offsetDays?: number; subject?: string } = {},
): Promise<BuiltDigest & { written: boolean; error: string | null }> {
  const now = opts.now ?? new Date();
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const day = digestDay(now, opts.offsetDays ?? 1);

  try {
    const stats = await gatherStats(day, subject);
    const summary = phrase(stats);

    await db
      .insert(daydreamDigests)
      .values({ subject, day, summary, stats: stats as unknown as Record<string, number> })
      .onConflictDoUpdate({
        target: [daydreamDigests.subject, daydreamDigests.day],
        // Recomputed rather than left alone: a digest built at 07:00 for a day
        // whose figures were still settling should correct itself, and every
        // number in it is derived anyway.
        set: { summary, stats: stats as unknown as Record<string, number> },
      });

    return { day, summary, stats, written: true, error: null };
  } catch (err) {
    return {
      day,
      summary: '',
      stats: {
        questionsAsked: 0, questionsAnswered: 0, held: 0, refuted: 0, backwards: 0,
        underpowered: 0, thoughtsRaised: 0, thoughtsDelivered: 0, placesNamed: 0,
        placesWaiting: 0, daysOfData: 0,
      },
      written: false,
      error: errMsg(err),
    };
  }
}
