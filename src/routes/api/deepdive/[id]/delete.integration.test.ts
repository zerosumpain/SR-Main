import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// DB-gated: only runs when a real Postgres is reachable.
const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? describe : describe.skip;

suite('DELETE /api/deepdive/[id] (integration)', () => {
  let db: typeof import('$lib/db')['db'];
  let schema: typeof import('$lib/db/schema');
  let DELETE_handler: typeof import('./+server')['DELETE'];

  function makeEvent(id: string) {
    return {
      params: { id },
      request: new Request(`http://localhost/api/deepdive/${id}`, { method: 'DELETE' }),
    } as unknown as Parameters<typeof DELETE_handler>[0];
  }

  beforeAll(async () => {
    ({ db } = await import('$lib/db'));
    schema = await import('$lib/db/schema');
    ({ DELETE: DELETE_handler } = await import('./+server'));
  });

  afterAll(async () => {
    // Cleanup is done inside each test after the DELETE; nothing to do here.
  });

  it('returns 404 for a non-existent session', async () => {
    const res = await DELETE_handler(makeEvent('00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });

  it('deletes a session and all its child rows, nulls child session parentSessionId', async () => {
    const { eq } = await import('drizzle-orm');

    // Seed parent session
    const [parent] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'delete integration test parent' })
      .returning({ id: schema.researchSessions.id });

    // Seed child (explore-further) session pointing at parent
    const [child] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'delete integration test child', parentSessionId: parent.id })
      .returning({ id: schema.researchSessions.id });

    // Seed a source
    const [src] = await db
      .insert(schema.sources)
      .values({ sessionId: parent.id, url: 'https://example.test/delete-test', phase: 1 })
      .returning({ id: schema.sources.id });

    // Seed a fact
    const [fact] = await db
      .insert(schema.facts)
      .values({ sessionId: parent.id, sourceId: src.id, content: 'a test fact for delete' })
      .returning({ id: schema.facts.id });

    // Seed an entity
    const [entity] = await db
      .insert(schema.entities)
      .values({ sessionId: parent.id, name: 'Delete Test Entity', type: 'org' })
      .returning({ id: schema.entities.id });

    // Seed an entity mention (refs entity + fact)
    await db
      .insert(schema.entityMentions)
      .values({ entityId: entity.id, factId: fact.id, context: 'test context' });

    // Seed a synthesis run
    await db
      .insert(schema.synthesisRuns)
      .values({ sessionId: parent.id });

    // Seed a narrative item (refs session + fact)
    await db
      .insert(schema.narrativeItems)
      .values({ sessionId: parent.id, factId: fact.id, sortOrder: 1 });

    // DELETE the parent session
    const res = await DELETE_handler(makeEvent(parent.id));
    expect(res.status).toBe(204);

    // Verify parent session gone
    const remainingSessions = await db
      .select({ id: schema.researchSessions.id })
      .from(schema.researchSessions)
      .where(eq(schema.researchSessions.id, parent.id));
    expect(remainingSessions).toHaveLength(0);

    // Verify child session still exists and parentSessionId is now null
    const [childRow] = await db
      .select({ id: schema.researchSessions.id, parentSessionId: schema.researchSessions.parentSessionId })
      .from(schema.researchSessions)
      .where(eq(schema.researchSessions.id, child.id));
    expect(childRow).toBeDefined();
    expect(childRow.parentSessionId).toBeNull();

    // Verify all child rows of the parent session are gone
    const remainingSources = await db.select().from(schema.sources).where(eq(schema.sources.sessionId, parent.id));
    expect(remainingSources).toHaveLength(0);

    const remainingFacts = await db.select().from(schema.facts).where(eq(schema.facts.sessionId, parent.id));
    expect(remainingFacts).toHaveLength(0);

    const remainingEntities = await db.select().from(schema.entities).where(eq(schema.entities.sessionId, parent.id));
    expect(remainingEntities).toHaveLength(0);

    const remainingSynthesis = await db.select().from(schema.synthesisRuns).where(eq(schema.synthesisRuns.sessionId, parent.id));
    expect(remainingSynthesis).toHaveLength(0);

    // Clean up the child session
    await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, child.id));
  });
});
