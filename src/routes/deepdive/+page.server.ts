import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts, entities } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const sessions = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      createdAt: researchSessions.createdAt,
    })
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt))
    .limit(50);

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
        createdAt: s.createdAt.toISOString(),
        factCount: Number(factCount.count),
        entityCount: Number(entityCount.count),
      };
    }),
  );

  return { sessions: sessionsWithCounts };
};
