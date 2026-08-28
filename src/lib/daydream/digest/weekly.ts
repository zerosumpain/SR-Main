// src/lib/daydream/digest/weekly.ts
//
// The week, looked in the eye: what the engine noticed, what it tried, what
// it got wrong, and what it wants to watch next. P4's closing piece.
//
// Two layers, same bargain as everywhere else in this feature:
//   • the SUMMARY is deterministic — counted by code, always present, and a
//     quiet week says so plainly ("a digest that only appears with news
//     cannot be trusted when silent");
//   • the NARRATIVE is the model's, composed ONLY from the counted facts
//     below and then put through a verify pass at temperature 0. UNSUPPORTED
//     drops the prose and ships the summary alone — a weekly letter that
//     invents its own week is worse than no letter.
//
// Rows land in daydream_digests under subject 'weekly' — a separate stream
// from the daily digest, which will independently write the same calendar
// day and must not collide with it on the (subject, day) unique key.

import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamDigests,
  daydreamHypotheses,
  daydreamLeads,
  daydreamSpend,
  daydreamThoughts,
  heartbeatActions,
  heartbeatPulses,
} from '$lib/db/schema';
import { LOCAL_TZ } from '../types';

export const WEEKLY_SUBJECT = 'weekly';

export interface WeekFacts {
  weekEnding: string;
  raised: number;
  delivered: number;
  usefulVotes: number;
  notUsefulVotes: number;
  placesAnswered: number;
  hypothesesTested: number;
  hypothesesHeld: number;
  hypothesesRefuted: number;
  leadsOpened: number;
  auditDropped: number;
  spendMinor: number;
  topTitles: string[];
}

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

export async function gatherWeek(now: Date): Promise<WeekFacts> {
  const since = new Date(now.getTime() - 7 * 86_400_000);

  const [thoughtAgg] = await db
    .select({
      raised: sql<number>`count(*)::int`,
      delivered: sql<number>`count(*) filter (where ${daydreamThoughts.status} in ('delivered','seen','actioned') and ${daydreamThoughts.deliveredAt} >= ${since})::int`,
      useful: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} = 'useful' and ${daydreamThoughts.feedbackAt} >= ${since})::int`,
      notUseful: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} = 'not_useful' and ${daydreamThoughts.feedbackAt} >= ${since})::int`,
      placesAnswered: sql<number>`count(*) filter (where ${daydreamThoughts.kind} in ('unknown_place','unknown_frequent_place') and ${daydreamThoughts.status} = 'actioned' and ${daydreamThoughts.updatedAt} >= ${since})::int`,
    })
    .from(daydreamThoughts)
    .where(gte(daydreamThoughts.createdAt, since));

  const [hypAgg] = await db
    .select({
      tested: sql<number>`count(*) filter (where ${daydreamHypotheses.testedAt} >= ${since})::int`,
      held: sql<number>`count(*) filter (where ${daydreamHypotheses.verdict} = 'supported' and ${daydreamHypotheses.testedAt} >= ${since})::int`,
      refuted: sql<number>`count(*) filter (where ${daydreamHypotheses.verdict} in ('refuted','wrong_direction') and ${daydreamHypotheses.testedAt} >= ${since})::int`,
    })
    .from(daydreamHypotheses);

  const [leadAgg] = await db
    .select({ opened: sql<number>`count(*)::int` })
    .from(daydreamLeads)
    .where(gte(daydreamLeads.createdAt, since));

  const [spendAgg] = await db
    .select({ total: sql<number>`coalesce(sum(${daydreamSpend.amountMinor}), 0)::int` })
    .from(daydreamSpend)
    .where(and(eq(daydreamSpend.verified, true), gte(daydreamSpend.day, localDayStr(since))));

  // The fabrication meter, summed off the ponder pulses for the week.
  const drops = await db
    .select({ details: heartbeatPulses.details })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(and(eq(heartbeatActions.name, 'daydream-ponder'), gte(heartbeatPulses.ts, since)));
  let auditDropped = 0;
  for (const r of drops) {
    const rej = (r.details as { rejected?: unknown[] } | null)?.rejected;
    if (Array.isArray(rej)) auditDropped += rej.length;
  }

  const tops = await db
    .select({ title: daydreamThoughts.title })
    .from(daydreamThoughts)
    .where(and(gte(daydreamThoughts.deliveredAt, since), isNotNull(daydreamThoughts.deliveredAt)))
    .orderBy(sql`${daydreamThoughts.score} desc`)
    .limit(3);

  return {
    weekEnding: localDayStr(now),
    raised: thoughtAgg?.raised ?? 0,
    delivered: thoughtAgg?.delivered ?? 0,
    usefulVotes: thoughtAgg?.useful ?? 0,
    notUsefulVotes: thoughtAgg?.notUseful ?? 0,
    placesAnswered: thoughtAgg?.placesAnswered ?? 0,
    hypothesesTested: hypAgg?.tested ?? 0,
    hypothesesHeld: hypAgg?.held ?? 0,
    hypothesesRefuted: hypAgg?.refuted ?? 0,
    leadsOpened: leadAgg?.opened ?? 0,
    auditDropped,
    spendMinor: spendAgg?.total ?? 0,
    topTitles: tops.map((t) => t.title),
  };
}

