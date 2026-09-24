import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes, intelRelationships, intelNoteEntities } from '$lib/db/schema';
import { generateEmbedding } from './embed';
import { searchIntel } from './search';
import { buildKnowledgeContext } from './context';
import { listEntities, getEntityDetail, getNoteDetail } from './queries';
import { queryEntityPage } from './entity-query.server';
import { DEFAULT_ENTITY_QUERY } from './entity-query';
import { createLens, deleteLens, getLens, listLenses, lensEntityIds } from './lenses.server';
import { EMPTY_LENS_FILTERS } from './lenses';
import { persistInsights, listInsights, setInsightStatus, insightsByDedupeKey, dedupeKeyFor } from './insight-store';
import { intelInsights, intelLenses, intelAlerts } from '$lib/db/schema';
import { loadDailyAlerts } from './daily-alerts.server';
import { createNote } from './ingest';
import { persistExtraction } from './graph';
import { storedHashes, refIdForThread } from './gmail-ingest';
import { mergeEntities } from './resolve/merge';
import { mentionCandidates } from './resolve/ingestion.server';

// Offline and deterministic: the test is about which space a row lands in, not
// about embeddings or entity summaries. Resolution's semantic search already
// tolerates a failed embedding, and the summariser is fire-and-forget.
vi.mock('./embed', () => ({
  embedNote: vi.fn(),
  embedEntity: vi.fn(),
  generateEmbedding: vi.fn(async () => { throw new Error('offline'); }),
}));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(() => { throw new Error('offline'); }),
}));

const created: string[] = [];

describe.skipIf(!process.env.DATABASE_URL)('writes carry the note space', () => {
  afterAll(async () => {
    if (!created.length) return;
    // Entities first (their edges cascade), then any edge left pointing at the
    // note, then the notes — whose mentions and links cascade with them.
    await db.delete(intelEntities).where(inArray(intelEntities.firstSeenIn, created));
    await db.delete(intelRelationships).where(inArray(intelRelationships.sourceNoteId, created));
    await db.delete(intelNotes).where(inArray(intelNotes.id, created));
  });

  it('entities and edges extracted from a u_test note are stamped u_test', async () => {
    const noteId = await createNote({
      title: 'space test', rawContent: 'Zorblat Ltd employs Quennel Vasquez.',
      source: 'web', format: 'text', spaceId: 'u_test',
    });
    created.push(noteId);
    await persistExtraction(noteId, {
      summary: 'Zorblat Ltd employs Quennel Vasquez.',
      entities: [
        { mentionId: 'm1', name: 'Zorblat Ltd', type: 'organisation', properties: {}, confidence: 'high', possibleMatchId: null },
        { mentionId: 'm2', name: 'Quennel Vasquez', type: 'person', properties: {}, confidence: 'high', possibleMatchId: null },
      ],
      relationships: [
        { source: 'm1', target: 'm2', type: 'employs', label: 'employs', confidence: 'high' },
      ],
      timelineEvents: [],
      proposedNewTypes: [],
    });

    const [note] = await db.select({ space: intelNotes.spaceId }).from(intelNotes).where(eq(intelNotes.id, noteId));
    expect(note.space).toBe('u_test');

    const ents = await db.select({ space: intelEntities.spaceId }).from(intelEntities)
      .where(eq(intelEntities.firstSeenIn, noteId));
    expect(ents.length).toBeGreaterThan(0);
    expect(ents.every((e) => e.space === 'u_test')).toBe(true);

    const edges = await db.select({ space: intelRelationships.spaceId }).from(intelRelationships)
      .where(eq(intelRelationships.sourceNoteId, noteId));
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.space === 'u_test')).toBe(true);
  });

  it("the Gmail sweep's already-read check only sees its own space", async () => {
    // The same thread in two mailboxes hashes identically. The owner having
    // read it must not make a member's sweep skip it before any note exists.
    const refId = refIdForThread(`space-test-${crypto.randomUUID()}`);
    const [owned] = await db.insert(intelNotes).values({
      rawContent: 'Synthetic thread', source: 'email', spaceId: 'owner',
      metadata: { autoKind: 'file', refId, contentHash: 'same-thread-hash' },
    }).returning({ id: intelNotes.id });
    created.push(owned.id);

    expect((await storedHashes([refId], 'owner')).get(refId)).toBe('same-thread-hash');
    expect((await storedHashes([refId], 'u_test')).has(refId)).toBe(false);

    const [theirs] = await db.insert(intelNotes).values({
      rawContent: 'Synthetic thread', source: 'email', spaceId: 'u_test',
      metadata: { autoKind: 'file', refId, contentHash: 'their-hash' },
    }).returning({ id: intelNotes.id });
    created.push(theirs.id);

    expect((await storedHashes([refId], 'u_test')).get(refId)).toBe('their-hash');
    expect((await storedHashes([refId], 'owner')).get(refId)).toBe('same-thread-hash');
  });

  // Relies on the u_test 'Zorblat Ltd' the first test in this block creates.
  it('an owner mention never matches a u_test entity of the same name', async () => {
    const cands = await mentionCandidates(
      { name: 'Zorblat Ltd', type: 'organisation', properties: {}, confidence: 'high' } as never,
      db, false, 'owner',
    );
    expect(cands.some((c) => c.name === 'Zorblat Ltd')).toBe(false);
    // And the same lookup from inside the space does find it, so the absence
    // above is the scope and not a missing fixture.
    const own = await mentionCandidates(
      { name: 'Zorblat Ltd', type: 'organisation', properties: {}, confidence: 'high' } as never,
      db, false, 'u_test',
    );
    expect(own.some((c) => c.name === 'Zorblat Ltd')).toBe(true);
  });

  it('refuses to merge across spaces', async () => {
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    const [a] = await db.insert(intelEntities).values({ name: 'Space A thing', typeId: type.id, spaceId: 'owner' }).returning();
    const [b] = await db.insert(intelEntities).values({ name: 'Space B thing', typeId: type.id, spaceId: 'u_test' }).returning();
    try {
      await expect(mergeEntities(a.id, b.id)).rejects.toThrow(/different spaces/);
    } finally {
      await db.delete(intelEntities).where(inArray(intelEntities.id, [a.id, b.id]));
    }
  });
});

