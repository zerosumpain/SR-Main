// src/lib/daydream/register.server.ts
//
// Reading the solutions register (`register.ts`) and its trackers. The
// backlog's state for a build is looked up by the route, which may import
// `$lib/selfimprove` — this module may not (the cycle `follow.server.ts`
// documents).

import { desc, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { registerEntries, type RegisterEntry } from './register';
import { trackerViews, type TrackerView } from './act/track.server';

/** Notes with anything carried out on them — bookkeeping entries aside. */
export async function loadRegister(limit = 300): Promise<RegisterEntry[]> {
  const rows = await db
    .select({ id: daydreamThoughts.id, title: daydreamThoughts.title, proposedActions: daydreamThoughts.proposedActions })
    .from(daydreamThoughts)
    .where(
      sql`jsonb_path_exists(coalesce(${daydreamThoughts.proposedActions}, '[]'::jsonb), '$[*] ? (exists(@.done) && @.kind != "replaces" && @.kind != "seen_again")')`,
    )
    .orderBy(desc(daydreamThoughts.updatedAt))
    .limit(limit);
  return registerEntries(rows);
}

export interface RegisterRoom {
  entries: RegisterEntry[];
  trackers: TrackerView[];
}

/** The register with each tracker's live state folded into its entry. */
export async function loadRegisterRoom(now = new Date()): Promise<RegisterRoom> {
  const [entries, trackers] = await Promise.all([loadRegister(), trackerViews(now).catch(() => [] as TrackerView[])]);
  const byId = new Map(trackers.map((t) => [t.id, t]));
  for (const e of entries) {
    const t = e.ref ? byId.get(e.ref) : undefined;
    if (!t) continue;
    e.state = t.stoppedAt ? 'stopped' : t.progress.status === 'running' ? 'running' : 'done';
    e.result = t.line;
  }
  return { entries, trackers };
}
