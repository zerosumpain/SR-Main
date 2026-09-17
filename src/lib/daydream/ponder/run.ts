// src/lib/daydream/ponder/run.ts
//
// One ponder cycle: assemble the fact pack, let the model think WIDE, audit
// what comes back, and feed the survivors into the machinery that already
// exists — musings into the thought ledger, lines of enquiry into the leads
// frontier (its first-ever writer), standing rules into the same
// validate → backtest → owner gate the rulesmith uses.
//
// This is the design pivot the 2026-08-27 review agreed: from "rules detect,
// the model only phrases" to "the model ponders, code verifies". What did NOT
// change is who gets to fire a notification: a musing is an ordinary thought
// candidate, so the threshold, kind weights, mutes, cooldowns and delivery
// caps all still stand between anything here and the owner's attention.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '$lib/db';
import {
  daydreamDayFeatures,
  daydreamHypotheses,
  daydreamLeads,
  daydreamThoughts,
  daydreamObservations,
  daydreamSignals,
} from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { resolveDaydreamModel } from '../compose';
import { buildSnapshot } from '../snapshot';
import { persistCandidates, type PersistResult } from '../thought-store';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { assemblePack, renderPack, type PackInputs } from './pack';
import { runLookups, MAX_LOOKUPS_PER_CYCLE } from './lookups';
import { briefFor, lensAt, limitsFor, signalPreferenceFor, type Lens } from './lens';
import { adversaryPrompt, applyAdversary, renderForAdversary, validateAdversary } from './adversary';
import {
  chooseSignals,
  outlierText,
  rankOutliers,
  roundFigure,
  signalShape,
  PACK_SIGNAL_LIMIT,
  SIGNAL_PRIOR_DAYS,
  SIGNAL_RECENT_DAYS,
  SIGNAL_ROTATION_SEATS,
  SIGNAL_ROTATION_STEP_MS,
  type SignalRow,
} from './signals';
import { buildProfileLines } from './profile';
import { SWEEP_METRICS, ENTANGLED_PAIRS } from '../stats/sweep';
import { MIN_PAIRS } from '../stats/tests';
import { TITLE_ECHO_WINDOW_DAYS } from '../refutations';
import {
  DEFAULT_PONDER_CAPS,
  type PonderCaps,
  MUSING_THEMES,
  validatePonderOutput,
} from './schema';
import { withActivity } from '$lib/context/activity';

export interface PonderResult {
  cards: number;
  /** Which angle this cycle took. On the pulse so the rotation is visible and
   *  a lens that never produces anything is measurable rather than suspected. */
  lens: Lens;
  musings: PersistResult & { proposed: number };
  leadsCreated: number;
  leadsDuplicate: number;
  rulesAdmitted: number;
  rulesRefused: number;
  rejected: string[];
  /** Metric names the model got nearly right, and what they became. On the
   *  pulse so an alias is visible rather than silently accepted. */
  coerced: string[];
  /** What the lookup stage did. On the pulse so a probe that never pays for
   *  itself is visible rather than quietly costing a round trip a cycle. */
  lookups: { asked: number; cards: number; failed: number };
  /** The second pass, when the budget paid for one. `ran: false` means there
   *  was no headroom, not that nothing was challenged. */
  adversary: { ran: boolean; dropped: string[]; sharpened: number };
  tokens: { prompt: number; completion: number };
  error: string | null;
}

const EMPTY: PonderResult = {
  cards: 0,
  lens: 'household',
  musings: { created: 0, updated: 0, suppressed: 0, muted: 0, alreadyRefuted: 0, protectedSkipped: 0, merged: 0, createdKeys: [], proposed: 0 },
  leadsCreated: 0,
  leadsDuplicate: 0,
  rulesAdmitted: 0,
  rulesRefused: 0,
  rejected: [],
  coerced: [],
  lookups: { asked: 0, cards: 0, failed: 0 },
  adversary: { ran: false, dropped: [], sharpened: 0 },
  tokens: { prompt: 0, completion: 0 },
  error: null,
};

/** Aggregates over the day-feature store — the model gets summaries, never
 *  the raw rows, and every number it may quote appears here verbatim. */
async function featureAggregates(now: Date): Promise<PackInputs['aggregates']> {
  const out: PackInputs['aggregates'] = [];
  try {
    const floor = (days: number) =>
      new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const [w] = await db
      .select({
        sleep: sql<number | null>`round(avg(${daydreamDayFeatures.sleepMinutes}))::int`,
        steps: sql<number | null>`round(avg(${daydreamDayFeatures.steps}))::int`,
        out7: sql<number | null>`round(avg(${daydreamDayFeatures.minutesOut}))::int`,
        busy: sql<number | null>`round(avg(${daydreamDayFeatures.calendarBusyMinutes}))::int`,
        spend: sql<number | null>`sum(${daydreamDayFeatures.verifiedSpendMinor})::int`,
      })
      .from(daydreamDayFeatures)
      .where(and(eq(daydreamDayFeatures.subject, DEFAULT_SUBJECT), gte(daydreamDayFeatures.day, floor(7))));
    if (w) {
      if (w.sleep != null) out.push({ key: 'sleep7', text: `Average sleep last 7 days: ${Math.round(w.sleep / 6) / 10}h a night.` });
      if (w.steps != null) out.push({ key: 'steps7', text: `Average steps last 7 days: ${w.steps} a day.` });
      if (w.out7 != null) out.push({ key: 'out7', text: `Average time out of the house last 7 days: ${w.out7} min a day.` });
      if (w.busy != null) out.push({ key: 'busy7', text: `Average timed calendar commitments last 7 days: ${w.busy} min a day.` });
      if (w.spend != null) out.push({ key: 'spend7', text: `Evidenced spend last 7 days: £${(w.spend / 100).toFixed(2)}.` });
    }
  } catch {
    // Aggregates are garnish; the pack stands without them.
  }
  return out;
}

