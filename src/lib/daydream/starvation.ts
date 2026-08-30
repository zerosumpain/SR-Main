// src/lib/daydream/starvation.ts
//
// What daydreaming tried to know and could not.
//
// ── Why this replaces question-mining as the build driver ───────────────────
//
// The self-improvement engine decides what to build by reading John's recent
// questions and inferring an unmet need. That produced 33 tools in the
// fortnight to 2026-08-30 and **not one of them was ever called**: a question
// asked once is not a standing appetite, so a tool built to answer it waits for
// a repeat that never comes.
//
// Daydreaming has the opposite problem and therefore the answer. It runs every
// day whether or not anybody asks it anything, and it keeps a record of the
// questions it could not settle. A tool built for one of those has a caller the
// moment it ships — the thing that named the gap.
//
// ── What counts as starvation, measured rather than assumed ─────────────────
//
// The spec expected this to come from leads that died barren. It does not:
// `daydream_leads` is EMPTY on production, because ponder's lead writer has
// never actually fired. Nor is it "signals below the sweep floor" — all 203
// Home Assistant signals and all 13 weather signals sit under `MIN_PAIRS`, but
// the best of them has 4 days of the 14 it needs and the registry is three days
// old. That is not starvation, it is Tuesday. A ledger that said "wait longer"
// two hundred times would be noise, and the toolsmith cannot build more days.
//
// What is left is a metric the proposer keeps asking about that comes back with
// **zero overlapping days** — not too few, none. That is the one shape a tool
// can close, because a tool can produce a measurement and cannot produce time.
//
// ── THE OWNER FILTER, AND WHY IT IS THE WHOLE CORRECTNESS OF THIS FILE ──────
//
// First written without one, on the strength of a query showing 14 metrics at
// zero pairs — `sleepPerformance` across 9 proposals, `recoveryScore` across 8,
// `verifiedSpendMinor` across 7. The conclusion drawn was "nothing writes these
// columns". **That was wrong.** `daydream_day_features` holds 248 non-null
// `sleep_performance` values, 248 `recovery_score` and 249
// `verified_spend_minor`.
//
// The real explanation: **all 48 underpowered hypotheses belong to katie,
// jemima, rory and fintan, and none to john.** Whoop, Apple Health,
// `daydream_spend` and the calendar have no subject column, so since
// 2026-08-28 they are recorded for the OWNER ONLY and are deliberately absent
// for everyone else. Fintan's `sleepPerformance` has zero pairs because Fintan
// has no Whoop strap, and building a tool for it would be building a tool for a
// policy.
//
// So only the owner's own hypotheses count. On the day this filter was added
// that takes the ledger from five confident, wrong build ideas to **none** —
// John's 24 hypotheses are all `refuted`, which is a tested verdict, not a
// starved one. Producing nothing is the correct answer and a detector that
// cannot produce nothing is not a detector.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses, daydreamSignals } from '$lib/db/schema';
import { DEFAULT_SUBJECT, errMsg } from './types';

/**
 * How many times a metric must have been asked about before its emptiness is
 * worth building for. Once is an accident of the proposer's vocabulary; twice
 * is a standing appetite.
 */
export const MIN_PROPOSALS = 2;

/** Days a registered signal may produce nothing before that counts as a source
 *  that never worked, rather than one that is merely young. */
export const SILENT_SOURCE_DAYS = 10;

/** Ideas emitted per collection. The backlog has its own nightly cap; this one
 *  stops a single starving domain filling the whole night's intake. */
export const MAX_IDEAS = 5;

export interface StarvedMetric {
  metric: string;
  proposals: number;
  bestPairs: number;
}

export interface StarvationIdea {
  title: string;
  detail: string;
  kind: 'tool';
  priority: number;
  /** The measurement behind it, so the ledger can show WHY without re-deriving. */
  evidence: string;
}

/**
 * Metrics the hypothesis proposer keeps asking about and that have no data.
 *
 * `pairs = 0` only. A metric with some pairs but fewer than the floor is
 * waiting on time, and is deliberately NOT reported: the toolsmith cannot make
 * days pass, and telling it to try would burn a build slot every night forever.
 */
