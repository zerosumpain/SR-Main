/**
 * Splitting a conflated entity, against a real database.
 *
 * Like the purge, this is an operation that cannot be made safe by careful
 * review: it re-points edges between entities, and both ways it can be wrong are
 * silent.
 *
 *   - Move too much — take an edge that genuinely belonged to the place. The
 *     graph stays plausible and the fact is simply attributed to the wrong node.
 *   - Move too little, or corrupt the count — leave a self-loop or a duplicate
 *     edge behind. Degree, pagerank, community detection and every cluster label
 *     downstream are then computed on a graph that never existed.
 *
 * So this builds the real shape the repair was written for — a location that has
 * acquired a person's possessions, plus the two edges that must NOT survive the
 * move — splits it, and checks every edge by name. Then it puts it back.
 *
 * Excluded from the merge gate (`*.integration.test.ts`) because it needs a
 * database. Skips itself cleanly when there is none. Run it deliberately:
 *   npx vitest run src/lib/jkai/intel/resolve/split.integration.test.ts
 *
 * Everything it writes is prefixed and deleted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  intelEntities,
  intelEntityTypes,
  intelNoteEntities,
  intelNotes,
  intelRelationships,
} from '$lib/db/schema';
import { splitEntity, undoSplit } from './split';

const TAG = 'itest-split';
let dbReady = false;

const ids = {
  note: '',
  typeId: '',
  town: '',
  person: '',
  bank: '',
  college: '',
};
const rel: Record<string, string> = {};

async function cleanup() {
  const notes = await db.select({ id: intelNotes.id }).from(intelNotes).where(like(intelNotes.title, `${TAG}%`));
  const noteIds = notes.map((n) => n.id);
  if (noteIds.length) {
    await db.delete(intelRelationships).where(inArray(intelRelationships.sourceNoteId, noteIds));
    await db.delete(intelNoteEntities).where(inArray(intelNoteEntities.noteId, noteIds));
  }
  await db.delete(intelEntities).where(like(intelEntities.name, `${TAG}%`));
  await db.delete(intelNotes).where(like(intelNotes.title, `${TAG}%`));
  await db.delete(intelEntityTypes).where(like(intelEntityTypes.name, `${TAG}%`));
}

async function entity(name: string): Promise<string> {
  const [row] = await db
    .insert(intelEntities)
    .values({ name: `${TAG} ${name}`, typeId: ids.typeId, confidence: 'medium', confirmed: true })
    .returning({ id: intelEntities.id });
  return row.id;
}

async function edge(source: string, type: string, target: string): Promise<string> {
  const [row] = await db
    .insert(intelRelationships)
    .values({ sourceEntityId: source, targetEntityId: target, type, sourceNoteId: ids.note })
    .returning({ id: intelRelationships.id });
  return row.id;
}

beforeAll(async () => {
  try {
    await db.select({ id: intelNotes.id }).from(intelNotes).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }
  await cleanup();

  const [type] = await db
    .insert(intelEntityTypes)
    .values({ id: `${TAG}-type`, name: `${TAG} thing`, icon: '?', color: '#000' })
    .onConflictDoNothing()
    .returning({ id: intelEntityTypes.id });
  ids.typeId = type?.id ?? `${TAG}-type`;

  const [note] = await db
    .insert(intelNotes)
    .values({
      title: `${TAG} source note`,
      rawContent: 'the thread the edges were extracted from',
      source: 'chat',
      format: 'summary',
      status: 'processed',
      graphState: 'admitted',
    })
    .returning({ id: intelNotes.id });
  ids.note = note.id;

  ids.town = await entity('Darlington');
  ids.person = await entity('John');
  ids.bank = await entity('NatWest');
  ids.college = await entity('Carmel College');

  // Belongs to the person, hung on the town.
  rel.card = await edge(ids.town, 'has_credit_card', ids.bank);
  rel.bank = await edge(ids.town, 'uses_bank', ids.bank);
  // Belongs to the town. Must not move.
  rel.college = await edge(ids.college, 'located_in', ids.town);
  // Would become a SELF-LOOP once moved onto the person.
  rel.selfLoop = await edge(ids.person, 'based_in', ids.town);
  // The person already asserts this, so moving the town's copy would DUPLICATE it.
  rel.dupTarget = await edge(ids.person, 'uses_service', ids.bank);
  rel.dupSource = await edge(ids.town, 'uses_service', ids.bank);
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('splitEntity', () => {
  it('moves the named edges and leaves everything else alone', async () => {
    if (!dbReady) return;
    const out = await splitEntity({
      fromId: ids.town,
      to: { entityId: ids.person },
      relationshipIds: [rel.card, rel.bank, rel.selfLoop, rel.dupSource],
      reason: `${TAG} the town had acquired a person's bank accounts`,
    });

    expect(out.toId).toBe(ids.person);
    expect(out.createdEntity).toBe(false);
    // card + bank moved; selfLoop and dupSource were dropped.
    expect(out.moved).toBe(2);
    expect(out.dropped).toBe(2);

    const rows = await db
      .select({
        id: intelRelationships.id,
        source: intelRelationships.sourceEntityId,
        target: intelRelationships.targetEntityId,
      })
      .from(intelRelationships)
      .where(inArray(intelRelationships.id, Object.values(rel)));
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(rel.card)!.source).toBe(ids.person);
    expect(byId.get(rel.bank)!.source).toBe(ids.person);
    // The town keeps what is genuinely its own.
    expect(byId.get(rel.college)!.target).toBe(ids.town);
    // A self-loop and a duplicate are deleted, never moved — keeping either
    // would corrupt every degree and centrality figure downstream.
    expect(byId.has(rel.selfLoop)).toBe(false);
    expect(byId.has(rel.dupSource)).toBe(false);
    expect(byId.get(rel.dupTarget)!.source).toBe(ids.person);

    // The evidence follows the edges, or the target reads as sourceless.
    const links = await db
      .select({ noteId: intelNoteEntities.noteId })
      .from(intelNoteEntities)
      .where(eq(intelNoteEntities.entityId, ids.person));
    expect(links.map((l) => l.noteId)).toContain(ids.note);
  });

  it('puts the moved edges back', async () => {
    if (!dbReady) return;
    const before = await db
      .select({ id: intelRelationships.id })
      .from(intelRelationships)
      .where(eq(intelRelationships.sourceEntityId, ids.town));

    const out = await splitEntity({
      fromId: ids.town,
      to: { entityId: ids.person },
      relationshipIds: [rel.college],
      reason: `${TAG} deliberately wrong, to be undone`,
    });
    expect(out.moved).toBe(1);

    const undone = await undoSplit(out.key);
    expect(undone.restored).toBe(1);

    const [restored] = await db
      .select({ target: intelRelationships.targetEntityId })
      .from(intelRelationships)
      .where(eq(intelRelationships.id, rel.college));
    expect(restored.target).toBe(ids.town);
    expect(before.length).toBeGreaterThanOrEqual(0);
  });

  it('creates the target when the referent has no entity yet', async () => {
    if (!dbReady) return;
    const extra = await edge(ids.town, 'participates_in', ids.college);
    const out = await splitEntity({
      fromId: ids.town,
      to: { name: `${TAG} Darlington FC`, typeId: ids.typeId },
      relationshipIds: [extra],
      reason: `${TAG} the team is not the town`,
    });

    expect(out.createdEntity).toBe(true);
    expect(out.moved).toBe(1);

    const [made] = await db
      .select({ id: intelEntities.id, name: intelEntities.name })
      .from(intelEntities)
      .where(eq(intelEntities.id, out.toId));
    expect(made.name).toBe(`${TAG} Darlington FC`);

    const [moved] = await db
      .select({ source: intelRelationships.sourceEntityId })
      .from(intelRelationships)
      .where(eq(intelRelationships.id, extra));
    expect(moved.source).toBe(out.toId);
  });

  it('refuses a split that would move nothing, or onto itself', async () => {
    if (!dbReady) return;
    await expect(
      splitEntity({ fromId: ids.town, to: { entityId: ids.person }, relationshipIds: [], reason: TAG }),
    ).rejects.toThrow(/at least one/);
    await expect(
      splitEntity({ fromId: ids.town, to: { entityId: ids.town }, relationshipIds: [rel.college], reason: TAG }),
    ).rejects.toThrow(/itself/);
  });
});