// Readers. A u_test note and entity, seeded directly, must never reach an owner
// reader — and the same readers asked for u_test's scope must return them, so
// an absence is the predicate and not a fixture that failed to load.
describe.skipIf(!process.env.DATABASE_URL)('readers only see their scope', () => {
  const TEST_SCOPE = ['u_test', 'household'] as const;
  // One-hot, so the seeded rows sit at distance 0 from the query and win any
  // nearest-neighbour lookup that is allowed to see them.
  const vec = Array.from({ length: 1536 }, (_, i) => (i === 7 ? 1 : 0));
  let noteId = '';
  let entityId = '';

  beforeAll(async () => {
    vi.mocked(generateEmbedding).mockImplementation(async () => vec);
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    const [note] = await db.insert(intelNotes).values({
      title: 'Plimsworth Quarry survey',
      rawContent: 'Plimsworth Quarry reopened for survey work.',
      processedContent: 'Plimsworth Quarry reopened for survey work.',
      source: 'web', status: 'processed', graphState: 'admitted', spaceId: 'u_test', embedding: vec,
    }).returning({ id: intelNotes.id });
    noteId = note.id;
    const [entity] = await db.insert(intelEntities).values({
      name: 'Plimsworth Quarry', typeId: type.id, spaceId: 'u_test', firstSeenIn: noteId,
      summary: 'A quarry.', embedding: vec,
    }).returning({ id: intelEntities.id });
    entityId = entity.id;
    await db.insert(intelNoteEntities).values({ noteId, entityId, relevance: 'primary' });
  });

  afterAll(async () => {
    vi.mocked(generateEmbedding).mockImplementation(async () => { throw new Error('offline'); });
    if (entityId) await db.delete(intelEntities).where(eq(intelEntities.id, entityId));
    if (noteId) await db.delete(intelNotes).where(eq(intelNotes.id, noteId));
  });

  it('searchIntel', async () => {
    const owner = await searchIntel('Plimsworth');
    expect(owner.items.some((i) => i.id === noteId || i.id === entityId)).toBe(false);
    const theirs = await searchIntel('Plimsworth', {}, TEST_SCOPE);
    expect(theirs.items.map((i) => i.id)).toEqual(expect.arrayContaining([noteId, entityId]));
  });

  it('buildKnowledgeContext', async () => {
    const owner = await buildKnowledgeContext('Plimsworth Quarry', { clusters: [] });
    expect(owner).not.toContain('Plimsworth');
    const theirs = await buildKnowledgeContext('Plimsworth Quarry', { clusters: [], scope: TEST_SCOPE });
    expect(theirs).toContain('Plimsworth Quarry');
  });

  it('the entities index (queryEntityPage)', async () => {
    const q = { ...DEFAULT_ENTITY_QUERY, q: 'Plimsworth' };
    expect((await queryEntityPage(q)).entities.some((e) => e.id === entityId)).toBe(false);
    expect((await queryEntityPage({ ...q, sort: 'importance' })).page.total).toBe(0);
    const theirs = await queryEntityPage(q, TEST_SCOPE);
    expect(theirs.entities.map((e) => e.id)).toContain(entityId);
    expect(theirs.entities.find((e) => e.id === entityId)?.firstSource?.noteId).toBe(noteId);
  });

  it('listEntities, getEntityDetail and getNoteDetail', async () => {
    expect((await listEntities({ limit: 50 })).some((e) => e.id === entityId)).toBe(false);
    expect(await getEntityDetail(entityId)).toBeNull();
    expect(await getNoteDetail(noteId)).toBeNull();

    expect((await listEntities({ limit: 50, scope: TEST_SCOPE })).some((e) => e.id === entityId)).toBe(true);
    const detail = await getEntityDetail(entityId, TEST_SCOPE);
    expect(detail?.notes.map((n) => n.id)).toContain(noteId);
    expect((await getNoteDetail(noteId, TEST_SCOPE))?.entities.map((e) => e.entityId)).toContain(entityId);
  });

  it('the daily alerts digest', async () => {
    const [alert] = await db.insert(intelAlerts).values({
      noteId, type: 'connection', title: 'Plimsworth Quarry alert', content: 'x', significance: 'high', spaceId: 'u_test',
    }).returning({ id: intelAlerts.id });
    try {
      expect((await loadDailyAlerts()).items.some((i) => i.id === alert.id)).toBe(false);
      expect((await loadDailyAlerts(new Date(), TEST_SCOPE)).items.some((i) => i.id === alert.id)).toBe(true);
    } finally {
      await db.delete(intelAlerts).where(eq(intelAlerts.id, alert.id));
    }
  });
});

