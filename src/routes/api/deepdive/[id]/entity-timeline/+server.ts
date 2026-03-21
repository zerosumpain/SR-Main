import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { facts, entityMentions } from '$lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, url }) => {
  const entityId = url.searchParams.get('entityId');
  if (!entityId) return json({ error: 'entityId required' }, { status: 400 });

  // Get fact IDs that mention this entity
  const mentions = await db
    .select({ factId: entityMentions.factId })
    .from(entityMentions)
    .where(eq(entityMentions.entityId, entityId));

  if (mentions.length === 0) return json([]);

  const factIds = mentions.map((m) => m.factId);

  // Get those facts with dates, sorted chronologically
  const timelineFacts = [];
  for (const fid of factIds) {
    const [fact] = await db
      .select({
        id: facts.id,
        content: facts.content,
        eventDate: facts.eventDate,
        confidence: facts.confidence,
        sourceId: facts.sourceId,
      })
      .from(facts)
      .where(and(eq(facts.id, fid), eq(facts.sessionId, params.id)))
      .limit(1);

    if (fact) timelineFacts.push(fact);
  }

  // Sort: dated facts first (chronological), then undated
  timelineFacts.sort((a, b) => {
    if (a.eventDate && b.eventDate) return new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime();
    if (a.eventDate) return -1;
    if (b.eventDate) return 1;
    return 0;
  });

  return json(timelineFacts);
};
