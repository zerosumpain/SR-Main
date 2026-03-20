import { getAllPosts } from '$lib/blog';
import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const [posts, stepsRows] = await Promise.all([
    getAllPosts().then(p => p.slice(0, 5)).catch(() => []),
    db.select({ value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(and(eq(appleHealthMetrics.metricName, 'step_count'), gte(appleHealthMetrics.date, todayStart)))
      .catch(() => []),
  ]);

  // Steps are stored * 100, sum all readings for today
  const steps = stepsRows.reduce((sum, r) => sum + Math.round((r.value || 0) / 100), 0);

  return { posts, steps };
};
