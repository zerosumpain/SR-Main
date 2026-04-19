import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
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
  source: 'web' | 'whatsapp' | 'pwa' | 'email';
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
      processedContent = await transcribeAudio(attachment);
    } else if (note.format === 'email') {
      const parsed = parseEmail(note.rawContent);
      processedContent = parsed.subject
        ? `Subject: ${parsed.subject}\nFrom: ${parsed.from}\n\n${parsed.body}`
        : parsed.body;
    }

    const extraction = await extractFromNote(processedContent, note.format);
    const stats = await persistExtraction(noteId, extraction);

    await db
      .update(intelNotes)
      .set({
        processedContent,
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