/**
 * The signal registry, summarised for the pack.
 *
 * This is what makes the open registry reach the model at all: the sweep proves
 * relationships, but a musing needs the reading itself in front of it. A card
 * per signal is the whole point — indoor temperature, the weather where John
 * actually was, how long the school run took — none of which needed a line of
 * code here to become sayable.
 *
 * Two windows in one query: the last week, which is what the card quotes, and
 * the three before it, which is the only thing that can say whether the week is
 * unusual. See `chooseSignals` for who gets a seat and `signalShape` for what
 * each card says beyond its mean.
 */
async function signalAggregates(now: Date, prefer: string[] = []): Promise<PackInputs['aggregates']> {
  const out: PackInputs['aggregates'] = [];
  try {
    const day = (back: number) => new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const recentFrom = day(SIGNAL_RECENT_DAYS);
    const priorFrom = day(SIGNAL_PRIOR_DAYS);
    const today = day(0);

    const rows = await db
      .select({
        key: daydreamObservations.signalKey,
        label: daydreamSignals.label,
        unit: daydreamSignals.unit,
        mean: sql<number | null>`avg(${daydreamObservations.valueMean}) filter (where ${daydreamObservations.day} >= ${recentFrom})`,
        lo: sql<number | null>`min(${daydreamObservations.valueMin}) filter (where ${daydreamObservations.day} >= ${recentFrom})`,
        hi: sql<number | null>`max(${daydreamObservations.valueMax}) filter (where ${daydreamObservations.day} >= ${recentFrom})`,
        days: sql<number>`(count(distinct ${daydreamObservations.day}) filter (where ${daydreamObservations.day} >= ${recentFrom}))::int`,
        priorMean: sql<number | null>`avg(${daydreamObservations.valueMean}) filter (where ${daydreamObservations.day} < ${recentFrom})`,
        priorSd: sql<number | null>`stddev_samp(${daydreamObservations.valueMean}) filter (where ${daydreamObservations.day} < ${recentFrom})`,
        priorDays: sql<number>`(count(distinct ${daydreamObservations.day}) filter (where ${daydreamObservations.day} < ${recentFrom}))::int`,
        lastDay: sql<string | null>`max(${daydreamObservations.day})`,
      })
      .from(daydreamObservations)
      .innerJoin(daydreamSignals, eq(daydreamSignals.key, daydreamObservations.signalKey))
      .where(and(gte(daydreamObservations.day, priorFrom), eq(daydreamSignals.status, 'active')))
      .groupBy(daydreamObservations.signalKey, daydreamSignals.label, daydreamSignals.unit);

    const cursor = Math.floor(now.getTime() / SIGNAL_ROTATION_STEP_MS) * SIGNAL_ROTATION_SEATS;
    const seated = chooseSignals(rows as SignalRow[], cursor, PACK_SIGNAL_LIMIT, prefer);

    // The outlier block, ranked across the WHOLE registry rather than the
    // seated cards — the sensor worth naming is by definition the one that did
    // not win a movement seat. See `rankOutliers` for why this shape of
    // question exists at all.
    for (const r of rankOutliers(rows as SignalRow[], new Set(seated.map((x) => x.key)))) {
      out.push({ key: `outlier:${r.key}`, text: outlierText(r) });
    }

    for (const r of seated) {
      const unit = r.unit ? ` ${r.unit}` : '';
      const range =
        r.lo != null && r.hi != null && r.hi !== r.lo
          ? `, range ${roundFigure(r.lo)}–${roundFigure(r.hi)}${unit}`
          : '';
      out.push({
        key: `signal:${r.key}`,
        text:
          `${r.label} over the last ${r.days} day${r.days === 1 ? '' : 's'}: ` +
          `mean ${roundFigure(r.mean as number)}${unit}${range}.` +
          signalShape(r, today),
      });
    }
  } catch {
    // Garnish, like the feature aggregates. The pack stands without them.
  }
  return out;
}

/** The long look: how far back each comparison reaches. */
const LONG_RECENT_DAYS = 30;
const LONG_PRIOR_DAYS = 90;
/** A place is DORMANT when it was a habit and has not happened since. Three
 *  weeks is long enough that a holiday or a run of bad weather has passed. */
const DORMANT_AFTER_DAYS = 21;
const DORMANT_MIN_VISITS = 4;
/** How far the recent mean must move, as a share of the prior mean, before a
 *  drift card is worth a seat. Ten per cent over a month is a real change in
 *  every series here and small enough not to need a test to be worth noticing. */
const DRIFT_MIN_SHARE = 0.1;

/**
 * Months, not days.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * Everything else in the pack looks at now, next week, and the last seven days.
 * There are 267 recorded days for John and 113 for each of the other four, and
 * nothing had ever asked what the far end of them says. The most surprising
 * thing available to this engine is an ABSENCE — something that used to happen
 * reliably and has quietly stopped — and an absence is invisible to every other
 * card in the pack, because every other card is built from rows that exist.
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────
 *
 * No year-on-year comparison. The record begins 2025-12-25, so "this week last
 * year" has no rows behind it and would be an empty card at best and an
 * invented one at worst. The span card below states where the record starts
 * precisely so the model cannot reason past it — a fact pack that does not say
 * how much history it has is one that gets asked about a decade.
 *
 * Nothing here is a test. A drift is reported as a movement, never as a trend
 * or a cause; the sweep and the hypothesis machinery are what make claims, and
 * they do it under FDR control.
 */
