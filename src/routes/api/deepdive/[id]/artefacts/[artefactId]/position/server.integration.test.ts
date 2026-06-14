import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// DB-gated: only runs when a real Postgres is reachable. Mirrors the repo's
// "no DB mocking" convention — we hit the actual handler + db.
const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? describe : describe.skip;

suite('PATCH artefact position (integration)', () => {
  let db: typeof import('$lib/db')['db'];
  let schema: typeof import('$lib/db/schema');
  let PATCH: typeof import('./+server')['PATCH'];

  let sessionId: string;
  let otherSessionId: string;
  let sourceId: string;
  let factId: string;
  let entityId: string;

  function makeEvent(id: string, artefactId: string, body: unknown) {
    return {
      params: { id, artefactId },
      request: new Request('http://localhost/patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as unknown as Parameters<typeof PATCH>[0];
  }

  beforeAll(async () => {
    ({ db } = await import('$lib/db'));
    schema = await import('$lib/db/schema');
    ({ PATCH } = await import('./+server'));

    const [session] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'desk position integration test' })
      .returning({ id: schema.researchSessions.id });
    sessionId = session.id;

    const [other] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'desk position OTHER session' })
      .returning({ id: schema.researchSessions.id });
    otherSessionId = other.id;

    const [src] = await db
      .insert(schema.sources)
      .values({ sessionId, url: 'https://example.test/a', phase: 1 })
      .returning({ id: schema.sources.id });
    sourceId = src.id;

    const [f] = await db
      .insert(schema.facts)
      .values({ sessionId, sourceId, content: 'a test fact' })
      .returning({ id: schema.facts.id });
    factId = f.id;

    const [ent] = await db
      .insert(schema.entities)
      .values({ sessionId, name: 'Test Entity', type: 'org' })
      .returning({ id: schema.entities.id });
    entityId = ent.id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { eq } = await import('drizzle-orm');
    // Children first (FK order): facts -> entities -> sources -> sessions.
    await db.delete(schema.facts).where(eq(schema.facts.sessionId, sessionId));
    await db.delete(schema.entities).where(eq(schema.entities.sessionId, sessionId));
    await db.delete(schema.sources).where(eq(schema.sources.sessionId, sessionId));
    await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, sessionId));
    await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, otherSessionId));
  });

  it('persists canvas_x/canvas_y on a fact and returns the new position', async () => {
    const res = await PATCH(makeEvent(sessionId, factId, {
      artefactType: 'fact',
      position: { x: 240, y: -88 },
    }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toMatchObject({ id: factId, artefactType: 'fact', position: { x: 240, y: -88 } });

    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ x: schema.facts.canvasX, y: schema.facts.canvasY, pinned: schema.facts.pinned })
      .from(schema.facts)
      .where(eq(schema.facts.id, factId));
    expect(row.x).toBe(240);
    expect(row.y).toBe(-88);
  });

  it('persists pinned + deskState + deskCategory on a source', async () => {
    const res = await PATCH(makeEvent(sessionId, sourceId, {
      artefactType: 'source',
      position: { x: 10, y: 20 },
      pinned: true,
      deskState: 'filed',
      deskCategory: 'methods',
    }));
    expect(res.status).toBe(200);

    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({
        x: schema.sources.canvasX,
        y: schema.sources.canvasY,
        pinned: schema.sources.pinned,
        state: schema.sources.deskState,
        cat: schema.sources.deskCategory,
      })
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId));
    expect(row).toEqual({ x: 10, y: 20, pinned: true, state: 'filed', cat: 'methods' });
  });

  it('persists a position on an entity', async () => {
    const res = await PATCH(makeEvent(sessionId, entityId, {
      artefactType: 'entity',
      position: { x: 5, y: 5 },
    }));
    expect(res.status).toBe(200);
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ x: schema.entities.canvasX, y: schema.entities.canvasY })
      .from(schema.entities)
      .where(eq(schema.entities.id, entityId));
    expect(row.x).toBe(5);
    expect(row.y).toBe(5);
  });

  it('returns 404 when the artefact belongs to a different session', async () => {
    const res = await PATCH(makeEvent(otherSessionId, factId, {
      artefactType: 'fact',
      position: { x: 1, y: 1 },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown artefactId', async () => {
    const res = await PATCH(makeEvent(sessionId, 'does-not-exist', {
      artefactType: 'fact',
      position: { x: 1, y: 1 },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid artefactType', async () => {
    const res = await PATCH(makeEvent(sessionId, factId, {
      artefactType: 'relationship',
      position: { x: 1, y: 1 },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on non-finite coordinates', async () => {
    const res = await PATCH(makeEvent(sessionId, factId, {
      artefactType: 'fact',
      position: { x: 'NaN', y: 0 },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on a malformed (non-JSON) body', async () => {
    const event = {
      params: { id: sessionId, artefactId: factId },
      request: new Request('http://localhost/patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{ not json',
      }),
    } as unknown as Parameters<typeof PATCH>[0];
    const res = await PATCH(event);
    expect(res.status).toBe(400);
  });
});