export async function starvedMetrics(): Promise<StarvedMetric[]> {
  try {
    const rows = await db.execute<{ metric: string; proposals: number; best_pairs: number }>(sql`
      SELECT metric, COUNT(*)::int AS proposals, COALESCE(MAX(pairs), 0)::int AS best_pairs
      FROM (
        SELECT ${daydreamHypotheses.metricA} AS metric, ${daydreamHypotheses.pairs} AS pairs
          FROM ${daydreamHypotheses}
          WHERE ${daydreamHypotheses.verdict} = 'underpowered'
            AND ${daydreamHypotheses.subject} = ${DEFAULT_SUBJECT}
        UNION ALL
        SELECT ${daydreamHypotheses.metricB}, ${daydreamHypotheses.pairs}
          FROM ${daydreamHypotheses}
          WHERE ${daydreamHypotheses.verdict} = 'underpowered'
            AND ${daydreamHypotheses.subject} = ${DEFAULT_SUBJECT}
      ) t
      WHERE metric IS NOT NULL
      GROUP BY metric
      HAVING COUNT(*) >= ${MIN_PROPOSALS} AND COALESCE(MAX(pairs), 0) = 0
      ORDER BY COUNT(*) DESC
    `);
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    return (list as Array<{ metric: string; proposals: number; best_pairs: number }>).map((r) => ({
      metric: String(r.metric),
      proposals: Number(r.proposals),
      bestPairs: Number(r.best_pairs),
    }));
  } catch (err) {
    console.error('[daydream] starvedMetrics failed:', errMsg(err));
    return [];
  }
}

/**
 * Sources that registered a signal and then never recorded a reading.
 *
 * Distinct from a young signal: `firstSeenAt` older than `SILENT_SOURCE_DAYS`
 * with `observedDays` still zero means the registration worked and the
 * collection never did. That is a broken source, not a patient one.
 */
export async function silentSources(now: Date = new Date()): Promise<Array<{ source: string; signals: number }>> {
  const cutoff = new Date(now.getTime() - SILENT_SOURCE_DAYS * 86_400_000);
  try {
    const rows = await db
      .select({
        source: daydreamSignals.source,
        signals: sql<number>`count(*)::int`,
      })
      .from(daydreamSignals)
      .where(
        sql`${daydreamSignals.status} = 'active'
            AND ${daydreamSignals.observedDays} = 0
            AND ${daydreamSignals.firstSeenAt} < ${cutoff}`,
      )
      .groupBy(daydreamSignals.source);
    return rows.map((r) => ({ source: String(r.source), signals: Number(r.signals) }));
  } catch (err) {
    console.error('[daydream] silentSources failed:', errMsg(err));
    return [];
  }
}

/** Turn a starved metric into an idea the toolsmith can act on. */
export function metricIdea(m: StarvedMetric): StarvationIdea {
  return {
    title: `A source for ${m.metric}`,
    detail:
      `Daydreaming has proposed ${m.proposals} hypotheses about "${m.metric}" and every one came back ` +
      `underpowered with ZERO overlapping days — not too few, none at all. Nothing writes this metric into ` +
      `the day-feature store, so every question about it dies untested. Build a tool that reads ${m.metric} ` +
      `and returns it as a plain number, taking no required arguments, so the daily signal sweep can sample ` +
      `it. It will be correlated automatically once it has enough days.`,
    kind: 'tool',
    // Ahead of question-mined ideas by default: this one has a caller waiting.
    priority: 2,
    evidence: `${m.proposals} underpowered hypotheses, best pairs ${m.bestPairs}`,
  };
}

function sourceIdea(s: { source: string; signals: number }): StarvationIdea {
  return {
    title: `The ${s.source} signal source records nothing`,
    detail:
      `${s.signals} signal(s) from "${s.source}" were registered more than ${SILENT_SOURCE_DAYS} days ago and ` +
      `have never recorded a single observation. Registration worked and collection did not. Investigate the ` +
      `collector for this source, or build a tool that reads it directly.`,
    kind: 'tool',
    priority: 1,
    evidence: `${s.signals} signal(s), 0 observed days after ${SILENT_SOURCE_DAYS}+ days`,
  };
}

/**
 * Everything daydreaming wanted to know and could not, as buildable ideas.
 *
 * Never throws — this feeds a nightly phase, and a starvation query that fails
 * must cost the engine its best ideas, not its run.
 */
export async function collectStarvation(now: Date = new Date()): Promise<StarvationIdea[]> {
  const [metrics, sources] = await Promise.all([starvedMetrics(), silentSources(now)]);
  return [...sources.map(sourceIdea), ...metrics.map(metricIdea)].slice(0, MAX_IDEAS);
}
