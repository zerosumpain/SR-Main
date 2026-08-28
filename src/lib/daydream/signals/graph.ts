// src/lib/daydream/signals/graph.ts
//
// The knowledge graph, republished as daily numbers.
//
// Until now the graph reached thoughts and the ponder pack and touched the
// sweep not at all, because a sweep correlates a number per day and a graph is
// entities and edges. This makes the missing number: not the graph itself, but
// how much of it CHANGED each day.
//
// That is a real daily series and a genuinely interesting one — "the days the
// mailbox brings a lot of new people are the days you sleep badly" is a
// question the sweep can now answer and previously could not even ask.
//
// ── Rates, not totals — and this is the whole design ────────────────────────
//
// Every cumulative count is excluded on purpose. `entities_total` only ever
// rises, and the sweep's default is Spearman, which is rank-based: a
// monotonically increasing series rank-correlates ~1.0 with time and therefore
// with EVERY other series that happens to trend. Publishing four cumulative
// totals would be a spurious-correlation factory that the false-discovery
// correction then has to spend its budget mopping up.
//
// So the levels published here are only the ones that genuinely go both ways —
// open insights get dismissed, watchlists get pruned — and everything else is
// a daily delta.
//
// ── Not in the proposer's vocabulary ───────────────────────────────────────
//
// `SWEEP_METRICS` is untouched (the owner's instruction, 2026-08-28). The
// registry feeds the SWEEP, which is a different thing: the sweep tests
// everything with enough days and corrects across the lot, while the proposer
// is shown a fixed short list and never the correlations — and that blind
// pre-registration is what makes a q-value mean anything over ~4 tests rather
// than ~276. Widening the vocabulary would void it. Widening the registry
// does not.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { LOCAL_TZ } from '../types';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

/** A daily delta: how many rows a table gained on a given local day. */
interface RateSpec {
  id: string;
  label: string;
  /** Table and the timestamp column that dates a row. */
  table: string;
  column: string;
  /** Optional SQL predicate, already safe — these are literals in this file. */
  where?: string;
}

/**
 * The rates.
 *
 * Each is "new rows on this day", which is activity rather than accumulation.
 * `notes_admitted` is separate from `notes_added` deliberately: the gap between
 * them IS the graph gate doing its job, and a day where the mailbox was busy
 * but nothing was admitted is a different day from a quiet one.
 */
const RATES: ReadonlyArray<RateSpec> = [
  {
    id: 'entities_added',
    label: 'New entities in the graph',
    table: 'intel_entities',
    column: 'created_at',
    where: 'merged_into_id is null',
  },
  {
    id: 'relationships_added',
    label: 'New relationships in the graph',
    table: 'intel_relationships',
    column: 'created_at',
  },
  {
    id: 'notes_added',
    label: 'New source notes',
    table: 'intel_notes',
    column: 'coalesce(observed_at, created_at)',
  },
  {
    id: 'notes_admitted',
    label: 'Notes admitted to the graph',
    table: 'intel_notes',
    column: 'coalesce(observed_at, created_at)',
    where: "graph_state = 'admitted'",
  },
  {
    id: 'timeline_events_added',
    label: 'New dated events extracted',
    table: 'intel_timeline_events',
    column: 'created_at',
  },
  {
    id: 'insights_created',
    label: 'New graph findings',
    table: 'intel_insights',
    column: 'created_at',
  },
];

/**
 * The levels — and only the ones that can fall as well as rise.
 *
 * A monotonic level is excluded for the reason in the header. These two are
 * genuinely bidirectional: an insight moves off `new` when it is seen,
 * dismissed or bridged, and a watchlist is pruned as well as extended.
 *
 * Both are stamped at the moment the job runs rather than reconstructed, so
 * they have no history and start accruing days from today. That is honest —
 * the tables record no "was watched on" history to reconstruct one from, and
 * inventing a backfill for them would be inventing data.
 */
const LEVELS: ReadonlyArray<{ id: string; label: string; sql: string }> = [
  {
    id: 'insights_open',
    label: 'Findings waiting to be looked at',
    sql: "select count(*)::int as n from intel_insights where status = 'new'",
  },
  {
    id: 'entities_watched',
    label: 'Entities on the watchlist',
    sql: 'select count(*)::int as n from intel_entities where watched = true and merged_into_id is null',
  },
];

