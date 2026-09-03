/**
 * Commit a research session's own graph into the intel knowledge graph.
 *
 * A run's entities and relationships are session-scoped and stay that way: the
 * investigation no longer pushes itself into the durable graph when it
 * finishes, and the backfill sweep only refreshes sessions already committed.
 * This endpoint is the deliberate act that merges one.
 *
 * POST commits (idempotent — committing again re-merges what changed).
 * GET reports whether it has been committed and how big the session graph is,
 * so the page can say "already in the graph" rather than offering a button that
 * does nothing new.
 *
 * The merge itself is structural, not a re-extraction from prose — see
 * `$lib/deepdive/graph-commit` for why that matters.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { commitSessionGraph, commitState } from '$lib/deepdive/graph-commit';

export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);
  if (!session) return json({ error: 'Session not found' }, { status: 404 });

  return json(await commitState(params.id));
};

export const POST: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, status: researchSessions.status })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return json({ error: 'Session not found' }, { status: 404 });
  if (session.status !== 'complete') {
    return json({ error: 'Research has not finished yet' }, { status: 409 });
  }

  try {
    const outcome = await commitSessionGraph(params.id, { force: true });

    if (outcome.status === 'empty') {
      // Not an error and not a success. A run that recognised nothing has
      // nothing to contribute, and saying "committed 0 entities" would read
      // like it worked.
      return json(
        { ok: false, empty: true, error: 'This research found no entities to commit.' },
        { status: 409 },
      );
    }
    if (outcome.status !== 'committed') {
      return json({ error: outcome.reason }, { status: 500 });
    }

    return json({
      ok: true,
      entities: outcome.entities,
      relationships: outcome.relationships,
      noteId: outcome.noteId ?? null,
    });
  } catch (err) {
    console.error('[research] graph commit failed:', err);
    return json({ error: (err as Error)?.message ?? 'Commit failed' }, { status: 500 });
  }
};