async function longViewCards(now: Date, subject: string): Promise<PackInputs['aggregates']> {
  const out: PackInputs['aggregates'] = [];
  const day = (back: number) => new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);

  // How much history there is, so nothing reasons beyond it.
  try {
    const [span] = await db
      .select({
        first: sql<string | null>`min(${daydreamDayFeatures.day})`,
        days: sql<number>`count(*)::int`,
      })
      .from(daydreamDayFeatures)
      .where(eq(daydreamDayFeatures.subject, subject));
    if (span?.first && span.days > 0) {
      out.push({
        key: 'record:span',
        text: `The recorded history starts ${span.first} and covers ${span.days} days. There is nothing before that date — do not compare to a year ago.`,
      });
    }
  } catch {
    // The span is a guard, not a finding; its absence costs a caution.
  }

  // Drift: the last month against the two before it.
  try {
    const recentFrom = day(LONG_RECENT_DAYS);
    const priorFrom = day(LONG_PRIOR_DAYS);
    // `AnyPgColumn`, not `typeof table.sleepMinutes` — a helper typed against
    // one column accepts only that column, and every other metric here is a
    // different Pg type. This trap has been paid for once already.
    const avg = (col: AnyPgColumn, from: string, to?: string) =>
      to
        ? sql<number | null>`avg(${col}) filter (where ${daydreamDayFeatures.day} >= ${from} and ${daydreamDayFeatures.day} < ${to})`
        : sql<number | null>`avg(${col}) filter (where ${daydreamDayFeatures.day} >= ${from})`;
    const [d] = await db
      .select({
        sleepNow: avg(daydreamDayFeatures.sleepMinutes, recentFrom),
        sleepWas: avg(daydreamDayFeatures.sleepMinutes, priorFrom, recentFrom),
        stepsNow: avg(daydreamDayFeatures.steps, recentFrom),
        stepsWas: avg(daydreamDayFeatures.steps, priorFrom, recentFrom),
        outNow: avg(daydreamDayFeatures.minutesOut, recentFrom),
        outWas: avg(daydreamDayFeatures.minutesOut, priorFrom, recentFrom),
        busyNow: avg(daydreamDayFeatures.calendarBusyMinutes, recentFrom),
        busyWas: avg(daydreamDayFeatures.calendarBusyMinutes, priorFrom, recentFrom),
      })
      .from(daydreamDayFeatures)
      .where(and(eq(daydreamDayFeatures.subject, subject), gte(daydreamDayFeatures.day, priorFrom)));

    const drift = (
      key: string,
      label: string,
      nowV: number | null | undefined,
      wasV: number | null | undefined,
      fmt: (n: number) => string,
    ) => {
      if (nowV == null || wasV == null || Math.abs(wasV) < 1e-9) return;
      const share = (nowV - wasV) / Math.abs(wasV);
      if (Math.abs(share) < DRIFT_MIN_SHARE) return;
      out.push({
        key: `drift:${key}`,
        text:
          `Over the last ${LONG_RECENT_DAYS} days ${label} averaged ${fmt(nowV)}, against ${fmt(wasV)} in the ${LONG_PRIOR_DAYS - LONG_RECENT_DAYS} days before — ` +
          `${share > 0 ? 'up' : 'down'} ${Math.round(Math.abs(share) * 100)}%.`,
      });
    };
    if (d) {
      drift('sleep', 'sleep', d.sleepNow, d.sleepWas, (n) => `${Math.round(n / 6) / 10}h a night`);
      drift('steps', 'steps', d.stepsNow, d.stepsWas, (n) => `${Math.round(n)} a day`);
      drift('out', 'time out of the house', d.outNow, d.outWas, (n) => `${Math.round(n)} min a day`);
      drift('busy', 'timed diary commitments', d.busyNow, d.busyWas, (n) => `${Math.round(n)} min a day`);
    }
  } catch (err) {
    console.warn(`[daydream] could not read the drift: ${errMsg(err)}`);
  }

  // What has stopped. Named places only: an unnamed cluster going quiet is
  // noise, and a named one is somewhere John decided was worth a name.
  try {
    const { daydreamPlaces } = await import('$lib/db/schema');
    const since = new Date(now.getTime() - DORMANT_AFTER_DAYS * 86_400_000);
    const rows = await db
      .select({
        id: daydreamPlaces.id,
        label: daydreamPlaces.label,
        visits: daydreamPlaces.visitCount,
        last: daydreamPlaces.lastSeenAt,
      })
      .from(daydreamPlaces)
      .where(
        and(
          eq(daydreamPlaces.status, 'active'),
          sql`${daydreamPlaces.label} is not null`,
          sql`${daydreamPlaces.visitCount} >= ${DORMANT_MIN_VISITS}`,
          sql`${daydreamPlaces.lastSeenAt} < ${since}`,
        ),
      )
      .orderBy(desc(daydreamPlaces.visitCount))
      .limit(6);
    for (const r of rows) {
      const gap = Math.round((now.getTime() - new Date(r.last as unknown as string).getTime()) / 86_400_000);
      out.push({
        key: `dormant:${r.id}`,
        text: `${r.label} was visited ${r.visits} times and has not been since ${String(r.last).slice(0, 10)} — ${gap} days ago.`,
      });
    }
  } catch (err) {
    console.warn(`[daydream] could not read dormant places: ${errMsg(err)}`);
  }

  return out;
}

/**
 * What the owner has said specific diary entries MEAN.
 *
 * The whole point of a note that does not hide: "PE days are a reminder to
 * take PE kit into school, not an actual time commitment" is a fact the model
 * should read alongside the diary, and hiding the event would have hidden the
 * kit reminder along with the false commitment.
 */
async function diaryNoteCards(): Promise<PackInputs['aggregates']> {
  try {
    const { diaryNotes } = await import('../calendar/store');
    const rows = await diaryNotes();
    return rows.map((r) => ({
      key: `diary-note:${r.id}`,
      text: `About "${r.title ?? 'a diary entry'}" in the calendar, John says: ${r.reason}`,
    }));
  } catch {
    return [];
  }
}

/**
 * What the REVIEWER specifically refuted, so the same misreading is not
 * proposed again.
 *
 * The half that closes the negative loop. Verified and uncertain reviews take
 * the ordinary raw-memory → nightly-theme path; replaying their full review
 * prose forever is exactly the over-specific memory behaviour consolidation
 * replaces. A refutation is different: it is an exact prohibition and remains
 * binding even after its raw memory has been rolled up.
 *
 * The owner's example is the specification: having ruled that the two Canva
 * rows are one payment, it should stop saying there were two charges.
 */
