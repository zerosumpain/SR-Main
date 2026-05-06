import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listJobs, getRecentPulses } from '$lib/workflows/chat/job-store';
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
  // Watchdog thresholds — kept in sync with job-store.ts. Surfacing them
  // as data so the page can show a "X seconds until kill" countdown per job
  // instead of having the user check the source.
  const IDLE_TIMEOUT_MS = 120_000;
  const HARD_TIMEOUT_MS = 600_000;
  const HEARTBEAT_INTERVAL_MS = 5_000;

  const nowMs = Date.now();
  const orchestratorJobs = listJobs().map((j) => {
    const idleMs = nowMs - j.lastEventAt;
    const elapsedMs = j.elapsed;
    const idleKillInMs = Math.max(0, IDLE_TIMEOUT_MS - idleMs);
    const hardKillInMs = Math.max(0, HARD_TIMEOUT_MS - elapsedMs);
    const nextHeartbeatInMs = Math.max(0, HEARTBEAT_INTERVAL_MS - (nowMs - j.lastHeartbeatAt));
    return {
      id: j.id,
      status: j.status,
      phase: j.phase,
      currentStep: j.currentStep ?? null,
      elapsedMs,
      startedAt: j.startedAt,
      lastEventAt: j.lastEventAt,
      lastHeartbeatAt: j.lastHeartbeatAt,
      idleMs,
      idleKillInMs,
      hardKillInMs,
      nextHeartbeatInMs,
      workflowId: j.workflowId ?? null,
      conversationId: j.conversationId ?? null,
      chatNodeId: j.chatNodeId ?? null,
      message: j.message.slice(0, 200),
    };
  });

  const followUps = getQueueStatus().map((f) => {
    const dueInMs = f.dueAt - nowMs;
    // Mirror followup-queue.ts: BACKOFF_MULTIPLIER 1.2, base interval 30s, cap 5min.
    const baseMs = 30_000;
    const projectedNextBackoffMs = Math.min(baseMs * Math.pow(1.2, f.retries + 1), 300_000);
    return { ...f, dueInMs, projectedNextBackoffMs };
  });

  const recentPulses = getRecentPulses().slice(0, 100);

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
    now: nowMs,
    orchestratorJobs,
    followUps,
    activeRuns,
    cronJobs,
    recentPulses,
    thresholds: {
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      hardTimeoutMs: HARD_TIMEOUT_MS,
      followupWorkerIntervalMs: 15_000,
      followupBaseIntervalMs: 30_000,
      followupMaxRetries: 40,
    },
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
