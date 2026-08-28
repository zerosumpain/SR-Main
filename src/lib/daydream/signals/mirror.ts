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

/**
 * The feature-store columns worth correlating, with the units they are in.
 *
 * Identifiers, coverage fractions and the `sources` map are deliberately absent
 * — they describe the record rather than the day. `trailFixes` is out for the
 * same reason `placesVisited` had to be fixed: it measures how much we looked,
 * not what happened.
 */
export const MIRRORED_FEATURES: ReadonlyArray<{
  column: string;
  label: string;
  unit: string | null;
}> = [
  { column: 'steps', label: 'Steps', unit: 'steps' },
  { column: 'activeEnergyKj', label: 'Active energy', unit: 'kJ' },
  { column: 'meanHeartRate', label: 'Mean heart rate', unit: 'bpm' },
  { column: 'hrvMs', label: 'HRV', unit: 'ms' },
  { column: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm' },
  { column: 'recoveryScore', label: 'Recovery', unit: '%' },
  { column: 'strain', label: 'Strain', unit: null },
  { column: 'sleepMinutes', label: 'Sleep', unit: 'min' },
  { column: 'sleepPerformance', label: 'Sleep performance', unit: '%' },
  { column: 'sleepEfficiency', label: 'Sleep efficiency', unit: '%' },
  { column: 'disturbanceCount', label: 'Sleep disturbances', unit: null },
  { column: 'workouts', label: 'Workouts', unit: null },
  { column: 'activeMinutes', label: 'Active minutes', unit: 'min' },
  { column: 'activityDistanceM', label: 'Activity distance', unit: 'm' },
  { column: 'minutesAtHome', label: 'Time at home', unit: 'min' },
  { column: 'minutesOut', label: 'Time out', unit: 'min' },
  { column: 'placesVisited', label: 'Visits', unit: null },
  { column: 'distinctPlaces', label: 'Distinct places', unit: null },
  { column: 'firstOutAtMins', label: 'First out', unit: 'min past midnight' },
  { column: 'lastHomeAtMins', label: 'Last home', unit: 'min past midnight' },
  { column: 'calendarEvents', label: 'Calendar events', unit: null },
  { column: 'calendarBusyMinutes', label: 'Calendar busy time', unit: 'min' },
  { column: 'verifiedSpendMinor', label: 'Verified spend', unit: 'p' },
];

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
