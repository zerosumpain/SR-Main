import { db } from '$lib/db';
import { heartbeatPulses } from '$lib/db/schema';
import { and, eq, gt, sql } from 'drizzle-orm';
import { postHeartbeatNote } from '../llm';
import type { ActivityHandler } from '../types';

const NAME = 'build-progress-check';

interface BPCConfig {
  /** Skip builds whose updatedAt is fresher than this (no point nudging). */
  staleMinutes?: number;
  /** Per-build cooldown — minimum gap between heartbeat notes. */
  perBuildCooldownMinutes?: number;
  /** Max nudges per tick. */
  maxNudgesPerTick?: number;
}

const DEFAULTS: Required<BPCConfig> = {
  staleMinutes: 5,
  perBuildCooldownMinutes: 10,
  maxNudgesPerTick: 5,
};

export const buildProgressCheck: ActivityHandler = {
  name: NAME,
  description:
    'Watches jkai_builds in `running` state. If updatedAt is older than the configured threshold and the build has a linked conversation, drops a status note so the user sees progress when they return.',
  defaultCadenceSeconds: 300,
  defaultEnabled: true,
  defaultActiveHours: { start: '06:00', end: '23:59', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as BPCConfig) };
    const staleMs = cfg.staleMinutes * 60_000;
    const cooldownMs = cfg.perBuildCooldownMinutes * 60_000;
    const now = ctx.now;

    // Pull builds that are running. The conversationId column exists on
    // jkaiBuilds for the chat-linked builds; older builds may be null and
    // we skip those (no place to post the nudge).
    const builds = await db.execute(sql`
      SELECT id, status, conversation_id, iterations_completed, updated_at
      FROM jkai_builds
      WHERE status = 'running'
        AND conversation_id IS NOT NULL
        AND updated_at < NOW() - INTERVAL '${sql.raw(String(cfg.staleMinutes))} minutes'
    `) as unknown as Array<{
      id: string;
      status: string;
      conversation_id: string;
      iterations_completed: number;
      updated_at: Date;
    }>;

    if (builds.length === 0) {
      return { outcome: 'ok', summary: 'no slow running builds' };
    }

    // Fetch recent pulses for this activity to enforce per-build cooldown.
    const recentPulses = await db
      .select({ details: heartbeatPulses.details, ts: heartbeatPulses.ts })
      .from(heartbeatPulses)
      .where(
        and(
          eq(heartbeatPulses.activityId, ctx.activity.id),
          gt(heartbeatPulses.ts, new Date(now - cooldownMs)),
        ),
      );
    const recentlyNudgedBuildIds = new Set(
      recentPulses
        .map((p) => (p.details as { buildId?: string } | null)?.buildId)
        .filter((v): v is string => !!v),
    );

    let nudges = 0;
    const acted: Array<{ buildId: string; convId: string; minsSilent: number }> = [];

    for (const b of builds) {
      if (nudges >= cfg.maxNudgesPerTick) break;
      if (recentlyNudgedBuildIds.has(b.id)) continue;
      const minsSilent = Math.round((now - new Date(b.updated_at).getTime()) / 60_000);
      await postHeartbeatNote({
        conversationId: b.conversation_id,
        text: `[heartbeat] build ${b.id.slice(0, 8)} still working — iteration ${b.iterations_completed}, last update ${minsSilent} min ago.`,
        activityName: NAME,
      });
      acted.push({ buildId: b.id, convId: b.conversation_id, minsSilent });
      nudges++;
    }

    if (acted.length === 0) {
      return { outcome: 'ok', summary: 'all slow builds are within cooldown' };
    }

    return {
      outcome: 'fired',
      summary: `nudged ${acted.length} slow build${acted.length === 1 ? '' : 's'}`,
      details: { acted, buildId: acted.length === 1 ? acted[0].buildId : null },
      conversationId: acted.length === 1 ? acted[0].convId : null,
    };
  },
};
