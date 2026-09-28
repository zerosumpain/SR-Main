// src/lib/daydream/hub-counts.server.ts
//
// What the daydream hub's chrome needs on EVERY room: the rail badges and the
// cover tiles. COUNT queries only — the same rule `/jkai/intel`'s layout
// follows. Anything expensive belongs to the room that renders it, or a badge
// would tax every room for a number.
//
// Since P4 of the 2026-09-25 simplification this reports the think loop and
// nothing else: the places, rules, engine state and threshold the retired
// rooms badged went with them.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, heartbeatActions } from '$lib/db/schema';
import type { BadgeCounts } from './hub';

/** The badge populations (`BadgeCounts`, in `hub.ts`) plus what the cover
 *  tiles need. */
export interface HubCounts extends BadgeCounts {
  /** Think notes only — what the cover deck reports. */
  think: { week: number; useful30d: number; rated30d: number; lastCycleAt: Date | null };
  /** Fact checks: waiting for his OK (or stuck), and running on their own. */
  checks: { waiting: number; running: number };
}

export async function loadHubCounts(opts: { activeWatches?: number } = {}): Promise<HubCounts> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [thinkRows, checkRows] = await Promise.all([
    db
      .select({
        // Think notes the feed shows and nobody has ruled on. The held-back
        // ones on the feed are those the daily cap or a route kept quiet
        // (`think/notes.ts` isOnFeed) — refuted and echoed ones never show.
        notesToRate: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} is null and (${daydreamThoughts.status} in ('new','delivered','seen') or (${daydreamThoughts.status} = 'suppressed' and (${daydreamThoughts.suppressedReason} like 'feed_only%' or ${daydreamThoughts.suppressedReason} like 'notify:%' or ${daydreamThoughts.suppressedReason} like 'below_threshold%'))))::int`,
        week: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${weekAgo})::int`,
        useful: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${monthAgo} and ${daydreamThoughts.feedback} = 'useful')::int`,
        rated: sql<number>`count(*) filter (where ${daydreamThoughts.createdAt} >= ${monthAgo} and ${daydreamThoughts.feedback} is not null)::int`,
        lastCycleAt: sql<Date | null>`(select ${heartbeatActions.lastRunAt} from ${heartbeatActions} where ${heartbeatActions.name} = 'daydream-think')`,
      })
      .from(daydreamThoughts)
      .where(sql`${daydreamThoughts.kind} like 'think\\_%'`),
    // A deploy before the commissions migration must not blank the cover.
    db
      .execute(
        // A waiting check on an UNRATED note is already counted as that note,
        // so only checks on answered notes add to "waiting" — the badge then
        // agrees with the Inbox's "To decide". Deferred sits with "in motion",
        // as it does on the Inbox (`noteStage`).
        sql`SELECT count(*) filter (where c.state in ('awaiting_approval','needs_attention') and t.feedback is not null)::int AS waiting,
            count(*) filter (where c.state in ('queued','running','deferred'))::int AS running
          FROM daydream_commissions c JOIN daydream_thoughts t ON t.id = c.thought_id
          WHERE c.principal_id = 'owner'
            AND c.id = (SELECT c2.id FROM daydream_commissions c2 WHERE c2.thought_id = c.thought_id AND c2.principal_id = 'owner'
                        ORDER BY (c2.state IN ('cancelled','declined')), c2.updated_at DESC, c2.created_at DESC LIMIT 1)`,
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  const c = checkRows.rows[0];
  const k = thinkRows[0];
  return {
    notesToRate: k?.notesToRate ?? 0,
    activeWatches: opts.activeWatches ?? 0,
    think: {
      week: k?.week ?? 0,
      useful30d: k?.useful ?? 0,
      rated30d: k?.rated ?? 0,
      lastCycleAt: k?.lastCycleAt ? new Date(k.lastCycleAt) : null,
    },
    checks: { waiting: Number(c?.waiting ?? 0), running: Number(c?.running ?? 0) },
  };
}

/** The shape every room returns when the counts cannot be read. Every key
 *  present, so the layout's union type keeps its properties. */
export function emptyHubCounts(): HubCounts {
  return {
    notesToRate: 0,
    activeWatches: 0,
    think: { week: 0, useful30d: 0, rated30d: 0, lastCycleAt: null },
    checks: { waiting: 0, running: 0 },
  };
}
