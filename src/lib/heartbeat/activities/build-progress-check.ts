import { db } from '$lib/db';
import { heartbeatPulses, jkaiBuilds } from '$lib/db/schema';
import { and, eq, gt, isNotNull, lt } from 'drizzle-orm';
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

    // Pull builds that are running with a linked conversation and stale
    // updatedAt. Schema names are camelCase; raw column names not needed.
    const builds = await db
      .select({
        id: jkaiBuilds.id,
        conversationId: jkaiBuilds.conversationId,
        iterationsCompleted: jkaiBuilds.iterationsCompleted,
        updatedAt: jkaiBuilds.updatedAt,
      })
      .from(jkaiBuilds)
      .where(
        and(
          eq(jkaiBuilds.status, 'running'),
          isNotNull(jkaiBuilds.conversationId),
          lt(jkaiBuilds.updatedAt, new Date(now - staleMs)),
        ),
      );

    if (builds.length === 0) {
      return { outcome: 'ok', summary: 'no slow running builds' };
    }

    // Fetch recent pulses for this activity to enforce per-build cooldown.
    const recentPulses = await db
      .select({ details: heartbeatPulses.details, ts: heartbeatPulses.ts })
      .from(heartbeatPulses)
      .where(
        and(
          eq(heartbeatPulses.actionId, ctx.action.id),
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
      if (!b.conversationId) continue;
      const minsSilent = Math.round((now - new Date(b.updatedAt).getTime()) / 60_000);
      await postHeartbeatNote({
        conversationId: b.conversationId,
        text: `[heartbeat] build ${b.id.slice(0, 8)} still working — iteration ${b.iterationsCompleted}, last update ${minsSilent} min ago.`,
        activityName: NAME,
      });
      acted.push({ buildId: b.id, convId: b.conversationId, minsSilent });
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