async function rulingCardsFor(): Promise<{
  cards: PackInputs['aggregates'];
  /** The refutations as prompt rules, not as cards. One query feeds both: they
   *  are the same rows read for two different purposes, and two queries would
   *  let the pack and the rules disagree about what has been settled. */
  refutedLines: string[];
}> {
  try {
    const { rulingCards, refutedBlock } = await import('../rulings');
    const rows = await rulingCards();
    return {
      cards: rows
        .filter((r) => r.verdict === 'refuted')
        .map((r) => ({
          key: `ruling:${r.id}`,
          text: `A reviewer checked "${r.title}" against the sources and it did NOT hold${r.reasoning ? `: ${r.reasoning}` : ''} Do not propose this again.`,
        })),
      refutedLines: refutedBlock(rows.filter((r) => r.verdict === 'refuted')),
    };
  } catch {
    // Garnish. The pack stands without it, and a ruling table that cannot be
    // read must not cost the cycle.
    return { cards: [], refutedLines: [] };
  }
}

/** How far back the "already said" block looks. The same window the live-echo
 *  guard merges on, so the prompt and the guard cannot disagree about what
 *  counts as a repeat. */
const ALREADY_SAID_DAYS = TITLE_ECHO_WINDOW_DAYS;
/** Lines in the block. Enough to cover a week at four musings a cycle without
 *  the block becoming the largest thing in the prompt. */
const ALREADY_SAID_LIMIT = 24;

/**
 * What this engine has already said, out loud, in the last week.
 *
 * ── Why this is a prompt rule and not a card ────────────────────────────────
 *
 * Measured on production 2026-09-17: across 30 days the model proposed 184
 * musings and 41 were new. The other 137 were absorbed by the live-echo guard
 * in `refutations.ts` — the same crossing, re-derived every two hours, silently
 * merged into the row it already had. The model was not being repetitive out of
 * poverty; the pack it sees each cycle is nearly identical and it had no way to
 * know it had said any of this before.
 *
 * The fix is the one that already worked twice in this file. `ALREADY OPEN`
 * fixed the leads frontier and the refuted block fixed re-proposed claims, both
 * by moving the list out of the cards and INTO the rule that needed it. A card
 * is material to reason over, sitting among two hundred others; a rule is a
 * constraint. Repetition is a constraint problem.
 *
 * What it deliberately does NOT do is forbid the subject. A claim worth making
 * twice exists — a deadline that moved, a pattern that broke again — so the
 * rule beside this block asks for the CHANGE to be cited, which the audit can
 * then check like any other citation. Silence about a live subject would be
 * worse than the repetition it replaces.
 */
async function alreadySaidLines(now: Date): Promise<string[]> {
  try {
    const { loadLiveClaims } = await import('../refutations');
    const floor = now.getTime() - ALREADY_SAID_DAYS * 86_400_000;
    const rows = (await loadLiveClaims(200))
      .filter((r) => r.createdAt.getTime() >= floor)
      .slice(0, ALREADY_SAID_LIMIT);
    if (!rows.length) return [];
    const dayOf = (d: Date) => {
      const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
    };
    return [
      `ALREADY SAID — these claims are live from the last ${ALREADY_SAID_DAYS} days. Saying one again in different words creates nothing; the row is merged and the cycle is wasted.`,
      ...rows.map((r) => `  - [${dayOf(r.createdAt)}] ${r.title}`),
    ];
  } catch {
    // Soft, like every other context loader here: a list that cannot be read
    // costs sharpness, never the cycle.
    return [];
  }
}

/**
 * The notebook, and what the engine has already done about it.
 *
 * The owner's requirement was that notes reach "future ponders, daydreams,
 * suggestions" — all three of which are this engine, so all three are this one
 * card list. Two halves, and the second is the one that matters:
 *
 *   the NOTES themselves — his own words, carded verbatim and cited like any
 *     other card, which makes them the highest-value material in the pack.
 *   the finished ACTIONS — what was already looked up about them. Without this
 *     the next cycle reads the same note, has the same idea and proposes the
 *     same research a third time, which is exactly the complaint that produced
 *     the rulings memory on the feed.
 */
async function notebookCards(): Promise<PackInputs['aggregates']> {
  try {
    const [{ noteCard, actionCard }, { listNotes, recentActions }] = await Promise.all([
      import('../notebook/cards'),
      import('../notebook/store'),
    ]);
    const [notes, actions] = await Promise.all([listNotes(), recentActions(12)]);
    return [
      ...notes.slice(0, 15).map(noteCard),
      ...actions.map((a) =>
        actionCard({
          id: a.id,
          noteTitle: a.noteTitle,
          kind: a.kind,
          title: a.title,
          result: a.result,
          refKind: a.refKind,
          refId: a.refId,
        }),
      ),
    ];
  } catch {
    // Garnish. The pack stands without it, and a notebook that cannot be read
    // must not cost the cycle.
    return [];
  }
}

/**
 * What the sweep found, carded — the return leg discovery never had. Only
 * findings that cleared the correction, only the last week, and phrased as
 * a measurement over N days rather than a claim, so a musing that leans on
 * one cites a card the audit can check.
 */
async function sweepCards(): Promise<PackInputs['aggregates']> {
  try {
    const { recentFindings } = await import('../stats/findings');
    const rows = await recentFindings({ days: 7, limit: 6 });
    return rows.map((f) => ({
      key: `sweep:${f.a}|${f.b}|${f.lagDays}`,
      text:
        `Correlation (${f.subject}${f.lagDays ? ', one day later' : ', same day'}): ` +
        `${f.aLabel ?? f.a} and ${f.bLabel ?? f.b} move ${f.r < 0 ? 'opposite ways' : 'together'} ` +
        `(r ${f.r.toFixed(2)} over ${f.n} days, q ${f.qValue.toFixed(2)}, found ${f.day})`,
    }));
  } catch {
    return [];
  }
}

