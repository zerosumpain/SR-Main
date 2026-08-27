import { desc, eq, gte, and } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelInsights } from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import { insightToCandidate, MAX_BRIDGED_PER_RUN, type InsightRow } from '$lib/daydream/intel-bridge';
import { persistCandidates } from '$lib/daydream/thought-store';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-intel';

interface IntelBridgeConfig {
  /** How far back a `new` insight is still worth bridging. The analytics run
   *  nightly, so anything older has been re-derived or retired. */
  freshDays?: number;
}

const DEFAULTS: Required<IntelBridgeConfig> = { freshDays: 3 };

/**
 * Bridge the knowledge graph's insight engine into the thought ledger.
 *
 * Reads recent `new` intel insights and offers the strongest few to
 * `persistCandidates`, where they meet the same threshold, kind weights,
 * mutes and dedupe as every other thought. No model call — both sides of the
 * bridge are rule-generated text — so this costs nothing and is not in
 * SPENDING_ACTIONS. Deliberately does NOT touch the insight's own status:
 * the intel page owns that ledger, and a bridge that marked things `seen`
 * would make the graph's UI lie about what the owner has looked at.
 */
export const daydreamIntelBridge: ActivityHandler = {
  name: NAME,
  description:
    "Bridges the intel graph's nightly rule-based insights (brokers, emerging hubs, surprising links) into the daydream thought ledger, through the same scoring, mute and delivery gates as every other thought. No LLM.",
  defaultCadenceSeconds: 6 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as IntelBridgeConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    try {
      const since = new Date(new Date(ctx.now).getTime() - cfg.freshDays * 86_400_000);
      const rows = await db
        .select({
          id: intelInsights.id,
          kind: intelInsights.kind,
          title: intelInsights.title,
          explanation: intelInsights.explanation,
          score: intelInsights.score,
          components: intelInsights.components,
          entityIds: intelInsights.entityIds,
          dedupeKey: intelInsights.dedupeKey,
          proposedActions: intelInsights.proposedActions,
        })
        .from(intelInsights)
        .where(and(eq(intelInsights.status, 'new'), gte(intelInsights.createdAt, since)))
        .orderBy(desc(intelInsights.score))
        .limit(25);

      const candidates = rows
        .map((r) => insightToCandidate(r as InsightRow))
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .slice(0, MAX_BRIDGED_PER_RUN);

      if (candidates.length === 0) {
        return {
          outcome: 'ok',
          summary: `nothing to bridge (${rows.length} fresh insights, none above the bar)`,
          details: { considered: rows.length },
        };
      }

      const persisted = await persistCandidates(candidates, {
        runId: `intel-${new Date(ctx.now).getTime()}`,
        now: new Date(ctx.now),
      });

      return {
        outcome: 'ok',
        summary:
          `${candidates.length} bridged of ${rows.length} fresh: ` +
          `${persisted.created} new, ${persisted.updated} refreshed, ` +
          `${persisted.suppressed} below threshold, ${persisted.muted} muted`,
        details: { considered: rows.length, ...persisted },
      };
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
  },
};
