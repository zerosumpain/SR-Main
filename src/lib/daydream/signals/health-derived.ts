// src/lib/daydream/signals/health-derived.ts
//
// The /health hub's derived layer as daily signals — tripwires tripped and
// close, moves on the table, whether an experiment is live, and the volume
// week. Whoop and Apple numbers were already in the feature store; the
// hub's OWN conclusions about them were not. Sampled once a day: the
// assembly behind it is nine service calls.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamObservations } from '$lib/db/schema';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

export const SOURCE = 'health';

const FIELDS = [
  { id: 'tripwires_tripped', label: 'Health tripwires tripped', unit: 'count' },
  { id: 'tripwires_close', label: 'Health tripwires close to tripping', unit: 'count' },
  { id: 'moves', label: 'Ranked moves the health hub proposes', unit: 'count' },
  { id: 'experiment_live', label: 'A health experiment is live', unit: 'flag' },
  { id: 'experiments_queued', label: 'Health experiments queued', unit: 'count' },
  { id: 'acwr_forecast_delta', label: 'Projected change in training-load ratio', unit: 'ratio' },
  { id: 'volume_week_km', label: 'Last complete week’s distance', unit: 'km' },
] as const;

export const HEALTH_DERIVED_SPECS: SignalSpec[] = FIELDS.map((f) => ({
  key: signalKey(SOURCE, f.id),
  source: SOURCE,
  label: f.label,
  unit: f.unit,
  valueKind: f.unit === 'flag' ? 'boolean' : 'numeric',
}));

export async function healthSampledToday(day: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(daydreamObservations)
    .where(and(eq(daydreamObservations.day, day), sql`${daydreamObservations.signalKey} like ${`${SOURCE}:%`}`));
  return (row?.n ?? 0) > 0;
}

export async function buildHealthDerivedSignals(day: string): Promise<{ sampled: boolean; readings: number; error: string | null }> {
  try {
    const { computeHealthDerived } = await import('$lib/health/derived.server');
    const d = await computeHealthDerived();
    await registerSignals(HEALTH_DERIVED_SPECS);
    const readings: Reading[] = [
      { key: signalKey(SOURCE, 'tripwires_tripped'), subject: 'john', value: d.tripwiresTripped },
      { key: signalKey(SOURCE, 'tripwires_close'), subject: 'john', value: d.tripwiresClose },
      { key: signalKey(SOURCE, 'moves'), subject: 'john', value: d.moves },
      { key: signalKey(SOURCE, 'experiment_live'), subject: 'john', value: d.experimentLive },
      { key: signalKey(SOURCE, 'experiments_queued'), subject: 'john', value: d.experimentsQueued },
    ];
    if (d.acwrForecastDelta != null) readings.push({ key: signalKey(SOURCE, 'acwr_forecast_delta'), subject: 'john', value: d.acwrForecastDelta });
    if (d.volumeWeekKm != null) readings.push({ key: signalKey(SOURCE, 'volume_week_km'), subject: 'john', value: d.volumeWeekKm });
    const n = await setObservations(day, readings);
    return { sampled: true, readings: n, error: null };
  } catch (err) {
    return { sampled: false, readings: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
