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
}

export async function loadHubCounts(opts: { activeWatches?: number } = {}): Promise<HubCounts> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [thinkRows] = await Promise.all([
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
  ]);
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
  };
}

/** The shape every room returns when the counts cannot be read. Every key
 *  present, so the layout's union type keeps its properties. */
export function emptyHubCounts(): HubCounts {
  return {
    notesToRate: 0,
    activeWatches: 0,
    think: { week: 0, useful30d: 0, rated30d: 0, lastCycleAt: null },
  };
}
