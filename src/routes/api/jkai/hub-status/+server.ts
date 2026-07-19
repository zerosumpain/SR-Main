import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowSchedules } from '$lib/db/schema';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { listJobs } from '$lib/workflows/chat/job-store';
import { MONITORS_COLLECTION } from '$lib/monitors/monitors.server';
import { BRIEFINGS_COLLECTION, briefingDateLabel } from '$lib/briefing/types';

/**
 * Lightweight live status for the JKAI launcher badges + the activity strip.
 * Owner-gated by hooks. Kept CHEAP (no per-monitor joins) because the activity
 * strip polls it. Every branch is best-effort.
 */
export const GET: RequestHandler = async () => {
  // Monitors — marker count + enabled-schedule count (2 cheap queries).
  const monitors = { active: 0, total: 0 };
  try {
    if (await getCollectionBySlug(MONITORS_COLLECTION)) {
      const { records } = await queryRecords(MONITORS_COLLECTION, { limit: 200 }, 'owner');
      const ids = records.map((r) => (r.data as { workflowId?: string }).workflowId).filter((x): x is string => !!x);
      monitors.total = ids.length;
      if (ids.length) {
        const rows = await db.select({ enabled: workflowSchedules.enabled }).from(workflowSchedules).where(inArray(workflowSchedules.workflowId, ids));
        monitors.active = rows.filter((r) => r.enabled).length;
      }
    }
  } catch {
    /* omit */
  }

  // Latest briefing date.
  let briefing: { latest: string | null } = { latest: null };
  try {
    if (await getCollectionBySlug(BRIEFINGS_COLLECTION)) {
      const { records } = await queryRecords(BRIEFINGS_COLLECTION, { sort: { field: 'createdAt', dir: 'desc' }, limit: 1 }, 'owner');
      const first = records[0]?.data as { startedAt?: string } | undefined;
      if (first?.startedAt) briefing = { latest: briefingDateLabel(new Date(first.startedAt)) };
    }
  } catch {
    /* omit */
  }

  // Live activity — running orchestrator jobs (in-memory) + next scheduled run.
  const activity: { runningJobs: number; currentStep: string | null; nextRun: string | null } = {
    runningJobs: 0,
    currentStep: null,
    nextRun: null,
  };
  try {
    const running = listJobs().filter((j) => j.status === 'running');
    activity.runningJobs = running.length;
    activity.currentStep = running[0]?.currentStep ?? running[0]?.phase ?? null;
  } catch {
    /* omit */
  }
  try {
    const [next] = await db
      .select({ n: workflowSchedules.nextRunAt })
      .from(workflowSchedules)
      .where(and(eq(workflowSchedules.enabled, true), gt(workflowSchedules.nextRunAt, new Date())))
      .orderBy(asc(workflowSchedules.nextRunAt))
      .limit(1);
    if (next?.n) activity.nextRun = next.n.toISOString();
  } catch {
    /* omit */
  }

  return json({ monitors, briefing, activity });
};