/**
 * Sources that joined recently — a self-built tool the loop shipped, a facet
 * that registered this month — carded so the pack knows the facet exists.
 * Sweepable only: a signal with a fortnight of days is a measurement; one
 * with three is a promise.
 */
async function newSourceCards(): Promise<PackInputs['aggregates']> {
  try {
    const { listSweepableSignals } = await import('../signals/registry');
    const { MIN_PAIRS } = await import('../stats/tests');
    const since = Date.now() - 14 * 86_400_000;
    const rows = await listSweepableSignals(MIN_PAIRS);
    return rows
      .filter((s) => s.firstSeenAt && new Date(s.firstSeenAt as unknown as string).getTime() >= since)
      .slice(0, 6)
      .map((s) => ({ key: `source:${s.key}`, text: `New source (${s.source}): ${s.label} — ${s.observedDays} days observed, now askable and swept.` }));
  } catch {
    return [];
  }
}

async function recentVerdicts(): Promise<PackInputs['verdicts']> {
  try {
    return await db
      .select({
        id: daydreamHypotheses.id,
        question: daydreamHypotheses.question,
        verdict: sql<string>`coalesce(${daydreamHypotheses.verdict}, 'untested')`,
        summary: daydreamHypotheses.summary,
        subject: daydreamHypotheses.subject,
        investigationPlan: daydreamHypotheses.investigationPlan,
      })
      .from(daydreamHypotheses)
      .orderBy(desc(daydreamHypotheses.proposedAt))
      .limit(10);
  } catch {
    return [];
  }
}

/** The 7-day diary. Separate from the snapshot's today-view; one CalDAV call. */
async function weekAhead(): Promise<PackInputs['weekAhead']> {
  try {
    // Through the shared reader, so an excluded event never reaches the pack.
    // This is the surface that matters most for the rolling-reminder case: a
    // standing reminder in the week ahead is exactly what the model would
    // otherwise build "your week is busy" out of.
    const { readCalendar } = await import('../calendar/read');
    const { loadExclusionSet } = await import('../calendar/store');
    const read = await readCalendar(
      { dateRangeStart: '+1d', dateRangeEnd: '+7d' },
      await loadExclusionSet(),
    );
    if (!read.available) return [];
    return read.events.slice(0, 20).map((e) => ({
      title: e.title,
      whenText: e.start.slice(0, 16).replace('T', ' '),
      location: e.location,
    }));
  } catch {
    return [];
  }
}


/**
 * What the model needs before it can propose a line of enquiry worth running.
 *
 * Two things it has never been told, both of which show up in the outcome:
 *
 *  • **Which metrics actually have data.** A lead pairing two series that do
 *    not overlap is dead the moment it is tested — that is what `underpowered`
 *    means, and production carries 48 of them. The day counts turn the metric
 *    list from a vocabulary into a menu.
 *  • **What is already open.** Nothing showed it the frontier, so every cycle
 *    proposed blind. `onConflictDoNothing` catches an identical `leadKey` and
 *    nothing catches the same question asked under a new one.
 */
async function leadContext(
  subject: string,
): Promise<{ open: string[]; menu: string[]; signalKeys: Set<string> }> {
  const out: { open: string[]; menu: string[]; signalKeys: Set<string> } = {
    open: [],
    menu: [],
    signalKeys: new Set(),
  };
  try {
    const rows = await db
      .select({ leadKey: daydreamLeads.leadKey, title: daydreamLeads.title })
      .from(daydreamLeads)
      .where(and(eq(daydreamLeads.subject, subject), eq(daydreamLeads.status, 'open')))
      .limit(20);
    out.open = rows.map((r) => `${r.leadKey} — ${r.title}`);
  } catch (err) {
    console.warn(`[daydream] could not read the frontier: ${errMsg(err)}`);
  }

  try {
    // One row, one count per metric. Cheaper than 22 queries and the numbers
    // must come from the same scan or they describe different days.
    const counts = SWEEP_METRICS.map(
      (m) => sql`count(${daydreamDayFeatures[m]})::int as ${sql.raw(`"${m}"`)}`,
    );
    const res = await db.execute(
      sql`select ${sql.join(counts, sql`, `)} from ${daydreamDayFeatures} where ${daydreamDayFeatures.subject} = ${subject}`,
    );
    const row = (Array.isArray(res) ? res[0] : (res as { rows?: unknown[] }).rows?.[0]) as
      | Record<string, unknown>
      | undefined;
    if (row) {
      for (const m of SWEEP_METRICS) {
        const days = Number(row[m] ?? 0);
        // The count is a CEILING on any pair that uses this metric, not the
        // overlap itself — two 250-day series can still share no days. Pairwise
        // overlap would be 231 numbers and does not fit in a prompt, but the
        // ceiling is enough to stop the thinnest series being paired at all,
        // and the thin ones here (minutesOut 30, distinctPlaces 35) are exactly
        // the metrics the underpowered hypotheses keep naming.
        out.menu.push(`${m} (${days} days${days < MIN_PAIRS ? ' — TOO FEW, do not use' : ''})`);
      }
    }
  } catch (err) {
    console.warn(`[daydream] could not count metric coverage: ${errMsg(err)}`);
  }

  // The registered signals a lead may now name, from the SAME menu the
  // hypothesis proposer reads. Until 2026-09-17 leads were confined to the 22
  // day-feature metrics, so a signal the registry discovered could be swept in
  // the background and never asked about — 315 registered, 22 askable.
  try {
    const { sweepableSignalMenu } = await import('../signals/registry');
    const rows = await sweepableSignalMenu(MIN_PAIRS);
    for (const r of rows) {
      out.signalKeys.add(r.key);
      out.menu.push(`${r.key} (${r.observedDays} days — ${r.label})`);
    }
  } catch (err) {
    console.warn(`[daydream] could not read the signal menu: ${errMsg(err)}`);
  }
  return out;
}

