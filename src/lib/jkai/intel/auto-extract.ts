// Intel auto-extraction — grows the entity graph from knowledge that arrives
// through other doors.
//
// Until now only hand-written intel notes ran entity extraction; a /drive
// upload or a finished deep dive became vectors and nothing else, so the graph
// only ever knew what you typed into it. This module runs the SAME pipeline
// (extract → persist → embed) over those sources by minting a derived intel
// note per source item.
//
// Deliberately quieter than the note path:
//   - no recall/alert pass and no WhatsApp push (an upload is not an event)
//   - content-hash deduped, so re-indexing an unchanged file costs nothing
//   - text is capped, so one huge PDF can't turn into one huge LLM bill
//   - every failure is swallowed and logged; ingest must never fail because
//     the graph was busy or the model was down
//
// Derived notes are tagged `metadata.autoKind`, which unified recall uses to
// suppress them (the file/research branches already return that text — the
// entities are the new part). Kill switch: INTEL_AUTO_EXTRACT=0.
import { db } from '$lib/db';
import { and, eq, sql } from 'drizzle-orm';
import { intelNotes } from '$lib/db/schema';
import { extractFromNote } from './extract';
import { persistExtraction } from './graph';
import { embedNote } from './embed';

export type AutoKind = 'file' | 'research';

export interface AutoExtractInput {
  kind: AutoKind;
  /** Stable id of the upstream row (file id / research session id). */
  refId: string;
  title: string;
  text: string;
  /** Changes when the upstream content changes; skips re-extraction when equal. */
  contentHash: string;
  /** Extra provenance stored on the derived note. */
  metadata?: Record<string, unknown>;
}

export type AutoExtractOutcome =
  | { status: 'extracted'; noteId: string; entityCount: number }
  | { status: 'unchanged' | 'disabled' | 'too-short' | 'failed'; noteId?: string };

/** Cap the text sent to the model. Enough for a report; not a whole book. */
const MAX_EXTRACT_CHARS = 24_000;
/** Below this there is nothing worth an LLM call. */
const MIN_EXTRACT_CHARS = 200;

export function isAutoExtractEnabled(): boolean {
  // Off in the builder sidecar — that process imports this transitively but
  // must not duplicate ingest work the web app already does.
  if (process.env.JKAI_BUILDER_PROCESS === '1') return false;
  return process.env.INTEL_AUTO_EXTRACT !== '0';
}

async function findDerivedNote(kind: AutoKind, refId: string) {
  const [row] = await db
    .select({ id: intelNotes.id, metadata: intelNotes.metadata })
    .from(intelNotes)
    .where(
      and(
        sql`${intelNotes.metadata}->>'autoKind' = ${kind}`,
        sql`${intelNotes.metadata}->>'refId' = ${refId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Extract entities/relationships/timeline events from an upstream knowledge
 * item into the intel graph. Idempotent per (kind, refId, contentHash).
 */
export async function extractIntoIntel(input: AutoExtractInput): Promise<AutoExtractOutcome> {
  if (!isAutoExtractEnabled()) return { status: 'disabled' };

  const text = (input.text ?? '').trim();
  if (text.length < MIN_EXTRACT_CHARS) return { status: 'too-short' };

  try {
    const existing = await findDerivedNote(input.kind, input.refId);
    if (existing) {
      const prevHash = (existing.metadata as Record<string, unknown> | null)?.contentHash;
      if (prevHash === input.contentHash) return { status: 'unchanged', noteId: existing.id };
    }

    const clipped = text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) : text;
    const metadata = {
      ...(input.metadata ?? {}),
      autoKind: input.kind,
      refId: input.refId,
      contentHash: input.contentHash,
      sourceTag: input.kind,
    };

    // One derived note per source item, reused across re-indexes so the graph
    // does not accumulate a new note every time a file is touched.
    let noteId: string;
    if (existing) {
      noteId = existing.id;
      await db
        .update(intelNotes)
        .set({ title: input.title, rawContent: clipped, status: 'processing', metadata, updatedAt: new Date() })
        .where(eq(intelNotes.id, noteId));
    } else {
      const [created] = await db
        .insert(intelNotes)
        .values({
          title: input.title,
          rawContent: clipped,
          source: input.kind,
          format: 'summary',
          status: 'processing',
          metadata,
        })
        .returning({ id: intelNotes.id });
      noteId = created.id;
    }

    const extraction = await extractFromNote(clipped, 'summary');
    const stats = await persistExtraction(noteId, extraction);

    await db
      .update(intelNotes)
      .set({
        processedContent: clipped,
        title: input.title || extraction.summary.slice(0, 100) || input.kind,
        status: 'processed',
        updatedAt: new Date(),
      })
      .where(eq(intelNotes.id, noteId));

    await embedNote(noteId);

    console.log(
      `[intel:auto] ${input.kind} ${input.refId} → ${stats.entityCount} entities, ${stats.relationshipCount} relationships`,
    );
    return { status: 'extracted', noteId, entityCount: stats.entityCount };
  } catch (err) {
    console.error(
      `[intel:auto] ${input.kind} ${input.refId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return { status: 'failed' };
  }
}

/**
 * Fire-and-forget wrapper for ingest call sites. Never throws, never delays the
 * caller — indexing a file must not wait on an LLM round trip.
 */
export function queueIntelExtraction(input: AutoExtractInput): void {
  if (!isAutoExtractEnabled()) return;
  void extractIntoIntel(input).catch(() => {});
}
