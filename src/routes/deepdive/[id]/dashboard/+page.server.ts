import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import {
  researchSessions,
  facts,
  entities,
  entityMentions,
  relationships,
  sources,
} from '$lib/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) throw redirect(302, '/deepdive');

  // Load all data in parallel
  const [allFacts, allEntities, allSources, allRelationships, allMentions] = await Promise.all([
    db.select({
      id: facts.id,
      content: facts.content,
      confidence: facts.confidence,
      eventDate: facts.eventDate,
      isCounterfactual: facts.isCounterfactual,
      refutesFactId: facts.refutesFactId,
      sourceId: facts.sourceId,
      tags: facts.tags,
    }).from(facts).where(eq(facts.sessionId, params.id)),

    db.select().from(entities).where(eq(entities.sessionId, params.id)),

    db.select({
      id: sources.id,
      url: sources.url,
      title: sources.title,
      domain: sources.domain,
      phase: sources.phase,
    }).from(sources).where(eq(sources.sessionId, params.id)),

    db.select().from(relationships).where(eq(relationships.sessionId, params.id)),

    db.select().from(entityMentions)
      .innerJoin(entities, eq(entityMentions.entityId, entities.id))
      .where(eq(entities.sessionId, params.id)),
  ]);

  const report = session.report as any;
  const entityCentrality = report?.entity_centrality ?? {};

  // Compute elapsed time
  const elapsedMs = session.completedAt
    ? new Date(session.completedAt).getTime() - new Date(session.createdAt).getTime()
    : 0;

  // Serialize dates
  const serializedFacts = allFacts.map((f) => ({
    ...f,
    eventDate: f.eventDate?.toISOString() ?? null,
  }));

  return {
    session: {
      id: session.id,
      topic: session.topic,
      goals: session.goals,
      status: session.status,
      config: session.config,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      elapsedMs,
    },
    report: report ?? {},
    facts: serializedFacts,
    entities: allEntities.map((e) => ({
      ...e,
      centrality: entityCentrality[e.id] ?? 0,
      firstSeenAt: e.firstSeenAt.toISOString(),
    })),
    sources: allSources,
    relationships: allRelationships,
    mentions: allMentions.map((m) => ({
      entityId: m.entity_mention.entityId,
      factId: m.entity_mention.factId,
      context: m.entity_mention.context,
    })),
    stats: {
      facts: allFacts.filter((f) => !f.isCounterfactual).length,
      counterfactuals: allFacts.filter((f) => f.isCounterfactual).length,
      entities: allEntities.length,
      sources: allSources.length,
    },
  };
};
