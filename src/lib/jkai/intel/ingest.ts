import { db } from '$lib/db';
import {
  intelNotes,
  intelEntities,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
  intelDossierItems,
  intelInsights,
} from '$lib/db/schema';
import { eq, ne, and, inArray } from 'drizzle-orm';
import { extractFromNote } from './extract';
import { persistExtraction } from './graph';
import { ocrHandwriting, transcribeAudio, parseEmail } from './preprocess';
import { embedNote } from './embed';
import { recallAndAlert } from './recall';
import { pushHighAlerts } from './notify';
import type { JkaiAttachment } from '$lib/db/schema';

export interface IngestInput {
  title?: string;
  rawContent: string;
  // 'file' | 'research' are minted by auto-extraction (see ./auto-extract.ts),
  // not by a human writing a note.
  source: 'web' | 'whatsapp' | 'pwa' | 'email' | 'workflow' | 'file' | 'research';
  format: 'text' | 'handwriting_scan' | 'audio_transcript' | 'email' | 'meeting_transcript' | 'summary';
  metadata?: Record<string, unknown>;
  attachment?: JkaiAttachment;
}

export async function createNote(input: IngestInput): Promise<string> {
  const [note] = await db
    .insert(intelNotes)
    .values({
      title: input.title ?? null,
      rawContent: input.rawContent,
      source: input.source,
      format: input.format,
      status: 'pending',
      metadata: input.metadata ?? null,
    })
    .returning({ id: intelNotes.id });

  return note.id;
}

export async function processNote(noteId: string, attachment?: JkaiAttachment): Promise<void> {
  await db.update(intelNotes).set({ status: 'processing' }).where(eq(intelNotes.id, noteId));

  try {
    const [note] = await db
      .select()
      .from(intelNotes)
      .where(eq(intelNotes.id, noteId))
      .limit(1);

    if (!note) throw new Error(`Note ${noteId} not found`);

    let processedContent = note.rawContent;

    if (note.format === 'handwriting_scan' && attachment) {
      processedContent = await ocrHandwriting(attachment);
    } else if (note.format === 'audio_transcript' && attachment) {
      const transcript = await transcribeAudio(attachment);
      if (!transcript) {
        // Mark the note failed rather than extracting entities from a
        // placeholder. Previously a failed transcription became the note body
        // and was fed to the extractor as if it were content.
        await db
          .update(intelNotes)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(intelNotes.id, noteId));
        console.error(`[intel] note ${noteId}: audio transcription failed, not extracting`);
        return;
      }
      processedContent = transcript;
    } else if (note.format === 'email') {
      const parsed = parseEmail(note.rawContent);
      processedContent = parsed.subject
        ? `Subject: ${parsed.subject}\nFrom: ${parsed.from}\n\n${parsed.body}`
        : parsed.body;
    }

    // Persist the processed text BEFORE extracting. The entity summariser that
    // persistExtraction kicks off reads this column as its evidence; written
    // afterwards, it found an empty note and left every entity summary-less.
    await db
      .update(intelNotes)
      .set({ processedContent, updatedAt: new Date() })
      .where(eq(intelNotes.id, noteId));

    const extraction = await extractFromNote(processedContent, note.format);
    const stats = await persistExtraction(noteId, extraction);

    await db
      .update(intelNotes)
      .set({
        title: note.title || extraction.summary.slice(0, 100) || 'Untitled note',
        status: 'processed',
        updatedAt: new Date(),
      })
      .where(eq(intelNotes.id, noteId));

    // Embed the note for semantic search
    await embedNote(noteId);

    // Find connections to existing knowledge and generate alerts
    const alertCount = await recallAndAlert(noteId);

    // Push high-significance alerts to WhatsApp
    if (alertCount > 0) {
      await pushHighAlerts(noteId);
    }

    console.log(
      `[intel] Processed note ${noteId}: ${stats.entityCount} entities, ${stats.relationshipCount} relationships, ${stats.timelineEventCount} timeline events`,
    );
  } catch (err) {
    console.error(`[intel] Failed to process note ${noteId}:`, err);
    await db
      .update(intelNotes)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(intelNotes.id, noteId));
  }
}

export interface CascadeDeleteResult {
  deleted: true;
  removedRelationships: number;
  removedEntities: number;
  /** Derived artefacts that pointed at the deleted entities. */
  removedTimelineEvents: number;
  removedDossierItems: number;
  removedInsights: number;
}

/**
 * Delete a note and every piece of intelligence that was sourced only from it.
 *
 * - Relationships with source_note_id = noteId are deleted.
 * - Entities whose only intel_note_entities link was this note are deleted.
 * - Entities referenced by other notes survive; seed/manual entities with no
 *   note links are unaffected.
 *
 * Everything DOWNSTREAM of a deleted entity goes too. Without this the FK rules
 * quietly leave debris that outlives its source: `intel_timeline_events.entity_id`
 * is `set null`, so an event sourced from another note but *about* a deleted
 * entity became an undated orphan on the timeline; dossier pins and insights hold
 * bare id strings with no FK at all, so they survived as pins and cards
 * referencing something the graph no longer contains; and a merge tombstone whose
 * survivor was deleted made the merged-away row invisible for ever (every graph
 * query excludes `merged_into_id IS NOT NULL`) while never being deleted itself.
 *
 * Runs inside a single transaction. Returns counts for logging / UI use.
 */