function systemPrompt(
  brief: string[],
  profileLines: string[],
  ctx: { open: string[]; menu: string[] },
  refuted: string[],
  said: string[],
  caps: PonderCaps = DEFAULT_PONDER_CAPS,
): string {
  return [
    "You are the pondering half of John's second brain. On spare cycles you look across everything it knows — family, diary, money, health, email facts, its own past discoveries — and notice crossings worth surfacing: something happening now that connects to a pattern, something coming up that the past says needs acting on early, a question worth investigating.",
    '',
    // The cycle's brief. Near the top on purpose: it is the one line that
    // decides which half of the pack gets read carefully, and a pack read the
    // same way eight times a day is what produced 35 diary musings in 41.
    ...brief,
    '',
    'WHO HE IS, FROM HIS OWN TRACES:',
    ...profileLines,
    // What a reviewer went and checked, and found false.
    //
    // These already ride in the pack as cards, and that was not enough: a card
    // is material to reason over, sitting among a hundred others. The leads
    // frontier taught this the expensive way — fourteen leads rejected for
    // "unknown metrics" until the vocabulary moved out of a footnote and INTO
    // the rule that needed it. `ALREADY OPEN` is what fixed leads; this is the
    // same block for claims, and it sits above the rules for the same reason.
    ...(refuted.length ? ['', ...refuted] : []),
    // What it has already said this week. Sits with the refuted block and above
    // the rules for the same reason both of those do: the model cannot act on
    // a constraint it has to infer from two hundred cards.
    ...(said.length ? ['', ...said] : []),
    '',
    'HARD RULES:',
    'Treat supported hypotheses as provisional associations, not causal proof. Question competing explanations and practical benefit. Inconclusive means not established, never disproved. A source-verified sentence is not a validated behavioural prediction.',
    '1. Reply with ONE JSON object only: {"musings": [], "leads": [], "actionRules": []}. No prose outside it. Empty arrays are a good answer — most cycles find nothing worth saying.',
    `2. A musing = {"slug","theme","title","text","salience","cites",["actions"]}. theme must be one of ${JSON.stringify(MUSING_THEMES)}. text ≤ 280 chars, plain, no greeting, no emoji. salience 0..1 = how much this deserves his attention.`,
    '3. CITE OR DIE: every musing must list the fact-card ids ("F12") it is built from. Any number, date, name or amount you mention must appear in a cited card. An uncited or wrongly-cited musing is deleted by the audit, not fixed.',
    // The crossing list used to name three shapes, all of which have a diary
    // on one side. Three more, from the card blocks added 2026-09-17, none of
    // which need the calendar at all — which is the point.
    '4. Do not restate a single card back as a musing — the value is the CROSSING between cards. Shapes worth hunting: now × pattern; upcoming × history; money × diary; a signal that is unlike itself × something in his week that would explain it; something that has STOPPED × whether that was a decision; a drift over months × a habit he has not noticed changing.',
    // The repetition rule. Not "never repeat": a claim worth making twice
    // exists, and silence about a live subject is worse than the repetition.
    // What it must do is say what MOVED, and cite it — which turns a repeat
    // into something the citation audit can check like any other claim.
    '4b. If a musing covers anything under ALREADY SAID, it is only worth sending when a cited card has CHANGED since — a date that moved, a figure that crossed, a thing that has now happened. Say what changed in the first clause and cite the card that shows it. If nothing changed, drop it and look somewhere else in the pack; an empty answer is better than a rewording.',
    // Four verbs since 2026-09-17, up from one. The engine could notice
    // anything and the only thing it could DO was set a reminder.
    `5. Optional actions on a musing, at most two: [{"kind","label","params"}]. Four kinds:`,
    `   remind {"inHours":N,"text":"..."} — when acting later beats reading now.`,
    `   watch  {"description":"...","cron":"m h dom mon dow"} — a recurring check that tells him when something CHANGES. Propose this when the musing is really about something that needs following, not something that needs saying once. Cron optional.`,
    `   draft  {"title":"...","text":"..."} — write it up in his notebook, for a musing worth more than 280 characters.`,
    `   ask    {"question":"..."} — put ONE question to him. Use it when a single answer would settle something the pack cannot: a fact nothing here records, or which of two readings is the right one. His answer comes back to you next cycle.`,
    `   Nothing fires on its own: every action waits for him to tap it. Propose none at all if none of the four is clearly better than the musing on its own.`,
    // The metric vocabulary, spelled out.
    //
    // This line used to read "metrics chosen from the feature store only" and
    // never said what those were. Every lead ever proposed on production was
    // rejected for `unknown metrics`, and the names offered — "Time out",
    // "Verified spend", "Average steps last 7 days", "Readiness" — are the
    // PACK'S OWN PROSE LABELS: told to pick from a vocabulary it could not see,
    // the model named the series off the cards in front of it. Fourteen leads,
    // none created, and nothing ever read the rejection back to it.
    //
    // Position matters as much as presence here, the same way `serves` had to
    // move ahead of the JSON shape before it was ever populated: the keys sit
    // WITH the rule that requires them, not in a footnote.
    `6. A lead = {"leadKey","title","rationale","metrics"} — a line of statistical enquiry worth pursuing over weeks. At most ${caps.maxLeads}.`,
    `   "metrics" MUST be 2 to 6 of these EXACT keys, copied character for character. Nothing else is a metric, and a label you read off a card above is not one.`,
    `   The number beside each is how many days it has recorded — the MOST any pair using it could overlap. A pair needs ${MIN_PAIRS} shared days to be testable at all, so prefer metrics with plenty and never pair two thin ones.`,
    // Two kinds of name in one list. The plain ones are the day-feature store;
    // the `source:identifier` ones are the open registry — a room sensor, the
    // weather where he actually was, a route's door-to-door time, a series a
    // tool the improvement loop wrote is now recording. Naming them is the
    // whole point of the registry, and leads could not do it until 2026-09-17.
    '   Two kinds of key appear below. A plain name (sleepMinutes) is a daily figure the engine has always kept. A name containing a colon (ha:…, journey:…, weather:…) is a registered signal — a sensor, a route, a reading a tool produces. Both are equally askable, and a question that crosses the two is usually the more interesting one.',
    // The menu carries each metric's day count, so a pair that cannot be
    // tested is visibly not worth proposing. Falls back to the bare vocabulary
    // if the count query failed — a list without numbers still beats no list.
    `   ${ctx.menu.length ? ctx.menu.join(', ') : SWEEP_METRICS.join(', ')}`,
    // Tautologies, named. The sweep skips these pairs at test time, so a lead
    // built on one spends a metric slot on a question that can never return an
    // answer — which the first real lead did twice out of six pairs.
    `   These pairs are true by definition and are SKIPPED when tested, so a lead built on one buys nothing: ${ENTANGLED_PAIRS.map(([a, b]) => `${a}+${b}`).join(', ')}.`,
    ...(ctx.open.length
      ? [
          `   ALREADY OPEN — do not propose these again, in any wording:`,
          ...ctx.open.map((l) => `     - ${l}`),
        ]
      : []),
    `   Example: {"leadKey":"sleep-and-time-out","title":"Does time out of the house drive sleep?","rationale":"Sleep has swung 40 minutes across the week while time out of the house doubled on three of those days.","metrics":["sleepMinutes","minutesOut"]}`,
    `7. An actionRule is a STANDING behaviour (fires on its own once approved): the full rule-spec shape with an added "action". Propose at most ${caps.maxActionRules}, and only when a pattern clearly repeats.`,
    `8. At most ${caps.maxMusings} musings. Fewer, sharper.`,
  ].join('\n');
}

