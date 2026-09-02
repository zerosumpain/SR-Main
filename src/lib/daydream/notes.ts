// src/lib/daydream/notes.ts
//
// Saying something back, in your own words.
//
// The feedback vocabulary is a closed phrase list — useful / not that / never —
// which is exactly right for a verdict and no use at all for a reason. The
// reason is the valuable half. A musing about doing more as a family toward the
// end of August was a good call built partly on calendar entries that are
// ROLLING REMINDERS; there was no way to say so. The only available responses
// were to accept a flawed suggestion or mute the whole kind, and neither
// teaches it anything.
//
// So a note is free text, and it becomes a MEMORY. That is the design decision
// worth defending: it could have been a private column daydream alone reads,
// but `confirmPlace` already settled this argument — the useful home for
// something the owner typed is the store every part of jkai already reads. The
// column here is the display copy and the link, not the record.
//
// A note is never interpreted at write time. It goes into the raw archive
// verbatim, then the nightly consolidator extracts a sourced lesson or value.
// Only that durable theme can reach a future ponder pack; the incident-specific
// sentence remains available as provenance.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, jkaiMemories } from '$lib/db/schema';

/** Long enough for a real correction, short enough that a card stays a card. */
export const MAX_NOTE_CHARS = 1000;

export interface NoteResult {
  memoryId: string;
  note: string;
}

/**
 * Record what the owner said about a thought.
 *
 * Deliberately does NOT set feedback. A note is a reason, and a reason is not a
 * verdict: "good, but the dates are wrong" is neither useful nor not-that, and
 * inferring one from the presence of a note would put a number on the ledger
 * that John never gave. The value scoring stays driven by explicit taps and the
 * two inferred sources that already exist.
 *
 * Re-noting supersedes the previous memory rather than leaving two contradictory
 * rows, using the `supersededBy` chain the table already has — same as
 * re-confirming a place.
 */
export async function addNote(thoughtId: string, text: string): Promise<NoteResult> {
  const clean = text.trim().slice(0, MAX_NOTE_CHARS);
  if (!clean) throw new Error('a note needs some words');

  const [thought] = await db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      noteMemoryId: daydreamThoughts.noteMemoryId,
    })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, thoughtId))
    .limit(1);
  if (!thought) throw new Error(`no such thought: ${thoughtId}`);

  // The quoted thought travels with the note, because a note read on its own
  // months later — "some of those are rolling reminders" — is unintelligible
  // without knowing what it was answering.
  const content = `On the daydream suggestion "${thought.title}": ${clean}`;

  const [memory] = await db
    .insert(jkaiMemories)
    .values({ category: 'situations', content, confidence: 'high' })
    .returning({ id: jkaiMemories.id });

  if (thought.noteMemoryId) {
    await db
      .update(jkaiMemories)
      .set({ supersededBy: memory.id, updatedAt: new Date() })
      .where(eq(jkaiMemories.id, thought.noteMemoryId));
  }

  await db
    .update(daydreamThoughts)
    .set({ note: clean, noteMemoryId: memory.id, noteAt: new Date(), updatedAt: new Date() })
    .where(eq(daydreamThoughts.id, thoughtId));

  return { memoryId: memory.id, note: clean };
}

/**
 * Recent notes, as pack cards.
 *
 * Carded separately from the general memory sweep rather than relying on it:
 * the snapshot takes 200 memories with no ordering guarantee, and a correction
 * John typed yesterday about a suggestion the engine is about to make again is
 * the single most valuable card in the pack. It should not be competing for a
 * slot with a two-year-old note about a coffee preference.
 */
export async function recentNotes(limit = 12, withinDays = 90) {
  const since = new Date(Date.now() - withinDays * 86_400_000);
  return db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      note: daydreamThoughts.note,
      noteAt: daydreamThoughts.noteAt,
    })
    .from(daydreamThoughts)
    .where(and(sql`${daydreamThoughts.note} is not null`, gte(daydreamThoughts.noteAt, since)))
    .orderBy(desc(daydreamThoughts.noteAt))
    .limit(limit);
}
