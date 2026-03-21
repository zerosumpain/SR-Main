import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts, entities, sources, relationships, entityMentions } from '$lib/db/schema';
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