export async function runPonder(
  opts: {
    now?: Date;
    verify?: boolean;
    subject?: string;
    lookupBudget?: number;
    caps?: Partial<PonderCaps>;
    /** Run the adversarial second pass. Set by the activity only when the
     *  quota meter says there is genuinely room — see `adversary.ts`. */
    adversary?: boolean;
  } = {},
): Promise<PonderResult> {
  const now = opts.now ?? new Date();
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const caps: PonderCaps = { ...DEFAULT_PONDER_CAPS, ...(opts.caps ?? {}) };
  const result: PonderResult = { ...EMPTY, musings: { ...EMPTY.musings, createdKeys: [] }, rejected: [], coerced: [], lookups: { asked: 0, cards: 0, failed: 0 }, adversary: { ran: false, dropped: [], sharpened: 0 }, tokens: { prompt: 0, completion: 0 } };

  try {
    // This cycle's angle. Chosen from the clock so the six lenses walk in step
    // across restarts, and reported on the result so the pulse says which one
    // ran.
    const lens = lensAt(now);
    result.lens = lens;
    const limits = limitsFor(lens);

    const snapshot = await buildSnapshot({ now, subject });
    const [verdicts, aggregates, signals, week, profileLines, diaryNotes, rulings, notebook, sweep, newSources, said, longView] =
      await Promise.all([
        recentVerdicts(),
        featureAggregates(now),
        signalAggregates(now, signalPreferenceFor(lens)),
        weekAhead(),
        buildProfileLines(now),
        diaryNoteCards(),
        rulingCardsFor(),
        notebookCards(),
        sweepCards(),
        newSourceCards(),
        alreadySaidLines(now),
        longViewCards(now, subject),
      ]);
    const leadCtx = await leadContext(subject);
    // The lookup stage. Code names a gap in what it has just assembled, calls a
    // read-only first-party tool and cards the answer — see lookups.ts for why
    // the model is not the one choosing. Soft: a failure here costs cards, never
    // the cycle.
    const lookups = await runLookups(
      { snapshot, weekAhead: week },
      { budget: opts.lookupBudget ?? MAX_LOOKUPS_PER_CYCLE },
    );
    result.lookups = { asked: lookups.asked.length, cards: lookups.cards.length, failed: lookups.failed };

    const pack = assemblePack({
      snapshot,
      verdicts,
      limits,
      lookups: lookups.cards,
      // Hand-written aggregates first, then whatever the registry discovered —
      // the second list is the one that grows without anyone editing this file.
      // Then anything John has said in his own words, and last what the
      // reviewer has already SETTLED. Those two go nearest the instruction
      // because they are the two that override: a correction he typed, and a
      // claim that has been checked against the sources and found wanting.
      aggregates: [...aggregates, ...longView, ...signals, ...sweep, ...newSources, ...notebook, ...diaryNotes, ...rulings.cards],
      weekAhead: week,
      feedbackLines: [],
      profileLines,
    });
    result.cards = pack.cards.length;
    if (pack.cards.length < 8) {
      result.error = `pack too thin to ponder (${pack.cards.length} cards)`;
      return result;
    }

    const model = await resolveDaydreamModel();
    const { client, model: modelId } = await getLLMClient(model);
    const res = await withActivity('daydream', () =>
      client.chat.completions.create({
        model: modelId,
        temperature: 0.7,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: systemPrompt(briefFor(lens), profileLines, leadCtx, rulings.refutedLines, said, caps) },
          { role: 'user', content: renderPack(pack) },
        ],
      }),
    );
    result.tokens.prompt = res.usage?.prompt_tokens ?? 0;
    result.tokens.completion = res.usage?.completion_tokens ?? 0;

    const raw = (res.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      result.error = 'model did not return JSON';
      return result;
    }

    const audit: ReturnType<typeof validatePonderOutput> = validatePonderOutput(parsed, pack, caps, leadCtx.signalKeys);
    // Faults, soft: a lead naming a metric nothing writes wants a source; a
    // musing dropped for a citation is the audit doing its job and only
    // counted.
    try {
      const { raiseFault, unknownMetricsIn } = await import('../faults');
      for (const reason of audit.rejected) {
        for (const m of unknownMetricsIn(reason)) {
          void raiseFault({ kind: 'metric_unknown', identifier: m, site: 'ponder/leads', detail: reason.slice(0, 300), subject });
        }
      }
      const drops = audit.rejected.filter((x) => /cite|citation|card|unknown card/i.test(x)).length;
      if (drops) void raiseFault({ kind: 'audit_drop', identifier: 'ponder', site: 'ponder/audit', detail: `${drops} musing(s) dropped this pass for citing a card they were not given`, subject });
      // The whole answer refused, repeatedly, is a gate defect rather than a
      // quiet week — the condition that hid the appetite lane's breakage.
      const { noteLaneOutcome } = await import('../faults');
      const proposedHere =
        (Array.isArray((parsed as { musings?: unknown[] })?.musings) ? (parsed as { musings: unknown[] }).musings.length : 0) +
        (Array.isArray((parsed as { leads?: unknown[] })?.leads) ? (parsed as { leads: unknown[] }).leads.length : 0);
      await noteLaneOutcome({
        lane: 'daydream-ponder',
        proposed: proposedHere,
        admitted: audit.musings.length + audit.leads.length,
        dropped: audit.rejected,
      });
    } catch {
      // never the tick
    }
    result.rejected = audit.rejected;
    result.coerced = audit.coerced;

    // ── The adversarial second pass ──
    //
    // Only when the budget paid for it, and only ever a FILTER plus a rewrite
    // over what the first audit already admitted. A failure here keeps the
    // first pass whole: the cycle must never be worth less for having tried to
    // improve itself.
    if (opts.adversary && audit.musings.length) {
      result.adversary.ran = true;
      try {
        const slugs = new Set(audit.musings.map((m) => m.slug));
        const res = await client.chat.completions.create({
          model: modelId,
          temperature: 0.4,
          max_tokens: 2000,
          messages: [
            { role: 'system', content: adversaryPrompt() },
            { role: 'user', content: renderPack(pack) },
            {
              role: 'user',
              content: renderForAdversary(
                audit.musings.map((m) => ({
                  slug: m.slug,
                  title: m.candidate.title,
                  text: m.narrative,
                  cites: m.citedCardIds,
                })),
              ),
            },
          ],
        });
        result.tokens.prompt += res.usage?.prompt_tokens ?? 0;
        result.tokens.completion += res.usage?.completion_tokens ?? 0;
        const body = (res.choices[0]?.message?.content ?? '')
          .trim()
          .replace(/^```(?:json)?/i, '')
          .replace(/```$/, '')
          .trim();
        const ruled = validateAdversary(JSON.parse(body), pack, slugs);
        result.rejected.push(...ruled.rejected);
        const applied = applyAdversary(audit.musings, ruled.rulings);
        result.adversary.dropped = applied.dropped;
        result.adversary.sharpened = applied.sharpened.length;
        // A sharpened line has passed the same citation audit as the original,
        // so it replaces the narrative and the evidence trail together.
        audit.musings = applied.kept.map((m) => {
          if (!m.sharpenedText || !m.sharpenedCites?.length) return m;
          const cards = m.sharpenedCites.map((c) => pack.byId.get(c)).filter((c): c is NonNullable<typeof c> => !!c);
          return {
            ...m,
            narrative: m.sharpenedText,
            citedCardIds: m.sharpenedCites,
            candidate: {
              ...m.candidate,
              explanation:
                `Drawn from ${cards.length} cited fact${cards.length === 1 ? '' : 's'}, sharpened on a second pass: ` +
                cards.map((c) => c.text).join(' · ').slice(0, 600),
              evidence: cards.map((c) => ({ kind: c.ref.kind, id: c.ref.id, note: c.text })),
            },
          };
        });
      } catch (err) {
        // Soft. The first pass stands exactly as it was audited.
        result.rejected.push(`adversary pass failed: ${errMsg(err)}`);
      }
    }

    // ── Musings → the thought ledger ──
    if (audit.musings.length) {
      const persisted = await persistCandidates(
        audit.musings.map((m) => m.candidate),
        { runId: `ponder-${now.getTime()}`, now },
      );
      result.musings = { ...persisted, proposed: audit.musings.length };

      // The model's own sentence becomes the narrative — it has passed the
      // citation audit, which is a stronger check than the phrasing pass
      // (every claim resolves to a card; compose's verify asks a model to
      // guess). `verified: true` records that audit. Protected statuses are
      // excluded so a musing the owner dismissed cannot resurrect its prose.
      for (const m of audit.musings) {
        await db
          .update(daydreamThoughts)
          .set({ narrative: m.narrative, verified: true, updatedAt: now })
          .where(
            sql`${daydreamThoughts.dedupeKey} = ${m.candidate.dedupeKey}
                and ${daydreamThoughts.status} in ('new', 'suppressed')`,
          );
      }
    } else {
      result.musings.proposed = 0;
    }

    // ── Lines of enquiry → the frontier (its first writer) ──
    for (const lead of audit.leads) {
      const inserted = await db
        .insert(daydreamLeads)
        .values({
          subject,
          leadKey: lead.leadKey,
          title: lead.title,
          rationale: lead.rationale,
          metrics: lead.metrics,
          status: 'open',
        })
        .onConflictDoNothing()
        .returning({ id: daydreamLeads.id });
      if (inserted.length) result.leadsCreated++;
      else result.leadsDuplicate++;
    }

    // ── Standing rules → the same gate the rulesmith uses ──
    for (const rawRule of audit.actionRules) {
      const { admitProposal } = await import('../rules/store');
      const admitted = await admitProposal(rawRule, { proposalKind: 'new' });
      if (admitted.admitted) result.rulesAdmitted++;
      else {
        result.rulesRefused++;
        result.rejected.push(`rule refused: ${admitted.reason ?? 'unknown'}`);
      }
    }

    return result;
  } catch (err) {
    result.error = errMsg(err);
    return result;
  }
}