export const GRAPH_SPECS: SignalSpec[] = [
  ...RATES.map((r) => ({
    key: signalKey('graph', r.id),
    source: 'graph',
    label: r.label,
    unit: null,
    valueKind: 'numeric' as const,
  })),
  ...LEVELS.map((l) => ({
    key: signalKey('graph', l.id),
    source: 'graph',
    label: l.label,
    unit: null,
    valueKind: 'numeric' as const,
  })),
];

/** How far back to reconstruct the rates. The graph has months of history and
 *  the rows carry their own timestamps, so these series arrive already old
 *  enough to be swept rather than waiting a fortnight to say anything. */
export const GRAPH_BACKFILL_DAYS = 120;

const localDayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ }).format(d);

/**
 * Republish the graph's daily activity as signals.
 *
 * `setObservations`, not `recordObservations`: a day's counts are recomputed
 * whole from the source tables on every run, so folding would compound the
 * same day into itself. Same reasoning as the journey and feature mirrors.
 *
 * A quiet day inside a source's lifetime writes a real ZERO — the tables were
 * readable and nothing arrived. A day before that source ever produced
 * anything is left ABSENT, because the ingest was not running and "nothing
 * arrived" would be a claim nobody measured. Absence and zero mean different
 * things everywhere else in this engine and they mean different things here.
 */
export async function buildGraphSignals(
  opts: { windowDays?: number; now?: Date } = {},
): Promise<{ signals: number; days: number; written: number; errors: string[] }> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? GRAPH_BACKFILL_DAYS;
  const errors: string[] = [];

  await registerSignals(GRAPH_SPECS);

  const days: string[] = [];
  for (let i = windowDays; i >= 0; i--) {
    days.push(localDayOf(new Date(now.getTime() - i * 86_400_000)));
  }
  const byDay = new Map<string, Reading[]>(days.map((d) => [d, []]));

  // ── Rates: one grouped count per table, bucketed by LOCAL day ──
  for (const rate of RATES) {
    try {
      const rows = (
        await db.execute(
          sql.raw(
            `select to_char(${rate.column} at time zone '${LOCAL_TZ}', 'YYYY-MM-DD') as day,
                    count(*)::int as n
               from ${rate.table}
              where ${rate.column} >= now() - interval '${windowDays + 1} days'
                ${rate.where ? `and ${rate.where}` : ''}
              group by 1`,
          ),
        )
      ).rows as Array<{ day: string; n: number }>;

      const counts = new Map(rows.map((r) => [String(r.day), Number(r.n)]));
      const key = signalKey('graph', rate.id);

      // Zero-fill only from this signal's OWN first day forward.
      //
      // A quiet day inside a source's lifetime is a real zero — the tables
      // were readable and nothing arrived. A day BEFORE it ever produced
      // anything is absent, not zero: the ingest was not running, and saying
      // "0 findings were raised" about it would be an assertion nobody
      // measured. `insights_created` has 9 days of history against a 120-day
      // window, so this is the difference between 9 honest observations and
      // 111 invented ones.
      //
      // It also matters statistically. Two series padded with the same 90
      // zeros rank-correlate strongly on the padding alone, which is exactly
      // the kind of arithmetic-not-observation finding the correction should
      // never have to spend its budget on.
      const first = rows.length
        ? rows.map((r) => String(r.day)).sort()[0]
        : null;
      if (!first) continue;
      for (const day of days) {
        if (day < first) continue;
        byDay.get(day)?.push({ key, value: counts.get(day) ?? 0 });
      }
    } catch (err) {
      // One unreadable table must not lose the other five.
      errors.push(`${rate.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Levels: today only. There is no history to reconstruct. ──
  const today = localDayOf(now);
  for (const level of LEVELS) {
    try {
      const rows = (await db.execute(sql.raw(level.sql))).rows as Array<{ n: number }>;
      const n = Number(rows[0]?.n ?? 0);
      if (Number.isFinite(n)) {
        byDay.get(today)?.push({ key: signalKey('graph', level.id), value: n });
      }
    } catch (err) {
      errors.push(`${level.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let written = 0;
  for (const [day, readings] of byDay) {
    if (readings.length === 0) continue;
    written += await setObservations(day, readings);
  }

  return { signals: GRAPH_SPECS.length, days: days.length, written, errors };
}
