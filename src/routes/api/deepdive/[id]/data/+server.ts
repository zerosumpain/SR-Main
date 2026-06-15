import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  researchSessions,
  facts,
  entities,
  sources,
  relationships,
  entityMentions,
} from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * GET /api/deepdive/[id]/data
 * Returns facts, entities, sources, relationships and the report for a session.
 * Used by the ResearchDesk hydrate-then-stream contract (desk + embedded canvas node).
 */
export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  const report = (session.report ?? {}) as Record<string, unknown>;
  const entityCentrality = (report?.entity_centrality ?? {}) as Record<string, number>;

  const [allFacts, allEntities, allSources, allRelationships, allMentions] = await Promise.all([
    db
      .select({
        id: facts.id,
        content: facts.content,
        confidence: facts.confidence,
        eventDate: facts.eventDate,
        isCounterfactual: facts.isCounterfactual,
        refutesFactId: facts.refutesFactId,
        sourceId: facts.sourceId,
        tags: facts.tags,
        canvasX: facts.canvasX,
        canvasY: facts.canvasY,
        pinned: facts.pinned,
        deskState: facts.deskState,
        deskCategory: facts.deskCategory,
        synthesisRunId: facts.synthesisRunId,
      })
      .from(facts)
      .where(eq(facts.sessionId, params.id)),

    db.select().from(entities).where(eq(entities.sessionId, params.id)),

    db
      .select({
        id: sources.id,
        url: sources.url,
        title: sources.title,
        domain: sources.domain,
        category: sources.category,
        credibilityScore: sources.credibilityScore,
        credibilityType: sources.credibilityType,
        canvasX: sources.canvasX,
        canvasY: sources.canvasY,
        pinned: sources.pinned,
        deskState: sources.deskState,
        deskCategory: sources.deskCategory,
      })
      .from(sources)
      .where(eq(sources.sessionId, params.id)),

    db
      .select({
        id: relationships.id,
        fromEntityId: relationships.fromEntityId,
        toEntityId: relationships.toEntityId,
        relationshipType: relationships.relationshipType,
        sentiment: relationships.sentiment,
      })
      .from(relationships)
      .where(eq(relationships.sessionId, params.id)),

    db
      .select({
        entityId: entityMentions.entityId,
        factId: entityMentions.factId,
      })
      .from(entityMentions)
      .where(sql`${entityMentions.factId} IN (SELECT id FROM fact WHERE session_id = ${params.id})`),
  ]);

  return json({
    facts: allFacts.map((f) => ({
      ...f,
      eventDate: f.eventDate?.toISOString() ?? null,
    })),
    entities: allEntities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
      centrality: entityCentrality[e.id] ?? 0,
    })),
    sources: allSources,
    relationships: allRelationships,
    entityMentions: allMentions,
  });
};
