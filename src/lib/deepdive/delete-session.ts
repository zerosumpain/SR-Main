// Deleting one research run, in the order its foreign keys demand.
//
// Most of a run's tables reference `research_session` with no ON DELETE, so a
// bare `DELETE FROM research_session` fails the moment the run has any facts.
// This is the one sequence that works, shared by the run page's delete
// (`/api/deepdive/[id]`) and account deletion ($lib/people/erase). Caller owns
// the transaction and decides who may delete what.

import { eq } from 'drizzle-orm';
import type { DbExecutor } from '$lib/db';
import {
  entities,
  entityMentions,
  facts,
  globalEntityLinks,
  narrativeItems,
  relationships,
  researchSessions,
  sourceChunks,
  sources,
  synthesisRuns,
} from '$lib/db/schema';

/** Every row of one research run, then the run itself. Call inside a transaction. */
export async function deleteResearchSessionRows(tx: DbExecutor, id: string): Promise<void> {
  // 1. narrative items (references session + facts)
  await tx.delete(narrativeItems).where(eq(narrativeItems.sessionId, id));

  // 2. global entity links (references session + session-scoped entities)
  await tx.delete(globalEntityLinks).where(eq(globalEntityLinks.sessionId, id));

  // 3. entity_mentions (references entities.id + facts.id — must go before both)
  const sessionEntities = await tx.select({ id: entities.id }).from(entities).where(eq(entities.sessionId, id));
  for (const e of sessionEntities) {
    await tx.delete(entityMentions).where(eq(entityMentions.entityId, e.id));
  }

  // 4. relationships (references entities + facts + sources, all session-scoped)
  await tx.delete(relationships).where(eq(relationships.sessionId, id));

  // 5. entities
  await tx.delete(entities).where(eq(entities.sessionId, id));

  // 6. facts (self-ref refutesFactId has no onDelete — null it first to
  //    avoid FK violations on the self-referencing column within the batch)
  await tx.update(facts).set({ refutesFactId: null }).where(eq(facts.sessionId, id));
  await tx.delete(facts).where(eq(facts.sessionId, id));

  // 7. synthesis runs (references session)
  await tx.delete(synthesisRuns).where(eq(synthesisRuns.sessionId, id));

  // 8. source chunks, then sources (both reference the session with no cascade)
  await tx.delete(sourceChunks).where(eq(sourceChunks.sessionId, id));
  await tx.delete(sources).where(eq(sources.sessionId, id));

  // 9. session row (research_lead cascades)
  await tx.delete(researchSessions).where(eq(researchSessions.id, id));
}
