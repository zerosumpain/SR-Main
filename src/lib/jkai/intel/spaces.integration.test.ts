import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes, intelRelationships } from '$lib/db/schema';
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
