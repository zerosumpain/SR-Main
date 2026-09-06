// src/lib/daydream/signals/mirror.ts
//
// The feature store, republished as signals.
//
// `daydream_day_features` is not going anywhere: it describes itself as "a
// cache with opinions, not a record", every hypothesis and card reads it, and
// its per-domain `sources` column carries the coverage semantics that make a
// correlation honest. What it cannot do is grow without a migration.
//
// So rather than a migration and a flag day, its columns are mirrored into the
// observation store as `feature:*` signals. The sweep then has ONE place to
// read from and does not care whether a series came from a hand-written column
// or from a sensor discovered this morning.
//
// Deliberately `setObservations`, not `recordObservations`: a feature-store row
// is one settled value for a day, so re-running the mirror must overwrite it.
// Folding it into a running mean would drift the value toward itself while
// `samples` climbed, which would then misreport how well observed the day was.

import { and, gte, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures } from '$lib/db/schema';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

import { MIRRORED_FEATURES } from '../features/metrics';
export { MIRRORED_FEATURES } from '../features/metrics';

export const MIRRORED_SPECS: SignalSpec[] = MIRRORED_FEATURES.map((f) => ({
  key: signalKey('feature', f.column),
  source: 'feature',
  label: f.label,
  unit: f.unit,
  valueKind: 'numeric',
}));

/**
 * Copy a window of the feature store into the observation store.
 *
 * Idempotent and cheap enough to run whole rather than incrementally — the same
 * argument `refreshPlaces` makes about full recomputes: an incremental mirror
 * would need to know which rows changed, and the feature builder rewrites days
 * retrospectively as late health data lands.
 */
export async function mirrorFeatures(opts: { windowDays?: number; subject?: string } = {}): Promise<{
  days: number;
  written: number;
}> {
  const windowDays = opts.windowDays ?? 400;
  const from = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

  await registerSignals(MIRRORED_SPECS);

  const where = opts.subject
    ? and(gte(daydreamDayFeatures.day, from), eq(daydreamDayFeatures.subject, opts.subject))
    : gte(daydreamDayFeatures.day, from);

  const rows = (await db.select().from(daydreamDayFeatures).where(where)) as unknown as Array<
    Record<string, unknown>
  >;

  let written = 0;
  for (const row of rows) {
    const day = String(row.day);
    const subject = String(row.subject ?? 'john');
    const readings: Reading[] = [];
    for (const f of MIRRORED_FEATURES) {
      const v = row[f.column];
      if (v == null) continue; // absent stays absent — never a zero
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      readings.push({ key: signalKey('feature', f.column), subject, value: n });
    }
    written += await setObservations(day, readings);
  }

  return { days: rows.length, written };
}