// Artefacts: a lens or an insight made under a member's scope lands in their
// space, and the owner can neither list it nor reach it by id.
describe.skipIf(!process.env.DATABASE_URL)('artefacts are written to, and read from, their own space', () => {
  const TEST_SCOPE = ['u_test', 'household'] as const;
  const lensIds: string[] = [];
  const insightKeys: string[] = [];

  afterAll(async () => {
    if (lensIds.length) await db.delete(intelLenses).where(inArray(intelLenses.id, lensIds));
    if (insightKeys.length) await db.delete(intelInsights).where(inArray(intelInsights.dedupeKey, insightKeys));
  });

  it('a lens', async () => {
    const lens = await createLens({ name: `Space test lens ${crypto.randomUUID().slice(0, 8)}` }, TEST_SCOPE);
    lensIds.push(lens.id);
    const [row] = await db.select({ space: intelLenses.spaceId }).from(intelLenses).where(eq(intelLenses.id, lens.id));
    expect(row.space).toBe('u_test');

    expect((await listLenses()).some((l) => l.id === lens.id)).toBe(false);
    expect(await getLens(lens.slug)).toBeNull();
    expect(await deleteLens(lens.id)).toBe(false);

    expect((await listLenses(TEST_SCOPE)).some((l) => l.id === lens.id)).toBe(true);
    expect((await getLens(lens.slug, TEST_SCOPE))?.id).toBe(lens.id);
  });

  it("a lens's entity set is the scope's", async () => {
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    const [e] = await db.insert(intelEntities).values({ name: 'Lens space thing', typeId: type.id, spaceId: 'u_test' }).returning();
    try {
      expect(await lensEntityIds(EMPTY_LENS_FILTERS)).not.toContain(e.id);
      expect(await lensEntityIds(EMPTY_LENS_FILTERS, TEST_SCOPE)).toContain(e.id);
    } finally {
      await db.delete(intelEntities).where(eq(intelEntities.id, e.id));
    }
  });

  it('an insight', async () => {
    // A key of its own, so the global dedupe index cannot meet a real row.
    const insight = { kind: 'space_test', title: 'Space test', detail: 'x', score: 0.5, entityIds: [crypto.randomUUID()] };
    const key = dedupeKeyFor(insight);
    insightKeys.push(key);
    await persistInsights([insight], null, TEST_SCOPE);
    const [row] = await db.select().from(intelInsights).where(eq(intelInsights.dedupeKey, key));
    expect(row.spaceId).toBe('u_test');

    expect((await listInsights({ kind: 'space_test', status: 'all' })).some((r) => r.id === row.id)).toBe(false);
    expect((await insightsByDedupeKey([key])).has(key)).toBe(false);
    expect(await setInsightStatus(row.id, 'seen')).toBeNull();

    expect((await listInsights({ kind: 'space_test', status: 'all', scope: TEST_SCOPE })).some((r) => r.id === row.id)).toBe(true);
    expect((await insightsByDedupeKey([key], TEST_SCOPE)).has(key)).toBe(true);
    expect((await setInsightStatus(row.id, 'seen', null, TEST_SCOPE))?.status).toBe('seen');
  });
});
