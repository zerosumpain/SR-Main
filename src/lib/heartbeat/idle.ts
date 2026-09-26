// src/lib/heartbeat/idle.ts
//
// The spare-cycle idle gate: has the owner said anything to jkai recently?
//
// Every background activity that spends model budget asks this before it runs
// (and the nightly self-improve and doctor runs ask again between phases). It
// used to live in `$lib/selfimprove/run`, so ten heartbeat activities imported
// the whole self-improve pipeline's module graph to read one row. It belongs to
// the heartbeat, which owns "when is it safe to spend spare cycles".
//
// Deliberately dependency-light — the db and the schema, nothing else — so any
// module can reach it without dragging a feature in. `$lib/selfimprove` and
// `$lib/workflowdoctor` do NOT import it: the heartbeat already imports both of
// them, so they take the gate as an injected function (`isUserActive` on
// `runImprovementNow` / `runDoctorNow`) rather than closing a module cycle.

import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';

/** The default window: an hour since the owner's last chat message. */
export const DEFAULT_IDLE_WINDOW_MS = 60 * 60 * 1000;

/** True if the user chatted (orchestrator_chats role=user) within `withinMs`. */
export async function isUserActive(withinMs: number = DEFAULT_IDLE_WINDOW_MS): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMs);
    const rows = await db
      .select({ id: orchestratorChats.id })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.role, 'user'), gte(orchestratorChats.createdAt, since)))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail CLOSED: if we cannot tell whether the user is active, assume they are
    // and skip the run. A DB hiccup must never cause a background loop to spend
    // LLM budget while the user is in fact using the site.
    console.error('[heartbeat] idle check failed — treating user as active:', err instanceof Error ? err.message : String(err));
    return true;
  }
}
