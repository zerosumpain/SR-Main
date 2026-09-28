import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts, entities, sources } from '$lib/db/schema';
import { deleteResearchSessionRows } from '$lib/deepdive/delete-session';
import { eq, and, sql } from 'drizzle-orm';
import { requestStop, requestSkipPhase } from '$lib/deepdive/worker';
import { writable } from '$lib/server/area-scope';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  const { session } = await requireResearchSession(event, params.id, 'read');

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

export const PATCH: RequestHandler = async (event) => {
  const { params, request } = event;
  await requireResearchSession(event, params.id, 'write');
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

export const DELETE: RequestHandler = async (event) => {
  const { params } = event;
  const { access } = await requireResearchSession(event, params.id, 'write');

  await db.transaction(async (tx) => {
    // 0. Null out parentSessionId on any child (explore-further) sessions so
    //    they are not orphaned. parentSessionId has no FK constraint in schema
    //    so this is purely data hygiene, not required for the DELETE to succeed.
    //    Only children the caller may change: the owner's explore of a member's
    //    run keeps its lineage pointer rather than being edited by the member.
    await tx
      .update(researchSessions)
      .set({ parentSessionId: null })
      .where(and(eq(researchSessions.parentSessionId, params.id), writable(researchSessions.principalId, access)));

    await deleteResearchSessionRows(tx, params.id);
  });

  return new Response(null, { status: 204 });
};
