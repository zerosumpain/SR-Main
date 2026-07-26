import { db } from '$lib/db';
import {
  intelNotes,
  intelEntities,
  intelRelationships,
  intelNoteEntities,
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
}

/**
 * Delete a note and every piece of intelligence that was sourced only from it.
 *
 * - Relationships with source_note_id = noteId are deleted.
 * - Entities whose only intel_note_entities link was this note are deleted.
 * - Entities referenced by other notes survive; seed/manual entities with no
 *   note links are unaffected.
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

    // E. Delete orphan entities. FK cascades on intel_relationships
    // (source_entity_id / target_entity_id) remove any surviving
    // relationships that those entities were part of.
    if (orphanIds.length > 0) {
      await tx.delete(intelEntities).where(inArray(intelEntities.id, orphanIds));
    }

    const rowCount = (relResult as { rowCount?: number | null }).rowCount;
    return {
      deleted: true,
      removedRelationships: typeof rowCount === 'number' ? rowCount : 0,
      removedEntities: orphanIds.length,
    };
  });
}
