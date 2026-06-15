import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts, entities, sources, relationships, entityMentions, narrativeItems, globalEntityLinks, synthesisRuns } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requestStop, requestSkipPhase } from '$lib/deepdive/worker';

export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  // Get full counts
  const [factCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(facts)
    .where(and(eq(facts.sessionId, params.id), eq(facts.isCounterfactual, false)));

  const [counterfactualCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(facts)
    .where(and(eq(facts.sessionId, params.id), eq(facts.isCounterfactual, true)));

  const [entityCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(entities)
    .where(eq(entities.sessionId, params.id));

  const [sourceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(eq(sources.sessionId, params.id));

  return json({
    ...session,
    stats: {
      facts: Number(factCount.count),
      counterfactuals: Number(counterfactualCount.count),
      entities: Number(entityCount.count),
      sources: Number(sourceCount.count),
    },
  });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json();

  if (body.action === 'stop') {
    requestStop(params.id);
    return json({ message: 'Stop signal sent' });
  }

  if (body.action === 'skip') {
    requestSkipPhase(params.id);
    return json({ message: 'Skip signal sent' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    // 0. Null out parentSessionId on any child (explore-further) sessions so
    //    they are not orphaned. parentSessionId has no FK constraint in schema
    //    so this is purely data hygiene, not required for the DELETE to succeed.
    await tx
      .update(researchSessions)
      .set({ parentSessionId: null })
      .where(eq(researchSessions.parentSessionId, params.id));

    // 1. narrative items (references session + facts)
    await tx.delete(narrativeItems).where(eq(narrativeItems.sessionId, params.id));

    // 2. global entity links (references session + session-scoped entities)
    await tx.delete(globalEntityLinks).where(eq(globalEntityLinks.sessionId, params.id));

    // 3. entity_mentions (references entities.id + facts.id — must go before both)
    const sessionEntities = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.sessionId, params.id));

    for (const e of sessionEntities) {
      await tx.delete(entityMentions).where(eq(entityMentions.entityId, e.id));
    }

    // 4. relationships (references entities + facts + sources, all session-scoped)
    await tx.delete(relationships).where(eq(relationships.sessionId, params.id));

    // 5. entities
    await tx.delete(entities).where(eq(entities.sessionId, params.id));

    // 6. facts (self-ref refutesFactId has no onDelete — null it first to
    //    avoid FK violations on the self-referencing column within the batch)
    await tx
      .update(facts)
      .set({ refutesFactId: null })
      .where(eq(facts.sessionId, params.id));
    await tx.delete(facts).where(eq(facts.sessionId, params.id));

    // 7. synthesis runs (references session)
    await tx.delete(synthesisRuns).where(eq(synthesisRuns.sessionId, params.id));

    // 8. sources (references session)
    await tx.delete(sources).where(eq(sources.sessionId, params.id));

    // 9. session row
    await tx.delete(researchSessions).where(eq(researchSessions.id, params.id));
  });

  return new Response(null, { status: 204 });
};