/** PURE. The deterministic summary — true with or without a model. */
export function phraseWeek(f: WeekFacts): string {
  const bits: string[] = [];
  bits.push(
    f.raised === 0
      ? 'Nothing raised this week'
      : `${f.raised} thought${f.raised === 1 ? '' : 's'} raised, ${f.delivered} delivered`,
  );
  if (f.usefulVotes + f.notUsefulVotes > 0) bits.push(`feedback ${f.usefulVotes}↑ ${f.notUsefulVotes}↓`);
  if (f.placesAnswered) bits.push(`${f.placesAnswered} place${f.placesAnswered === 1 ? '' : 's'} named`);
  if (f.hypothesesTested) bits.push(`${f.hypothesesTested} question${f.hypothesesTested === 1 ? '' : 's'} tested (${f.hypothesesHeld} held, ${f.hypothesesRefuted} refuted)`);
  if (f.leadsOpened) bits.push(`${f.leadsOpened} line${f.leadsOpened === 1 ? '' : 's'} of enquiry opened`);
  if (f.spendMinor) bits.push(`£${(f.spendMinor / 100).toFixed(2)} evidenced spend`);
  bits.push(f.auditDropped === 0 ? 'audit clean' : `audit dropped ${f.auditDropped}`);
  return `Week to ${f.weekEnding}: ${bits.join('; ')}.`;
}

/** PURE. The facts block the narrative may draw on — and nothing else. */
export function weekFactLines(f: WeekFacts): string[] {
  return [
    `Week ending ${f.weekEnding}.`,
    `Thoughts: ${f.raised} raised, ${f.delivered} delivered.`,
    `Feedback: ${f.usefulVotes} useful, ${f.notUsefulVotes} not useful.`,
    `Places named this week: ${f.placesAnswered}.`,
    `Questions tested: ${f.hypothesesTested} (${f.hypothesesHeld} held up, ${f.hypothesesRefuted} refuted).`,
    `Lines of enquiry opened: ${f.leadsOpened}.`,
    `Evidenced spend: £${(f.spendMinor / 100).toFixed(2)} (receipts/bank only — understates cash).`,
    `Citation audit: ${f.auditDropped} musings dropped for bad evidence.`,
    ...(f.topTitles.length ? [`Highest-scoring delivered: ${f.topTitles.map((t) => `"${t}"`).join(' · ')}.`] : []),
  ];
}

export async function weeklyRowExists(day: string): Promise<boolean> {
  const [row] = await db
    .select({ id: daydreamDigests.id })
    .from(daydreamDigests)
    .where(and(eq(daydreamDigests.subject, WEEKLY_SUBJECT), eq(daydreamDigests.day, day)))
    .limit(1);
  return row != null;
}

/** The digests stats column is numbers-only by type; strings live in summary. */
export function numericStats(f: WeekFacts): Record<string, number> {
  return {
    raised: f.raised,
    delivered: f.delivered,
    usefulVotes: f.usefulVotes,
    notUsefulVotes: f.notUsefulVotes,
    placesAnswered: f.placesAnswered,
    hypothesesTested: f.hypothesesTested,
    hypothesesHeld: f.hypothesesHeld,
    hypothesesRefuted: f.hypothesesRefuted,
    leadsOpened: f.leadsOpened,
    auditDropped: f.auditDropped,
    spendMinor: f.spendMinor,
  };
}

export async function saveWeekly(
  day: string,
  summary: string,
  narrative: string | null,
  verified: boolean | null,
  stats: Record<string, number>,
): Promise<void> {
  await db
    .insert(daydreamDigests)
    .values({ subject: WEEKLY_SUBJECT, day, summary, narrative, verified, stats })
    .onConflictDoUpdate({
      target: [daydreamDigests.subject, daydreamDigests.day],
      set: { summary, narrative, verified, stats },
    });
}
