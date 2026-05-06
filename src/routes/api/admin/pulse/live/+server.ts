import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listJobs } from '$lib/workflows/chat/job-store';
import { getQueueStatus } from '$lib/workflows/chat/followup-queue';
import { getRuntimeStats, readEventLoopMaxMs } from '$lib/workflows/engine-runtime';
import { getActiveJobs } from '$lib/workflows/scheduler';
import { db } from '$lib/db';
import { workflowRuns, workflows, healthSyncState } from '$lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';

/**
 * Live Pulse snapshot — everything that's currently in-flight or
 * recently warm. Polled from the admin Pulse page every few seconds.
 *
 * Sources, in order of volatility:
 *   1. Orchestrator chat jobs — in-memory job-store (lost on restart)
 *   2. Follow-up queue — in-memory (lost on restart)
 *   3. Active workflow runs — workflow_runs WHERE status=running/paused/pending
 *   4. Cron schedule registrations — in-memory croner Map (lives in src/lib/workflows/scheduler.ts)
 *   5. Engine health — event-loop monitor + run slot counters
 *   6. Health sync state — latest tick per service from health_sync_state
 */
export const GET: RequestHandler = async () => {
  const orchestratorJobs = listJobs().map((j) => ({
    id: j.id,
    status: j.status,
    phase: j.phase,
    currentStep: j.currentStep ?? null,
    elapsedMs: j.elapsed,
    startedAt: j.startedAt,
    lastEventAt: j.lastEventAt,
    lastHeartbeatAt: j.lastHeartbeatAt,
    workflowId: j.workflowId ?? null,
    conversationId: j.conversationId ?? null,
    chatNodeId: j.chatNodeId ?? null,
    message: j.message.slice(0, 200),
  }));

  const followUps = getQueueStatus();

  const activeRunRows = await db
    .select()
    .from(workflowRuns)
    .where(inArray(workflowRuns.status, ['running', 'paused', 'pending']))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(50);

  const wfIds = Array.from(new Set(activeRunRows.map((r) => r.workflowId)));
  const wfNames = wfIds.length
    ? await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(inArray(workflows.id, wfIds))
    : [];
  const nameById = Object.fromEntries(wfNames.map((w) => [w.id, w.name]));

  const activeRuns = activeRunRows.map((r) => ({
    id: r.id,
    workflowId: r.workflowId,
    workflowName: nameById[r.workflowId] ?? '(unknown)',
    status: r.status,
    trigger: r.trigger,
    startedAt: r.startedAt,
    heartbeatAt: r.heartbeatAt,
    pausedAtNodeId: r.pausedAtNodeId,
  }));

  const cronJobs = Array.from(getActiveJobs().entries()).map(([scheduleId, cron]) => {
    let nextRunMs: number | null = null;
    try {
      const next = cron.nextRun();
      nextRunMs = next ? next.getTime() : null;
    } catch {
      // ignore — cron may have stopped
    }
    return { scheduleId, nextRunMs, paused: !cron.isRunning() };
  });

  const stats = getRuntimeStats();
  const loopMaxMs = readEventLoopMaxMs();

  const healthSyncs = await db.select().from(healthSyncState);

  return json({
    now: Date.now(),
    orchestratorJobs,
    followUps,
    activeRuns,
    cronJobs,
    engine: {
      activeRuns: stats.activeRuns,
      queued: stats.queued,
      cap: stats.cap,
      loopMaxMs,
    },
    healthSync: healthSyncs.map((s) => ({
      service: s.service,
      status: s.status,
      lastSyncAt: s.lastSyncAt,
      lastSuccessfulSyncAt: s.lastSuccessfulSyncAt,
      recordsSynced: s.recordsSynced,
      errorMessage: s.errorMessage,
    })),
  });
};
