import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { facts } from '$lib/db/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  // Get facts with highest novelty scores
  const novelFacts = await db
    .select({
      id: facts.id,
      content: facts.content,
      confidence: facts.confidence,
      noveltyScore: facts.noveltyScore,
      sourceId: facts.sourceId,
      tags: facts.tags,
      eventDate: facts.eventDate,
    })
    .from(facts)
    .where(
      and(
        eq(facts.sessionId, params.id),
        eq(facts.isCounterfactual, false),
        isNotNull(facts.noveltyScore),
      ),
    )
    .orderBy(desc(facts.noveltyScore))
    .limit(10);

  return json(novelFacts);
};
