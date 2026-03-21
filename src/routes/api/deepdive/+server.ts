import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts, entities, sources } from '$lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { startResearch } from '$lib/deepdive/worker';
import { DEFAULT_CONFIG } from '$lib/deepdive/types';

export const GET: RequestHandler = async () => {
  const sessions = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      createdAt: researchSessions.createdAt,
      completedAt: researchSessions.completedAt,
    })
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt));

  // Get counts for each session
  const sessionsWithCounts = await Promise.all(
    sessions.map(async (s) => {
      const [factCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(facts)
        .where(eq(facts.sessionId, s.id));
      const [entityCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(entities)
        .where(eq(entities.sessionId, s.id));
      return {
        ...s,
        factCount: Number(factCount.count),
        entityCount: Number(entityCount.count),
      };
    }),
  );

  return json(sessionsWithCounts);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { topic, goals, timeLimitMinutes, config } = body;

  if (!topic || typeof topic !== 'string') {
    return json({ error: 'Topic is required' }, { status: 400 });
  }

  const sessionConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };

  const [session] = await db
    .insert(researchSessions)
    .values({
      topic,
      goals: goals ?? [],
      timeLimitMinutes: timeLimitMinutes ?? null,
      config: sessionConfig,
    })
    .returning();

  // Start research in background
  startResearch(session.id);

  return json(session, { status: 201 });
};
