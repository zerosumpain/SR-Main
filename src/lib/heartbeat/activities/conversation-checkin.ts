import { db } from '$lib/db';
import { orchestratorChats, heartbeatPulses } from '$lib/db/schema';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { listJobs } from '$lib/workflows/chat/job-store';
import { postHeartbeatNote } from '../llm';
import type { ActivityHandler } from '../types';

const NAME = 'conversation-checkin';

interface CCIConfig {
  /** Job must be running this long before we add a checkin. */
  jobAgeMinThresholdMinutes?: number;
  /** Don't checkin if the job has produced output more recently than this. */
  freshnessThresholdMinutes?: number;
  /** Per-conversation cooldown so we don't spam during a long task. */
  perConversationCooldownMinutes?: number;
  /** Max checkins per tick. */
  maxCheckinsPerTick?: number;
}

const DEFAULTS: Required<CCIConfig> = {
  jobAgeMinThresholdMinutes: 5,
  freshnessThresholdMinutes: 3,
  perConversationCooldownMinutes: 7,
  maxCheckinsPerTick: 5,
};

/**
 * Drops a "still working — current step is X" note into a conversation
 * during a long-running orchestrator job, so a user who navigated away
 * sees progress when they return.
 */
export const conversationCheckin: ActivityHandler = {
  name: NAME,
  description:
    "Drops a status note into a conversation during a long-running chat job (>5 min). Surfaces the current phase and elapsed time so a user who's navigated away sees progress on return.",
  defaultCadenceSeconds: 300,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as CCIConfig) };
    const ageThresholdMs = cfg.jobAgeMinThresholdMinutes * 60_000;
    const freshThresholdMs = cfg.freshnessThresholdMinutes * 60_000;
    const cooldownMs = cfg.perConversationCooldownMinutes * 60_000;
    const now = ctx.now;

    const jobs = listJobs().filter(
      (j) => j.status === 'running' && j.conversationId && j.elapsed >= ageThresholdMs,
    );
    if (jobs.length === 0) {
      return { outcome: 'ok', summary: 'no long-running jobs' };
    }

    // Skip jobs whose conversation has had ANY message in the last freshnessThreshold.
    // (If the orchestrator emitted a status_update or token-stream landed text,
    // we don't need a heartbeat checkin too.)
    const convIds = jobs.map((j) => j.conversationId as string);
    const recentMsgs = await db
      .select({ conversationId: orchestratorChats.conversationId, ts: orchestratorChats.createdAt })
      .from(orchestratorChats)
      .where(
        and(
          isNotNull(orchestratorChats.conversationId),
          gt(orchestratorChats.createdAt, new Date(now - freshThresholdMs)),
        ),
      );
    const recentlyActiveConvIds = new Set(
      recentMsgs.map((m) => m.conversationId).filter((v): v is string => !!v),
    );

    // Cooldown via heartbeat_pulses for this activity.
    const recentPulses = await db
      .select({ conversationId: heartbeatPulses.conversationId, ts: heartbeatPulses.ts })
      .from(heartbeatPulses)
      .where(
        and(
          eq(heartbeatPulses.actionId, ctx.action.id),
          gt(heartbeatPulses.ts, new Date(now - cooldownMs)),
        ),
      );
    const recentlyPulsed = new Set(
      recentPulses.map((p) => p.conversationId).filter((v): v is string => !!v),
    );

    let nudges = 0;
    const acted: Array<{ convId: string; jobId: string; phase: string; minsElapsed: number }> = [];
    for (const j of jobs) {
      if (nudges >= cfg.maxCheckinsPerTick) break;
      const cid = j.conversationId as string;
      if (recentlyActiveConvIds.has(cid)) continue;
      if (recentlyPulsed.has(cid)) continue;
      const minsElapsed = Math.round(j.elapsed / 60_000);
      const step = j.currentStep ?? j.phase;
      await postHeartbeatNote({
        conversationId: cid,
        text: `[heartbeat] still working — ${step} (${minsElapsed} min so far).`,
        activityName: NAME,
      });
      acted.push({ convId: cid, jobId: j.id, phase: j.phase, minsElapsed });
      nudges++;
    }

    if (acted.length === 0) {
      return { outcome: 'ok', summary: 'all long jobs already updated recently or in cooldown' };
    }
    return {
      outcome: 'fired',
      summary: `${acted.length} checkin${acted.length === 1 ? '' : 's'} sent`,
      details: { acted },
      conversationId: acted.length === 1 ? acted[0].convId : null,
      jobId: acted.length === 1 ? acted[0].jobId : null,
    };
  },
};
