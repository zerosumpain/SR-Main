/**
 * The purge, against a real database.
 *
 * This is the one operation in the feature that cannot be made safe by being
 * careful in review: it deletes thousands of rows across seven tables, and the
 * two ways it can be wrong are both silent.
 *
 *   - Delete too much — take out the notes daydreaming reads, an entity the
 *     owner watched, or an edge they drew by hand. Nobody notices for weeks.
 *   - Delete too little — leave an orphaned entity or a dangling edge behind, so
 *     the graph still says "5% savings ending" after a purge that reported
 *     success. The subtle version of this is honouring `confirmed`, which reads
 *     like a human verdict and is written by a machine.
 *
 * So this builds a small graph with one of each case in it, purges, and checks
 * every survivor and every casualty by name.
 *
 * Excluded from the merge gate (`*.integration.test.ts`) because it needs a
 * database. Skips itself cleanly when there is none. Run it deliberately:
 *   npx vitest run src/lib/jkai/intel/mail-purge.integration.test.ts
 *
 * Everything it writes is prefixed and deleted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  intelEntities,
  intelEntityTypes,
  intelNoteEntities,
  intelNotes,
  intelRelationships,
  intelTimelineEvents,
} from '$lib/db/schema';
import { purgeMailFromGraph } from './mail-purge';

const TAG = 'itest-mail-purge';
let dbReady = false;

const ids = {
  emailNote: '',
  otherNote: '',
  junkEntity: '',
  sharedEntity: '',
  watchedEntity: '',
  autoConfirmedEntity: '',
  typeId: '',
};

async function cleanup() {
  const notes = await db.select({ id: intelNotes.id }).from(intelNotes).where(like(intelNotes.title, `${TAG}%`));
  const noteIds = notes.map((n) => n.id);
  if (noteIds.length) {
    await db.delete(intelRelationships).where(inArray(intelRelationships.sourceNoteId, noteIds));
    await db.delete(intelTimelineEvents).where(inArray(intelTimelineEvents.noteId, noteIds));
    await db.delete(intelNoteEntities).where(inArray(intelNoteEntities.noteId, noteIds));
  }
  await db.delete(intelEntities).where(like(intelEntities.name, `${TAG}%`));
  await db.delete(intelNotes).where(like(intelNotes.title, `${TAG}%`));
  await db.delete(intelEntityTypes).where(like(intelEntityTypes.name, `${TAG}%`));
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

  const [emailNote] = await db
    .insert(intelNotes)
    .values({
      title: `${TAG} marketing thread`,
      rawContent: 'Subject: 30% off\n\nbuy things',
      source: 'email',
      format: 'summary',
      status: 'processed',
      graphState: 'admitted',
      metadata: { channel: 'gmail', gmailThreadId: `${TAG}-1`, emailKind: 'bulk' },
    })
    .returning({ id: intelNotes.id });
  ids.emailNote = emailNote.id;

  const [otherNote] = await db
    .insert(intelNotes)
    .values({
      title: `${TAG} a real document`,
      rawContent: 'a report',
      source: 'file',
      format: 'summary',
      status: 'processed',
    })
    .returning({ id: intelNotes.id });
  ids.otherNote = otherNote.id;

  const rows = await db
    .insert(intelEntities)
    .values([
      // Asserted only by the email. Should go.
      { name: `${TAG} 5% savings ending`, typeId: ids.typeId },
      // Asserted by the email AND a file. Should survive.
      { name: `${TAG} a real organisation`, typeId: ids.typeId },
      // Asserted only by the email, but the owner put it on the watchlist.
      // Deliberately ALSO carries `confirmed`, because that flag is written
      // automatically by graph.ts and must not be what saves it — 5,875 junk
      // entities carried it on production.
      { name: `${TAG} watched thing`, typeId: ids.typeId, confirmed: true, watched: true },
      // Machine-confirmed and nothing else. Must NOT survive.
      { name: `${TAG} auto-confirmed junk`, typeId: ids.typeId, confirmed: true },
    ])
    .returning({ id: intelEntities.id, name: intelEntities.name });
  ids.junkEntity = rows.find((r) => r.name.includes('savings'))!.id;
  ids.sharedEntity = rows.find((r) => r.name.includes('organisation'))!.id;
  ids.watchedEntity = rows.find((r) => r.name.includes('watched'))!.id;
  ids.autoConfirmedEntity = rows.find((r) => r.name.includes('auto-confirmed'))!.id;

  await db.insert(intelNoteEntities).values([
    { noteId: ids.emailNote, entityId: ids.junkEntity, relevance: 'mentioned' },
    { noteId: ids.emailNote, entityId: ids.sharedEntity, relevance: 'mentioned' },
    { noteId: ids.otherNote, entityId: ids.sharedEntity, relevance: 'mentioned' },
    { noteId: ids.emailNote, entityId: ids.watchedEntity, relevance: 'mentioned' },
    { noteId: ids.emailNote, entityId: ids.autoConfirmedEntity, relevance: 'mentioned' },
  ]);

  await db.insert(intelRelationships).values([
    // Machine-extracted from the email. Should go.
    { sourceEntityId: ids.junkEntity, targetEntityId: ids.sharedEntity, type: 'offers', sourceNoteId: ids.emailNote },
    // Drawn by hand, cited to the email. Should survive, provenance cleared.
    { sourceEntityId: ids.sharedEntity, targetEntityId: ids.watchedEntity, type: 'works_with', sourceNoteId: ids.emailNote, manual: true },
  ]);

  await db.insert(intelTimelineEvents).values({
    noteId: ids.emailNote,
    entityId: ids.junkEntity,
    date: '2026-08-20',
    type: 'mention',
    title: `${TAG} sale ends`,
  });
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('purgeMailFromGraph', () => {
  it('forecasts without writing, then deletes what it forecast', async () => {
    if (!dbReady) return;

    const dry = await purgeMailFromGraph({ dryRun: true, noteIds: [ids.emailNote] });
    expect(dry.dryRun).toBe(true);
    // The junk entity AND the merely-auto-confirmed one.
    expect(dry.entitiesRemoved).toBe(2);
    expect(dry.relationshipsRemoved).toBe(1);
    expect(dry.relationshipsKeptManual).toBe(1);
    expect(dry.entitiesKeptOwned).toBe(1);
    expect(dry.entitiesKeptOtherEvidence).toBe(1);

    // A dry run must not have touched anything.
    const stillThere = await db
      .select({ id: intelEntities.id })
      .from(intelEntities)
      .where(eq(intelEntities.id, ids.junkEntity));
    expect(stillThere).toHaveLength(1);

    const real = await purgeMailFromGraph({ noteIds: [ids.emailNote] });
    expect(real.entitiesRemoved).toBe(dry.entitiesRemoved);
    expect(real.relationshipsRemoved).toBe(dry.relationshipsRemoved);
  });

  it('keeps the note, because daydreaming reads it', async () => {
    if (!dbReady) return;
    const [note] = await db
      .select({ id: intelNotes.id, graphState: intelNotes.graphState, rawContent: intelNotes.rawContent })
      .from(intelNotes)
      .where(eq(intelNotes.id, ids.emailNote));
    expect(note).toBeDefined();
    expect(note.graphState).toBe('pending');
    // The body has to survive intact — daydream/offers.ts and spend/read.ts
    // both read it, and a purge that emptied it would break vouchers and the
    // spend series without any error anywhere.
    expect(note.rawContent).toContain('buy things');
  });

  it('removes an entity only the email asserted', async () => {
    if (!dbReady) return;
    const rows = await db.select({ id: intelEntities.id }).from(intelEntities).where(eq(intelEntities.id, ids.junkEntity));
    expect(rows).toHaveLength(0);
  });

  it('keeps an entity a non-email note also asserts', async () => {
    if (!dbReady) return;
    const rows = await db.select({ id: intelEntities.id }).from(intelEntities).where(eq(intelEntities.id, ids.sharedEntity));
    expect(rows).toHaveLength(1);
  });

  it('keeps an entity the owner watched, even with no other evidence', async () => {
    if (!dbReady) return;
    const rows = await db.select({ id: intelEntities.id }).from(intelEntities).where(eq(intelEntities.id, ids.watchedEntity));
    expect(rows).toHaveLength(1);
  });

  it('does NOT keep an entity that is merely machine-confirmed', async () => {
    // The correction this whole guard turns on. `confirmed` is written by
    // graph.ts on any re-assertion at high confidence, so honouring it would
    // have preserved 5,875 of the 8,974 junk entities on production and turned
    // a total reset into a two-thirds one.
    if (!dbReady) return;
    const rows = await db
      .select({ id: intelEntities.id })
      .from(intelEntities)
      .where(eq(intelEntities.id, ids.autoConfirmedEntity));
    expect(rows).toHaveLength(0);
  });

  it('keeps a hand-drawn edge but clears its dead citation', async () => {
    if (!dbReady) return;
    const rows = await db
      .select({ id: intelRelationships.id, sourceNoteId: intelRelationships.sourceNoteId, manual: intelRelationships.manual })
      .from(intelRelationships)
      .where(eq(intelRelationships.sourceEntityId, ids.sharedEntity));
    expect(rows).toHaveLength(1);
    expect(rows[0].manual).toBe(true);
    expect(rows[0].sourceNoteId).toBe(null);
  });

  it('leaves no dangling timeline event or evidence link behind', async () => {
    if (!dbReady) return;
    const events = await db
      .select({ id: intelTimelineEvents.id })
      .from(intelTimelineEvents)
      .where(eq(intelTimelineEvents.noteId, ids.emailNote));
    expect(events).toHaveLength(0);

    const links = await db
      .select({ entityId: intelNoteEntities.entityId })
      .from(intelNoteEntities)
      .where(eq(intelNoteEntities.noteId, ids.emailNote));
    expect(links).toHaveLength(0);
  });

  it('is idempotent — a second purge finds nothing left to do', async () => {
    if (!dbReady) return;
    const again = await purgeMailFromGraph({ noteIds: [ids.emailNote] });
    expect(again.entitiesRemoved).toBe(0);
    expect(again.relationshipsRemoved).toBe(0);
    expect(again.notesHeld).toBe(0);
  });

  it('never touches a note from another source', async () => {
    if (!dbReady) return;
    const [other] = await db
      .select({ id: intelNotes.id, graphState: intelNotes.graphState })
      .from(intelNotes)
      .where(eq(intelNotes.id, ids.otherNote));
    expect(other.graphState).toBe('admitted');
  });
});
