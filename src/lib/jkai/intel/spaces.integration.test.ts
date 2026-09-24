import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes, intelRelationships, intelNoteEntities } from '$lib/db/schema';
import { generateEmbedding } from './embed';
import { searchIntel } from './search';
import { buildKnowledgeContext } from './context';
import { listEntities, getEntityDetail, getNoteDetail, listTimelineEvents } from './queries';
import { queryEntityPage } from './entity-query.server';
import { DEFAULT_ENTITY_QUERY } from './entity-query';
import { createLens, deleteLens, getLens, listLenses, lensEntityIds } from './lenses.server';
import { EMPTY_LENS_FILTERS } from './lenses';
import { persistInsights, listInsights, setInsightStatus, insightsByDedupeKey, dedupeKeyFor } from './insight-store';
import { intelInsights, intelLenses, intelAlerts, intelTimelineEvents } from '$lib/db/schema';
import { loadDailyAlerts } from './daily-alerts.server';
import { cleanupIntelligence } from './cleanup.server';
import { assembleBriefContext } from './brief';
import { taxonomyEvidence } from './taxonomy-governance.server';
import { createNote } from './ingest';
import { persistExtraction } from './graph';
import { storedHashes, refIdForThread } from './gmail-ingest';
import { mergeEntities } from './resolve/merge';
import { mentionCandidates } from './resolve/ingestion.server';
import { deleteNoteCascade } from './ingest';
import { confirmRelationship, rejectRelationship } from './confirm-link';
import { loadMailQueue, similarPending } from './mail-queue';
import { admitMailNotes, rejectMailNotes, requeueMailNotes } from './mail-admit';
import { purgeMailFromGraph } from './mail-purge';
import { loadAnchoredEntities, nearestAnchored } from './mail-relevance';
import { gatherProposalContext } from './mail-rules/propose';
import {
  invalidateResolutionCaches, loadResolvableEntities, sweepDuplicates, loadAddressNames, loadNeighbourIndex,
} from './resolve/merge';
import { loadEntityNames, loadPairEvidence, loadCoMentions } from './resolve/adjudicate';
import { loadEvidenceVersions } from './resolve/evidence-version.server';
import { conflationCandidates } from './resolve/conflation.server';
import { splitEntity } from './resolve/split';
import { resolveRequestScope } from './scope.server';
import { buildClusterRoster, recalculateClusterRoster } from './cluster-roster';
import { recordIntelRun } from './run-log';
import { pairKeyOf } from './resolve/pair-key';
import { intelMatchDecisions, intelResolutionLabels } from '$lib/db/schema';
import { conversations, jkaiMemories, jkaiMemoryEntities, mailEmbeddings } from '$lib/db/schema';

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
// The mail passage index embeds its query through its own module. Only the query
// half is replaced (the consumers block points it at a seeded vector); indexing
// stays as it was for the mail-admit cases.
vi.mock('$lib/mail-index/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/mail-index/embed')>();
  return { ...actual, embedQuery: vi.fn(actual.embedQuery) };
});
// Only the route seam is replaced, and only the route block below changes what
// it returns: noteSpace / entitySpace stay real for every other block.
vi.mock('./scope.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scope.server')>();
  return { ...actual, resolveRequestScope: vi.fn(actual.resolveRequestScope) };
});
// Tripwires behind the owner-only gates the route block asserts. The dev DB is
// shared, so a gate that regressed must never reach a real apply: every
// every-space writer those routes call is a spy that THROWS instead of running,
// and the route block asserts it was never called. The cleanup PREVIEW (no
// `apply`) stays real, for the artefacts block that reads it.
vi.mock('./cleanup.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cleanup.server')>();
  return {
    ...actual,
    cleanupIntelligence: vi.fn(async (options: Parameters<typeof actual.cleanupIntelligence>[0] = {}) => {
      if (options.apply) throw new Error('tripwire: cleanup apply must never run in this test');
      return actual.cleanupIntelligence(options);
    }),
  };
});
vi.mock('./run-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./run-log')>();
  // No run record either: a regressed gate must not write to the run history.
  return { ...actual, ensureIntelRunCollection: vi.fn(async () => {}), recordIntelRun: vi.fn(async () => {}) };
});
vi.mock('./cluster-roster', () => ({
  buildClusterRoster: vi.fn(async () => { throw new Error('tripwire: the roster must never be rebuilt in this test'); }),
  recalculateClusterRoster: vi.fn(async () => { throw new Error('tripwire: the roster must never be recalculated in this test'); }),
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
      // A scope that sees both, so the refusal is the space guard itself — the
      // owner's default scope would not find b at all (see the 11b block).
      await expect(mergeEntities(a.id, b.id, { scope: ['owner', 'u_test'] })).rejects.toThrow(/different spaces/);
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

  it('a brief, and the taxonomy evidence samples', async () => {
    expect((await assembleBriefContext([entityId])).subjects).toHaveLength(0);
    const theirs = await assembleBriefContext([entityId], { scope: TEST_SCOPE });
    expect(theirs.subjects.map((x) => x.id)).toEqual([entityId]);
    expect(theirs.sources.map((x) => x.noteId)).toContain(noteId);

    const [row] = await db.select({ typeId: intelEntities.typeId }).from(intelEntities).where(eq(intelEntities.id, entityId));
    expect((await taxonomyEvidence('type', row.typeId)).some((r) => r.id === entityId)).toBe(false);
    expect((await taxonomyEvidence('type', row.typeId, TEST_SCOPE)).some((r) => r.id === entityId)).toBe(true);
  });

  it("the timeline's entity join is scoped, not only the event", async () => {
    // Deliberately inconsistent: an OWNER event pointing at the u_test entity.
    // Resolution never makes one, which is exactly why the join must not rely
    // on that — the owner sees the event, never the other space's entity name.
    const [ev] = await db.insert(intelTimelineEvents).values({
      noteId, entityId, date: '2026-09-24', type: 'event', title: 'Space test event', spaceId: 'owner',
    }).returning({ id: intelTimelineEvents.id });
    try {
      const owner = (await listTimelineEvents({ entityId, limit: 50 })).find((e) => e.id === ev.id);
      expect(owner).toBeDefined();
      expect(owner?.entityName).toBeNull();
      const theirs = (await listTimelineEvents({ entityId, limit: 50, scope: ['owner', 'u_test'] })).find((e) => e.id === ev.id);
      expect(theirs?.entityName).toBe('Plimsworth Quarry');
    } finally {
      await db.delete(intelTimelineEvents).where(eq(intelTimelineEvents.id, ev.id));
    }
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

  it("the cleanup preview names only the scope's rows", async () => {
    // An old entity with no provenance and no support: the review list's kind.
    // Preview only — a read-only transaction, nothing is deleted.
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    const [e] = await db.insert(intelEntities).values({
      name: 'Cleanup space thing', typeId: type.id, spaceId: 'u_test',
      updatedAt: new Date(Date.now() - 72 * 3_600_000),
    }).returning();
    try {
      expect((await cleanupIntelligence()).review.some((r) => r.id === e.id)).toBe(false);
      expect((await cleanupIntelligence({ scope: TEST_SCOPE })).review.some((r) => r.id === e.id)).toBe(true);
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

// Task 11b: the write, mail and resolve half. A u_test email thread, two u_test
// duplicates and an edge between them: the owner's mail queue, triage actions,
// duplicate sweep, adjudication and conflation loaders must never see them, and
// the same functions pointed at u_test must — so every absence is the predicate.
describe.skipIf(!process.env.DATABASE_URL)('mail and resolution stay inside one space', () => {
  const TEST_SCOPE = ['u_test', 'household'] as const;
  const vec = Array.from({ length: 1536 }, (_, i) => (i === 11 ? 1 : 0));
  const DOMAIN = `quarnby-${crypto.randomUUID().slice(0, 8)}.example`;
  const ids = { theirMail: '', ownMail: '', dupA: '', dupB: '', depot: '', edge: '' };

  beforeAll(async () => {
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    const [theirs] = await db.insert(intelNotes).values({
      title: 'Quarnby Holloway works order', rawContent: 'Quarnby Holloway Works confirmed the order.',
      source: 'email', status: 'held', graphState: 'pending', spaceId: 'u_test', embedding: vec,
      metadata: { senderDomain: DOMAIN, gmailThreadId: 'space-test-thread' },
    }).returning({ id: intelNotes.id });
    ids.theirMail = theirs.id;
    // An owner thread with the SAME vector, so a nearest-neighbour search that
    // ignored space would put the u_test thread at distance 0 from it.
    const [own] = await db.insert(intelNotes).values({
      title: 'Space test owner thread', rawContent: 'An owner thread.',
      source: 'email', status: 'held', graphState: 'pending', spaceId: 'owner', embedding: vec,
    }).returning({ id: intelNotes.id });
    ids.ownMail = own.id;
    const email = `works@${DOMAIN}`;
    const [a] = await db.insert(intelEntities).values({
      name: 'Quarnby Holloway Works', typeId: type.id, spaceId: 'u_test', embedding: vec,
      properties: { email }, firstSeenIn: ids.theirMail,
    }).returning({ id: intelEntities.id });
    const [b] = await db.insert(intelEntities).values({
      name: 'Quarnby Holloway Works', typeId: type.id, spaceId: 'u_test', embedding: vec,
      properties: { email }, firstSeenIn: ids.theirMail,
    }).returning({ id: intelEntities.id });
    // A third entity for the edge: an edge between the duplicates themselves
    // would read to the matcher as evidence that they are two things.
    const [depot] = await db.insert(intelEntities).values({
      name: 'Quarnby Depot', typeId: type.id, spaceId: 'u_test', firstSeenIn: ids.theirMail,
    }).returning({ id: intelEntities.id });
    ids.dupA = a.id;
    ids.dupB = b.id;
    ids.depot = depot.id;
    await db.insert(intelNoteEntities).values([
      { noteId: ids.theirMail, entityId: a.id, relevance: 'primary', excerpt: 'Quarnby Holloway Works confirmed the order.' },
      { noteId: ids.theirMail, entityId: b.id, relevance: 'primary', excerpt: 'Quarnby Holloway Works confirmed the order.' },
    ]);
    const [edge] = await db.insert(intelRelationships).values({
      sourceEntityId: a.id, targetEntityId: depot.id, type: 'supplies', sourceNoteId: ids.theirMail, spaceId: 'u_test',
    }).returning({ id: intelRelationships.id });
    ids.edge = edge.id;
    // The resolver memoises its entity snapshot for a minute.
    invalidateResolutionCaches();
  });

  afterAll(async () => {
    const entityIds = [ids.dupA, ids.dupB, ids.depot].filter(Boolean);
    if (entityIds.length) await db.delete(intelEntities).where(inArray(intelEntities.id, entityIds));
    const noteIds = [ids.theirMail, ids.ownMail].filter(Boolean);
    if (noteIds.length) await db.delete(intelNotes).where(inArray(intelNotes.id, noteIds));
    invalidateResolutionCaches();
  });

  it("a member's held thread never lists in the owner's mail queue", async () => {
    const owner = await loadMailQueue();
    expect(owner.rows.some((r) => r.id === ids.theirMail)).toBe(false);
    expect(owner.clusters.some((c) => c.domain === DOMAIN)).toBe(false);
    const theirs = await loadMailQueue(Date.now(), TEST_SCOPE);
    expect(theirs.rows.map((r) => r.id)).toContain(ids.theirMail);
    expect(theirs.rows.some((r) => r.id === ids.ownMail)).toBe(false);
  });

  it('similar threads, and the rule proposer, are the scope’s', async () => {
    expect(await similarPending(ids.ownMail)).not.toContain(ids.theirMail);
    expect(await similarPending(ids.theirMail, 40, ['owner', 'u_test'])).toContain(ids.ownMail);
    expect(await gatherProposalContext()).not.toContain(DOMAIN);
    expect(await gatherProposalContext(TEST_SCOPE)).toContain(DOMAIN);
  });

  it("the owner's triage actions cannot touch a member's thread", async () => {
    // Every one of these would make a model call or rewrite graph state if it
    // found the note; not-found is the only acceptable answer.
    const admitted = await admitMailNotes([ids.theirMail]);
    expect(admitted.items).toEqual([expect.objectContaining({ noteId: ids.theirMail, status: 'not-found' })]);
    const rejected = await rejectMailNotes([ids.theirMail]);
    expect(rejected.items).toEqual([{ noteId: ids.theirMail, status: 'not-found' }]);
    expect(await requeueMailNotes([ids.theirMail])).toBe(0);
    expect((await purgeMailFromGraph({ dryRun: true, noteIds: [ids.theirMail] })).notesRetained).toBe(0);
    expect((await purgeMailFromGraph({ dryRun: true, noteIds: [ids.theirMail], scope: TEST_SCOPE })).notesRetained).toBe(1);
    const [row] = await db.select({ state: intelNotes.graphState }).from(intelNotes).where(eq(intelNotes.id, ids.theirMail));
    expect(row.state).toBe('pending');
  });

  it("mail relevance scores against the scope's entities only", async () => {
    // Anchored because the u_test entity is watched.
    await db.update(intelEntities).set({ watched: true }).where(eq(intelEntities.id, ids.dupA));
    try {
      expect((await loadAnchoredEntities()).some((e) => e.id === ids.dupA)).toBe(false);
      expect((await loadAnchoredEntities(TEST_SCOPE)).some((e) => e.id === ids.dupA)).toBe(true);
      const anchored = new Set([ids.dupA]);
      expect((await nearestAnchored([ids.ownMail], anchored)).has(ids.ownMail)).toBe(false);
      expect((await nearestAnchored([ids.theirMail], anchored, TEST_SCOPE)).get(ids.theirMail)).toBeCloseTo(1, 3);
    } finally {
      await db.update(intelEntities).set({ watched: false }).where(eq(intelEntities.id, ids.dupA));
    }
  });

  it("the owner's duplicate sweep never proposes a member's pair", async () => {
    const pairOf = (r: { keep: { id: string }; merge: { id: string } }) =>
      [r.keep.id, r.merge.id].sort().join('|') === [ids.dupA, ids.dupB].sort().join('|');
    expect((await loadResolvableEntities()).some((e) => e.id === ids.dupA)).toBe(false);
    const owner = await sweepDuplicates(0.35, { semantic: false });
    expect(owner.reports.some(pairOf)).toBe(false);
    const theirs = await sweepDuplicates(0.35, { semantic: false, space: 'u_test' });
    expect(theirs.reports.some(pairOf)).toBe(true);
  });

  it("member contacts do not damp the owner's address signals", async () => {
    const email = `works@${DOMAIN}`;
    expect((await loadAddressNames()).has(email)).toBe(false);
    expect((await loadAddressNames('u_test')).get(email)).toEqual(['Quarnby Holloway Works', 'Quarnby Holloway Works']);
    expect((await loadNeighbourIndex()).has(ids.dupA)).toBe(false);
    expect((await loadNeighbourIndex('u_test')).get(ids.dupA)?.has(ids.depot)).toBe(true);
  });

  it("the adjudicator's dossier is read inside the pair's space", async () => {
    expect((await loadEntityNames([ids.dupA])).size).toBe(0);
    expect((await loadEntityNames([ids.dupA], 'u_test')).get(ids.dupA)).toBe('Quarnby Holloway Works');
    // Held mail is not evidence; admit it for the length of the check.
    await db.update(intelNotes).set({ graphState: 'admitted' }).where(eq(intelNotes.id, ids.theirMail));
    try {
      expect(await loadPairEvidence(ids.dupA, ids.dupB)).toEqual([]);
      expect(await loadCoMentions(ids.dupA, ids.dupB)).toEqual([]);
      expect((await loadPairEvidence(ids.dupA, ids.dupB, 'u_test')).length).toBe(2);
      expect((await loadCoMentions(ids.dupA, ids.dupB, 2, 'u_test')).length).toBe(1);
      expect((await loadEvidenceVersions()).has(ids.dupA)).toBe(false);
      expect((await loadEvidenceVersions('u_test')).has(ids.dupA)).toBe(true);
    } finally {
      await db.update(intelNotes).set({ graphState: 'pending' }).where(eq(intelNotes.id, ids.theirMail));
    }
  });

  it('the conflation candidates are the space’s', async () => {
    expect((await conflationCandidates()).entities.some((e) => e.id === ids.dupA)).toBe(false);
    expect((await conflationCandidates('u_test')).entities.some((e) => e.id === ids.dupA)).toBe(true);
  });

  it("the owner cannot merge, split, link or delete a member's rows by id", async () => {
    await expect(mergeEntities(ids.dupA, ids.dupB)).rejects.toThrow(/not found/);
    await expect(
      splitEntity({ fromId: ids.dupA, to: { entityId: ids.dupB }, relationshipIds: [ids.edge], reason: 'space test' }),
    ).rejects.toThrow(/no such entity/);
    await expect(confirmRelationship({ sourceEntityId: ids.dupA, targetEntityId: ids.depot })).rejects.toThrow(/not found/);
    await expect(rejectRelationship({ sourceEntityId: ids.dupA, targetEntityId: ids.depot })).rejects.toThrow(/not found/);
    const [edge] = await db.select().from(intelRelationships).where(eq(intelRelationships.id, ids.edge));
    expect(edge.suppressed).toBe(false);
    expect(edge.manual).toBe(false);

    expect(await deleteNoteCascade(ids.theirMail)).toBeNull();
    const [still] = await db.select({ id: intelNotes.id }).from(intelNotes).where(eq(intelNotes.id, ids.theirMail));
    expect(still?.id).toBe(ids.theirMail);
  });
});

// Task 12: the routes. A member's request (scope u_test + household) reaching a
// by-id route with the id of a row in ANOTHER space (u_other) must get the same
// 404 as a missing id — and nothing may change — and an every-space operation
// must be refused outright. The seam is mocked; the handlers and the database
// are real.
describe.skipIf(!process.env.DATABASE_URL)('routes answer only within the request scope', () => {
  const ids: Record<string, string> = {};

  /** A handler's status, whether it returned a Response or threw an HttpError. */
  async function statusOf(run: () => Response | Promise<Response>): Promise<number> {
    try {
      return (await run()).status;
    } catch (err) {
      const status = (err as { status?: unknown }).status;
      if (typeof status === 'number') return status;
      throw err;
    }
  }

  /** Just enough of a RequestEvent: the scope comes from the mocked seam. */
  function event(opts: { params?: Record<string, string>; url?: string; body?: unknown; method?: string }) {
    const url = new URL(opts.url ?? 'http://test.local/');
    const request = new Request(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { params: opts.params ?? {}, url, request, locals: { auth: async () => null }, fetch } as any;
  }

  beforeAll(async () => {
    vi.mocked(resolveRequestScope).mockResolvedValue(['u_test', 'household']);
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    const [note] = await db.insert(intelNotes).values({
      title: 'Route space test', rawContent: 'Another member wrote this.', source: 'web', spaceId: 'u_other',
    }).returning({ id: intelNotes.id });
    ids.note = note.id;
    const [theirs] = await db.insert(intelEntities).values({
      name: 'Route space other', typeId: type.id, spaceId: 'u_other', firstSeenIn: note.id,
    }).returning({ id: intelEntities.id });
    ids.theirs = theirs.id;
    const [second] = await db.insert(intelEntities).values({
      name: 'Route space other two', typeId: type.id, spaceId: 'u_other', firstSeenIn: note.id,
    }).returning({ id: intelEntities.id });
    ids.second = second.id;
    const [mine] = await db.insert(intelEntities).values({
      name: 'Route space mine', typeId: type.id, spaceId: 'u_test',
    }).returning({ id: intelEntities.id });
    ids.mine = mine.id;
    const [alert] = await db.insert(intelAlerts).values({
      noteId: note.id, type: 'test', title: 'Route space alert', content: 'x', spaceId: 'u_other',
    }).returning({ id: intelAlerts.id });
    ids.alert = alert.id;
  });

  afterAll(async () => {
    vi.mocked(resolveRequestScope).mockReset();
    // Only if a scope check regressed would these exist: the verdict routes
    // write a decision and a label for the pair. Keyed on this block's own ids.
    if (ids.theirs && ids.second) {
      const key = pairKeyOf(ids.theirs, ids.second);
      await db.delete(intelMatchDecisions).where(eq(intelMatchDecisions.pairKey, key));
      await db.delete(intelResolutionLabels).where(eq(intelResolutionLabels.pairKey, key));
    }
    await db.delete(intelEntities).where(inArray(intelEntities.id, [ids.theirs, ids.second, ids.mine].filter(Boolean)));
    if (ids.note) await db.delete(intelNotes).where(eq(intelNotes.id, ids.note)); // alert cascades
  });

  it('by-id reads 404 for a row in another space, and serve the reader their own', async () => {
    const card = await import('../../../routes/api/jkai/intel/entity-card/+server');
    expect(await statusOf(() => card.GET(event({ url: `http://test.local/?id=${ids.theirs}` })))).toBe(404);
    expect(await statusOf(() => card.GET(event({ url: `http://test.local/?id=${ids.mine}` })))).toBe(200);

    const entity = await import('../../../routes/api/jkai/intel/entities/[id]/+server');
    expect(await statusOf(() => entity.GET(event({ params: { id: ids.theirs } })))).toBe(404);

    const note = await import('../../../routes/api/jkai/intel/notes/[id]/+server');
    expect(await statusOf(() => note.GET(event({ params: { id: ids.note } })))).toBe(404);

    const trust = await import('../../../routes/api/jkai/intel/trust/+server');
    expect(await statusOf(() => trust.GET(event({ url: `http://test.local/?id=${ids.theirs}` })))).toBe(404);
  });

  it('by-id writes 404 for a row in another space and change nothing', async () => {
    const note = await import('../../../routes/api/jkai/intel/notes/[id]/+server');
    // The retry is gated on the note being in scope: processNote reads by id alone.
    expect(await statusOf(() => note.POST(event({ params: { id: ids.note }, body: {} })))).toBe(404);
    expect(await statusOf(() => note.DELETE(event({ params: { id: ids.note }, method: 'DELETE' })))).toBe(404);

    const entity = await import('../../../routes/api/jkai/intel/entities/[id]/+server');
    expect(await statusOf(() => entity.DELETE(event({ params: { id: ids.theirs }, method: 'DELETE' })))).toBe(404);
    expect(await statusOf(() => entity.PUT(event({ params: { id: ids.theirs }, body: { name: 'renamed' }, method: 'PUT' })))).toBe(404);

    const review = await import('../../../routes/api/jkai/intel/review/[id]/+server');
    expect(await statusOf(() => review.POST(event({ params: { id: ids.theirs }, url: 'http://test.local/?action=accept', body: {} })))).toBe(404);
    expect(await statusOf(() => review.POST(event({ params: { id: ids.theirs }, url: 'http://test.local/?action=reject', body: {} })))).toBe(404);

    const alert = await import('../../../routes/api/jkai/intel/alerts/[id]/+server');
    expect(await statusOf(() => alert.PUT(event({ params: { id: ids.alert }, body: {}, method: 'PUT' })))).toBe(404);

    const triage = await import('../../../routes/api/jkai/intel/triage/+server');
    expect(await statusOf(() => triage.POST(event({ body: { action: 'confirm', entityId: ids.theirs } })))).toBe(404);
    expect(await statusOf(() => triage.POST(event({ body: { action: 'dismiss-alert', alertId: ids.alert } })))).toBe(404);

    // A library that THROWS for an out-of-scope id: a 404, not the old 400/500.
    const duplicates = await import('../../../routes/api/jkai/intel/duplicates/+server');
    expect(await statusOf(() => duplicates.POST(event({ body: { action: 'merge', keepId: ids.theirs, mergeId: ids.second } })))).toBe(404);
    expect(await statusOf(() => duplicates.POST(event({ body: { action: 'not-duplicate', aId: ids.theirs, bId: ids.second } })))).toBe(404);
    expect(await statusOf(() => duplicates.POST(event({ body: { action: 'unmerge', entityId: ids.theirs } })))).toBe(404);

    const [n] = await db.select({ id: intelNotes.id }).from(intelNotes).where(eq(intelNotes.id, ids.note));
    expect(n?.id).toBe(ids.note);
    const ents = await db.select({ id: intelEntities.id, name: intelEntities.name, confirmed: intelEntities.confirmed })
      .from(intelEntities).where(inArray(intelEntities.id, [ids.theirs, ids.second]));
    expect(ents).toHaveLength(2);
    expect(ents.every((e) => !e.confirmed && e.name.startsWith('Route space other'))).toBe(true);
    const [a] = await db.select({ dismissed: intelAlerts.dismissed }).from(intelAlerts).where(eq(intelAlerts.id, ids.alert));
    expect(a.dismissed).toBe(false);
  });

  it("refuses a member every-space operation, and the owner's roster", async () => {
    // Every destructive path behind these gates is a throwing spy (see the
    // tripwires at the top of the file), and each is asserted never called: a
    // regressed gate fails this test without applying anything.
    const cleanupSpy = vi.mocked(cleanupIntelligence);
    cleanupSpy.mockClear();
    vi.mocked(buildClusterRoster).mockClear();
    vi.mocked(recalculateClusterRoster).mockClear();
    vi.mocked(recordIntelRun).mockClear();

    const cleanup = await import('../../../routes/api/jkai/intel/cleanup/+server');
    expect(await statusOf(() => cleanup.POST(event({ body: { action: 'run' } })))).toBe(403);
    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(vi.mocked(recordIntelRun)).not.toHaveBeenCalled();

    // A type id that cannot exist: even past a regressed gate the DELETE matches no row.
    const review = await import('../../../routes/api/jkai/intel/review/[id]/+server');
    expect(await statusOf(() => review.POST(event({ params: { id: `no-such-type-${crypto.randomUUID()}` }, url: 'http://test.local/?action=delete-type', body: {} })))).toBe(403);

    const clusters = await import('../../../routes/api/jkai/intel/clusters/+server');
    expect(await statusOf(() => clusters.GET(event({})))).toBe(403);
    expect(await statusOf(() => clusters.POST(event({ body: { action: 'recalculate' } })))).toBe(403);
    expect(vi.mocked(buildClusterRoster)).not.toHaveBeenCalled();
    expect(vi.mocked(recalculateClusterRoster)).not.toHaveBeenCalled();

    // The taxonomy writers are raw statements in the route itself, so no spy can
    // stand behind the gate. The body is an action the handler REJECTS (400)
    // after the gate, so a regression shows as 400 — never as a write.
    const taxonomy = await import('../../../routes/api/jkai/intel/taxonomy/+server');
    expect(await statusOf(() => taxonomy.POST(event({ body: { action: 'tripwire-no-such-action' } })))).toBe(403);
  });
});

// Task 13: the owner-only consumers OUTSIDE the intel library — chat's graph
// tools, memory recall, daydream, news, the mail passage index, the deep-dive
// commit, the context router and the thread inspector. None of them is a
// member's surface, so each is fixed to the owner's scope: a u_test thread, its
// entities, an edge, a dated event, a finding and a memory linked to one of
// them must never reach any of them. Where a reader takes a scope, the same
// call pointed at u_test finds the rows, so the absence is the predicate.
describe.skipIf(!process.env.DATABASE_URL)('owner-only consumers never see another space', () => {
  const TEST_SCOPE = ['u_test', 'household'] as const;
  const vec = Array.from({ length: 1536 }, (_, i) => (i === 13 ? 1 : 0));
  const tag = crypto.randomUUID().slice(0, 8);
  const ids = {
    mail: '', research: '', quarry: '', holdings: '', event: '', insight: '', memory: '', conversation: '',
    session: crypto.randomUUID(), newsKey: `space-test-news-${tag}`,
  };

  beforeAll(async () => {
    vi.mocked(generateEmbedding).mockImplementation(async () => vec);
    const { embedQuery } = await import('$lib/mail-index/embed');
    vi.mocked(embedQuery).mockImplementation(async () => vec);

    const [conv] = await db.insert(conversations).values({ title: `Space test ${tag}` }).returning({ id: conversations.id });
    ids.conversation = conv.id;
    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
    // One thread that every consumer has a reason to read: a bulk offer mail,
    // kept from the news desk, derived from a chat thread, and indexed.
    const [mail] = await db.insert(intelNotes).values({
      title: 'Plimsworth Quarry: 20% off your next visit, use code PLIMS20',
      rawContent: 'Plimsworth Quarry is offering 20% off. Use code PLIMS20 before it expires.',
      processedContent: 'Plimsworth Quarry is offering 20% off.',
      source: 'email', status: 'processed', graphState: 'admitted', spaceId: 'u_test', embedding: vec,
      observedAt: new Date(),
      metadata: {
        emailKind: 'bulk', senderDomain: 'plimsworth.example', channel: 'gmail', gmailThreadId: `space-test-${tag}`,
        newsKey: ids.newsKey, autoKind: 'chat', refId: conv.id,
      },
    }).returning({ id: intelNotes.id });
    ids.mail = mail.id;
    const [research] = await db.insert(intelNotes).values({
      title: 'Plimsworth Quarry research', rawContent: 'A committed deep dive.', source: 'research',
      status: 'processed', graphState: 'admitted', spaceId: 'u_test',
      metadata: { autoKind: 'research', refId: ids.session },
    }).returning({ id: intelNotes.id });
    ids.research = research.id;
    const [quarry] = await db.insert(intelEntities).values({
      name: 'Plimsworth Quarry', typeId: type.id, spaceId: 'u_test', firstSeenIn: mail.id,
      summary: 'A quarry.', embedding: vec, watched: true, confirmed: true,
    }).returning({ id: intelEntities.id });
    const [holdings] = await db.insert(intelEntities).values({
      name: 'Plimsworth Holdings', typeId: type.id, spaceId: 'u_test', firstSeenIn: mail.id,
    }).returning({ id: intelEntities.id });
    ids.quarry = quarry.id;
    ids.holdings = holdings.id;
    await db.insert(intelNoteEntities).values([
      { noteId: mail.id, entityId: quarry.id, relevance: 'primary' },
      { noteId: mail.id, entityId: holdings.id, relevance: 'primary' },
    ]);
    await db.insert(intelRelationships).values({
      sourceEntityId: holdings.id, targetEntityId: quarry.id, type: 'owns', label: 'owns', sourceNoteId: mail.id, spaceId: 'u_test',
    });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const [ev] = await db.insert(intelTimelineEvents).values({
      noteId: mail.id, entityId: quarry.id, date: tomorrow, type: 'deadline', title: 'Plimsworth Quarry renewal', spaceId: 'u_test',
    }).returning({ id: intelTimelineEvents.id });
    ids.event = ev.id;
    const [insight] = await db.insert(intelInsights).values({
      kind: 'broker', title: 'Plimsworth Quarry finding', explanation: 'x', entityIds: [quarry.id],
      dedupeKey: `space-test-${tag}`, spaceId: 'u_test',
    }).returning({ id: intelInsights.id });
    ids.insight = insight.id;
    const [memory] = await db.insert(jkaiMemories).values({
      category: 'places', content: `Space test ${tag}: the quarry visit`,
    }).returning({ id: jkaiMemories.id });
    ids.memory = memory.id;
    await db.insert(jkaiMemoryEntities).values({ memoryId: memory.id, entityId: quarry.id, method: 'review' });
    await db.insert(mailEmbeddings).values({
      noteId: mail.id, contentHash: 'space-test', chunkOrd: 0, source: 'Plimsworth Quarry offer', part: 'body',
      text: 'Plimsworth Quarry is offering 20% off.', charStart: 0, charEnd: 38,
      embeddingModel: 'space-test', embeddingDim: 1536, embedding: vec,
    });
  });

  afterAll(async () => {
    vi.mocked(generateEmbedding).mockImplementation(async () => { throw new Error('offline'); });
    // The memory first (its links cascade), then the entities (edges, events and
    // note links cascade), then the notes (mail passages cascade).
    if (ids.memory) await db.delete(jkaiMemories).where(eq(jkaiMemories.id, ids.memory));
    if (ids.insight) await db.delete(intelInsights).where(eq(intelInsights.id, ids.insight));
    if (ids.event) await db.delete(intelTimelineEvents).where(eq(intelTimelineEvents.id, ids.event));
    const entityIds = [ids.quarry, ids.holdings].filter(Boolean);
    if (entityIds.length) await db.delete(intelEntities).where(inArray(intelEntities.id, entityIds));
    const noteIds = [ids.mail, ids.research].filter(Boolean);
    if (noteIds.length) await db.delete(intelNotes).where(inArray(intelNotes.id, noteIds));
    if (ids.conversation) await db.delete(conversations).where(eq(conversations.id, ids.conversation));
  });

  it("chat's intel_find tool", async () => {
    await import('$lib/workflows/site-tools/tools/intel-graph');
    const { tools } = await import('$lib/workflows/site-tools/registry-internal');
    const find = tools.find((t) => t.name === 'intel_find');
    const res = await find!.handler({ query: 'Plimsworth' });
    const found = ((res.data as { entities?: Array<{ id: string }> })?.entities ?? []).map((e) => e.id);
    expect(found).not.toContain(ids.quarry);
    expect(found).not.toContain(ids.holdings);
    // The tool takes no scope; the graph it reads does, and u_test's has them.
    const { getGraphAnalysis } = await import('./analytics/load');
    expect((await getGraphAnalysis(true, { scope: TEST_SCOPE })).index.byId.has(ids.quarry)).toBe(true);
  });

  it('memory recall and memory links', async () => {
    const { graphMemoryIds, memoryLinks, setMemoryLinks } = await import('$lib/jkai/memory/graph.server');
    expect(await graphMemoryIds('what happened at Plimsworth Quarry')).not.toContain(ids.memory);
    expect(await memoryLinks([ids.memory])).toEqual([]);
    expect(await graphMemoryIds('what happened at Plimsworth Quarry', TEST_SCOPE)).toContain(ids.memory);
    expect((await memoryLinks([ids.memory], TEST_SCOPE)).map((l) => l.id)).toEqual([ids.quarry]);
    // A memory is the owner's: linking it to another space's entity is refused
    // before anything is replaced.
    await expect(setMemoryLinks(ids.memory, [ids.quarry])).rejects.toThrow(/changed/);
    expect((await memoryLinks([ids.memory], TEST_SCOPE)).map((l) => l.id)).toEqual([ids.quarry]);
  });

  it("a daydream thought's evidence", async () => {
    const { resolveEvidence } = await import('$lib/daydream/evidence');
    const out = await resolveEvidence([
      { kind: 'email', id: ids.mail },
      { kind: 'intel', id: ids.insight },
      { kind: 'intel-entity', id: ids.quarry },
      { kind: 'interest', id: ids.mail },
    ]);
    const by = (kind: string) => out.find((r) => r.kind === kind)!;
    expect(by('email').missing).toBe(true);
    expect(by('intel').missing).toBe(true);
    expect(by('intel-entity').missing).toBe(true);
    expect(by('interest').href).not.toContain(ids.mail);
    expect(JSON.stringify(out)).not.toContain('Plimsworth');
  });

  it('daydream offers, money and the deep-dive commit', async () => {
    const { findOfferCandidates } = await import('$lib/daydream/offers');
    expect((await findOfferCandidates(50)).some((c) => c.noteId === ids.mail)).toBe(false);
    const { loadMoney } = await import('$lib/daydream/ledger');
    expect((await loadMoney()).renewals.some((r) => r.id === ids.event)).toBe(false);
    const { commitState } = await import('$lib/deepdive/graph-commit');
    expect((await commitState(ids.session)).committed).toBe(false);
  });

  it('the news desk', async () => {
    const { keptKeysFor, getNewsStats } = await import('$lib/news/stats');
    expect((await keptKeysFor([ids.newsKey])).has(ids.newsKey)).toBe(false);
    expect(typeof (await getNewsStats('space-test')).retainedCount).toBe('number');
    const { loadAnchors, clearAnchorCache } = await import('$lib/news/correlate.server');
    clearAnchorCache();
    const { anchors } = await loadAnchors();
    clearAnchorCache();
    expect(anchors.some((a) => a.id === ids.quarry || a.id === ids.holdings)).toBe(false);
  });

  it('the mail passage index', async () => {
    const { searchMail, readMail } = await import('$lib/mail-index/search');
    expect((await searchMail('Plimsworth offer', { minSim: 0 })).some((h) => h.noteId === ids.mail)).toBe(false);
    expect(await readMail(ids.mail)).toBeNull();
  });

  it("the context router's anchors, and the thread inspector", async () => {
    const { resolveAnchors } = await import('$lib/jkai/grounding/context-route.server');
    expect(await resolveAnchors(['Plimsworth Quarry'])).toEqual([]);
    const { buildThreadGraph } = await import('$lib/jkai/thread-graph.server');
    const graph = await buildThreadGraph(ids.conversation, { full: true });
    expect(graph.nodes.some((n) => n.id === `entity:${ids.quarry}`)).toBe(false);
    const { composeDrill } = await import('$lib/jkai/context-panel/drill.server');
    expect(await composeDrill(ids.conversation, { kind: 'entity', id: ids.quarry })).toBeNull();
  });
});
