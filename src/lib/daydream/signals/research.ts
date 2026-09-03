// src/lib/daydream/signals/research.ts
//
// Research and the timeline as daily signals.
//
// The deep-dive engine writes sessions, facts and narrative items; the intel
// extractor writes dated events. None of it reached the sweep. Each becomes
// "how much of this happened on a local day" — activity, not accumulation —
// the same shape `graph.ts` uses, so a registered series joins the sweep at
// `MIN_PAIRS` days like every other and nothing hand-writes a list.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { LOCAL_TZ } from '../types';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

export const SOURCE = 'research';

interface RateSpec {
  id: string;
  label: string;
  table: string;
  /** The timestamp (or date text) column that dates a row. */
  column: string;
  /** `timestamp` columns are cast to the local day; `text` date columns are used as they are. */
  columnKind: 'timestamp' | 'date-text';
  where?: string;
  /** `count` rows per day, or `avg` this numeric column per day. */
  agg?: { kind: 'avg'; column: string };
}

const RATES: ReadonlyArray<RateSpec> = [
  { id: 'sessions_started', label: 'Research sessions started', table: 'research_session', column: 'created_at', columnKind: 'timestamp' },
  { id: 'facts_discovered', label: 'Research facts discovered', table: 'fact', column: 'discovered_at', columnKind: 'timestamp' },
  { id: 'facts_confidence', label: 'Mean confidence of the day’s research facts', table: 'fact', column: 'discovered_at', columnKind: 'timestamp', agg: { kind: 'avg', column: 'confidence' } },
  { id: 'narrative_items', label: 'Research narrative items written', table: 'narrative_item', column: 'created_at', columnKind: 'timestamp' },
  // Events DATED on a day — the diary the graph has extracted, as distinct
  // from `graph:timeline_events_added`, which counts the day they were found.
  { id: 'timeline_events_dated', label: 'Graph events dated on this day', table: 'intel_timeline_events', column: 'date', columnKind: 'date-text' },
];

export const RESEARCH_SPECS: SignalSpec[] = RATES.map((r) => ({
  key: signalKey(SOURCE, r.id),
  source: SOURCE,
  label: r.label,
  unit: r.agg ? 'score' : 'count',
  valueKind: 'numeric',
}));

/** Register the specs and write the last `days` days. Idempotent. */
export async function buildResearchSignals(opts: { days?: number; now?: Date } = {}): Promise<{ days: number; readings: number; errors: string[] }> {
  const days = opts.days ?? 30;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const errors: string[] = [];
  await registerSignals(RESEARCH_SPECS);

  const byDay = new Map<string, Reading[]>();
  for (const r of RATES) {
    try {
      const dayExpr =
        r.columnKind === 'timestamp'
          ? `(${r.column} at time zone '${LOCAL_TZ}')::date`
          : `nullif(left(${r.column}, 10), '')::date`;
      const valueExpr = r.agg ? `avg((${r.agg.column})::double precision)` : 'count(*)::int';
      const where = [
        r.columnKind === 'timestamp' ? `${r.column} >= '${since.toISOString()}'` : `left(${r.column}, 10) >= '${since.toISOString().slice(0, 10)}'`,
        r.where,
      ]
        .filter(Boolean)
        .join(' and ');
      const rows = (await db.execute(sql.raw(`select ${dayExpr} as day, ${valueExpr} as value from ${r.table} where ${where} group by 1`))).rows as Array<{ day: Date | string | null; value: number | string | null }>;
      for (const row of rows) {
        if (!row.day || row.value == null) continue;
        const day = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
        const value = Number(row.value);
        if (!Number.isFinite(value)) continue;
        const list = byDay.get(day) ?? [];
        list.push({ key: signalKey(SOURCE, r.id), subject: 'household', value });
        byDay.set(day, list);
      }
    } catch (err) {
      errors.push(`${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let readings = 0;
  for (const [day, list] of byDay) readings += await setObservations(day, list);
  return { days: byDay.size, readings, errors };
}
