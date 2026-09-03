// src/lib/daydream/signals/segments.ts
//
// Trail segment FORM as a daily signal — how many of his repeated stretches
// are improving, holding or slipping today, and how many are within reach of
// a record. `$lib/health/segment-list`'s `formTaxonomy` already computes the
// counts the /health hub prints; this samples them once a day so the sweep
// can ask whether a slipping week follows a bad sleep week.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamObservations } from '$lib/db/schema';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

export const SOURCE = 'segment';
const SEGMENT_LIMIT = 200;

const FIELDS = [
  { id: 'improving', label: 'Segments improving' },
  { id: 'holding', label: 'Segments holding' },
  { id: 'slipping', label: 'Segments slipping' },
  { id: 'gettable', label: 'Segments within reach of a record' },
  { id: 'with_form', label: 'Segments with enough efforts to read' },
] as const;

export const SEGMENT_SPECS: SignalSpec[] = FIELDS.map((f) => ({
  key: signalKey(SOURCE, f.id),
  source: SOURCE,
  label: f.label,
  unit: 'count',
  valueKind: 'numeric',
}));

/** Once a day: the segment list is four queries over every effort. */
export async function segmentsSampledToday(day: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(daydreamObservations)
    .where(and(eq(daydreamObservations.day, day), sql`${daydreamObservations.signalKey} like ${`${SOURCE}:%`}`));
  return (row?.n ?? 0) > 0;
}

export async function buildSegmentSignals(day: string): Promise<{ sampled: boolean; readings: number; error: string | null }> {
  try {
    const [{ listSegments }, { formTaxonomy }] = await Promise.all([
      import('$lib/trails/segments-service'),
      import('$lib/health/segment-list'),
    ]);
    const res = await listSegments({ limit: SEGMENT_LIMIT });
    const t = formTaxonomy(res.rows);
    await registerSignals(SEGMENT_SPECS);
    const readings: Reading[] = [
      { key: signalKey(SOURCE, 'improving'), subject: 'john', value: t.improving },
      { key: signalKey(SOURCE, 'holding'), subject: 'john', value: t.holding },
      { key: signalKey(SOURCE, 'slipping'), subject: 'john', value: t.slipping },
      { key: signalKey(SOURCE, 'gettable'), subject: 'john', value: t.gettable },
      { key: signalKey(SOURCE, 'with_form'), subject: 'john', value: t.withForm },
    ];
    const n = await setObservations(day, readings);
    return { sampled: true, readings: n, error: null };
  } catch (err) {
    return { sampled: false, readings: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
