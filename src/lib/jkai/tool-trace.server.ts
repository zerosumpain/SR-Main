// Loading a recorded tool-call chain.
//
// THIS HALF TOUCHES THE DB — the pure types and the recorder live in
// `tool-trace.ts`, which client code imports. Same split, and for the same
// reason, as thread-graph / thread-graph.server: anything the browser bundle can
// reach drags the whole import graph with it, and `$lib/db` at the end of that
// chain fails the build.

import { db } from '$lib/db';
import { jkaiToolTraces } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Find a trace by either identifier a caller might be holding.
 *
 *  - the **trace id** (= the chat job id), which is what a live turn has the
 *    moment it finishes and what `metadata.traceId` stores; and
 *  - the assistant **message id**, the only stable id a reloaded thread has for
 *    a turn.
 *
 * Three call sites used to carry their own copy of this two-step lookup. That
 * is exactly how the pair drifts to one — a caller that only tries the primary
 * key answers 404 for every reloaded thread, which looks like a missing trace
 * and is a missing fallback.
 *
 * The primary key is tried first so the common case stays a single indexed
 * lookup.
 */
export async function loadTraceRow(id: string) {
  let [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.id, id)).limit(1);
  if (!row) {
    [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.messageId, id)).limit(1);
  }
  return row ?? null;
}