export async function deleteNoteCascade(noteId: string): Promise<CascadeDeleteResult> {
  return await db.transaction(async (tx) => {
    // A. Find entities linked to this note.
    const linkedHere = await tx
      .select({ entityId: intelNoteEntities.entityId })
      .from(intelNoteEntities)
      .where(eq(intelNoteEntities.noteId, noteId));
    const candidateIds = [...new Set(linkedHere.map((r) => r.entityId))];

    // B. Of those, find which are linked to a DIFFERENT note. Anything not
    // in that set is orphaned by this deletion.
    let orphanIds: string[] = candidateIds;
    if (candidateIds.length > 0) {
      const linkedElsewhere = await tx
        .select({ entityId: intelNoteEntities.entityId })
        .from(intelNoteEntities)
        .where(
          and(
            inArray(intelNoteEntities.entityId, candidateIds),
            ne(intelNoteEntities.noteId, noteId),
          ),
        );
      const elsewhereSet = new Set(linkedElsewhere.map((r) => r.entityId));
      orphanIds = candidateIds.filter((id) => !elsewhereSet.has(id));
    }

    // C. Delete relationships sourced from this note. Must happen BEFORE the
    // note delete — otherwise the FK rule sets source_note_id = null first
    // and we lose the link that tells us which relationships to remove.
    const relResult = await tx
      .delete(intelRelationships)
      .where(eq(intelRelationships.sourceNoteId, noteId));

    // D. Delete the note. FK cascades handle:
    //    - intel_note_entities rows for this note
    //    - intel_timeline_events rows for this note
    //    - intel_alerts rows for this note
    await tx.delete(intelNotes).where(eq(intelNotes.id, noteId));

    // E. Pull in merge tombstones. A row whose `merged_into_id` points at an
    // entity we are about to delete is an alias of something that will no
    // longer exist — and every graph query filters `merged_into_id IS NULL`, so
    // leaving it behind hides it for ever rather than restoring it. Walked to a
    // fixpoint because a survivor can itself have been merged into.
    const doomed = new Set(orphanIds);
    for (let depth = 0; depth < 8; depth += 1) {
      const frontier = [...doomed];
      if (frontier.length === 0) break;
      const aliases = await tx
        .select({ id: intelEntities.id })
        .from(intelEntities)
        .where(inArray(intelEntities.mergedIntoId, frontier));
      const added = aliases.map((a) => a.id).filter((id) => !doomed.has(id));
      if (added.length === 0) break;
      for (const id of added) doomed.add(id);
    }
    const doomedIds = [...doomed];

    // F. Downstream artefacts that hold entity ids WITHOUT a foreign key, plus
    // timeline events whose `entity_id` would merely be nulled.
    let removedTimelineEvents = 0;
    let removedDossierItems = 0;
    let removedInsights = 0;

    if (doomedIds.length > 0) {
      const timelineResult = await tx
        .delete(intelTimelineEvents)
        .where(inArray(intelTimelineEvents.entityId, doomedIds));
      removedTimelineEvents = rowsAffected(timelineResult);

      const dossierResult = await tx
        .delete(intelDossierItems)
        .where(
          and(
            eq(intelDossierItems.kind, 'entity'),
            inArray(intelDossierItems.refId, doomedIds),
          ),
        );
      removedDossierItems = rowsAffected(dossierResult);

      // `entity_ids` is a jsonb array with no foreign key, so an insight about a
      // deleted entity has nothing left to explain and would render a dead card.
      //
      // Matched in TWO steps rather than with a jsonb `?|` containment query:
      // there are hundreds of insights, not millions, and a jsonb operator
      // spliced through the query builder is exactly the kind of thing that
      // silently matches nothing if the array parameter is bound as a list of
      // scalars. A read-then-delete-by-id is unambiguously correct.
      const doomedSet = new Set(doomedIds);
      const candidateInsights = await tx
        .select({ id: intelInsights.id, entityIds: intelInsights.entityIds })
        .from(intelInsights);
      const staleInsightIds = candidateInsights
        .filter((row) => (row.entityIds ?? []).some((id) => doomedSet.has(id)))
        .map((row) => row.id);
      if (staleInsightIds.length > 0) {
        await tx.delete(intelInsights).where(inArray(intelInsights.id, staleInsightIds));
      }
      removedInsights = staleInsightIds.length;
    }

    // G. Delete the entities themselves. FK cascades on intel_relationships
    // (source_entity_id / target_entity_id) remove any surviving
    // relationships that those entities were part of.
    if (doomedIds.length > 0) {
      await tx.delete(intelEntities).where(inArray(intelEntities.id, doomedIds));
    }

    return {
      deleted: true,
      removedRelationships: rowsAffected(relResult),
      removedEntities: doomedIds.length,
      removedTimelineEvents,
      removedDossierItems,
      removedInsights,
    };
  });
}

/** Drizzle's delete result shape differs per driver; normalise to a number. */
function rowsAffected(result: unknown): number {
  const count = (result as { rowCount?: number | null } | null)?.rowCount;
  return typeof count === 'number' ? count : 0;
}
