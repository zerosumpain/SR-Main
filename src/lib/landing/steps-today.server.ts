// steps-today.server.ts — today's steps as a strip of quarter-hours, for the
// landing sentence's steps footnote: midnight on the left, 23:59 on the right.
//
// Reads the same Apple Health `step_count` samples, over the same local day
// (heroDayBounds, the health timezone), that the step total has always used, so
// the strip and the total cannot disagree. Quarter-hour bins rather than raw
// samples: enough to show the shape of a day, too coarse to time a doorstep.

import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { fromStoredMetric } from '$lib/constants/apple-health-scale';
import { heroDayBounds } from '$lib/server/hero-slot-policy';

import { binSteps, type StepsToday } from './steps';

export type { StepsToday };

export async function stepsToday(now = new Date()): Promise<StepsToday> {
  const bounds = heroDayBounds(now);
  const nowSec = Math.floor(now.getTime() / 1000);
  const rows = await db
    .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(
      and(
        eq(appleHealthMetrics.metricName, 'step_count'),
        gte(appleHealthMetrics.date, bounds.start),
        lt(appleHealthMetrics.date, Math.min(bounds.end, nowSec + 1)),
      ),
    )
    .catch(() => []);
  return binSteps(
    rows.flatMap((r) =>
      typeof r.value === 'number' ? [{ date: r.date, steps: Math.round(fromStoredMetric(r.value)) }] : [],
    ),
    bounds,
    nowSec,
  );
}
