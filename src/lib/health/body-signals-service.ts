import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { gte, eq, desc } from 'drizzle-orm';
import type { BodySignal } from './types';

const SIGNAL_METRICS = [
  { name: 'heart_rate', unit: 'bpm', divideBy: 100 },
  { name: 'heart_rate_variability', unit: 'ms', divideBy: 100 },
  { name: 'resting_heart_rate', unit: 'bpm', divideBy: 100 },
  { name: 'oxygen_saturation', unit: '%', divideBy: 100 },
  { name: 'respiratory_rate', unit: 'br/min', divideBy: 100 },
];

export async function getBodySignals(): Promise<BodySignal[]> {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  const signals: BodySignal[] = [];

  for (const metric of SIGNAL_METRICS) {
    const records = await db.select()
      .from(appleHealthMetrics)
      .where(gte(appleHealthMetrics.date, sevenDaysAgo))
      .where(eq(appleHealthMetrics.metricName, metric.name))
      .orderBy(desc(appleHealthMetrics.date));

    if (!records.length) continue;

    const values = records.map(r => (r.value || 0) / metric.divideBy);
    const current = values[0];
    const average7d = Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10;
    const trend = current > average7d * 1.05 ? 'up' : current < average7d * 0.95 ? 'down' : 'stable';

    signals.push({ metric: metric.name, current, average7d, trend, unit: metric.unit });
  }

  return signals;
}
