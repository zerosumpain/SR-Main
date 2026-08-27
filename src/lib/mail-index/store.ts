// Passage-level search over ADMITTED email.
//
// A note has always carried one embedding of the whole thread. That is enough
// to say "this thread is about procurement" and useless for "what did they say
// the deadline was" — the answer is one sentence inside 2,000 words, and a
// single vector over the whole thing dilutes it to nothing. So an admitted
// thread is chunked, exactly like a /drive document, into the SAME vector space
// (`text-embedding-3-small`, 1536-dim, unit-normalized) so one query can rank
// mail and files together without embedding twice.
//
// Attachments are handled by NOT handling them here. Their bytes are saved into
// /drive on admission and `$lib/file-index` indexes them like any other upload,
// which is why an admitted attachment is previewable, citable and searchable
// without this module knowing what a PDF is. What lands here is the mail text:
// the body, plus each attachment's extracted text as its own chunk run so a hit
// can say which document it came from.
//
// Only admitted mail is indexed, and that is the cost story. 2,781 held threads
// cost nothing at all; the corpus grows only as fast as the owner says yes.

import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { mailEmbeddings, intelNotes, type NewMailEmbedding } from '$lib/db/schema';
import { chunkText } from '$lib/rag/chunk';
import { embedChunks, MAIL_INDEX_EMBEDDING_MODEL } from './embed';

/** Text from one attachment, ready to be indexed as its own chunk run. */
export interface MailAttachmentText {
  filename: string;
  text: string;
}

export interface IndexMailInput {
  noteId: string;
  /** Thread subject — the citation label. */
  subject: string;
  /** The thread body, quote-stripped, as the note already stores it. */
  body: string;
  attachments?: MailAttachmentText[];
  /** The note's `metadata.contentHash`, so a re-index can be skipped. */
  contentHash: string;
}

export type IndexMailResult =
  | { status: 'indexed'; chunkCount: number }
  | { status: 'skipped'; reason: 'no-text' | 'unchanged' }
  | { status: 'error'; reason: string };

/** Remove every chunk for a note. Used when a thread is taken back out. */
export async function removeMail(noteId: string): Promise<void> {
  await db.delete(mailEmbeddings).where(eq(mailEmbeddings.noteId, noteId));
}

/**
 * Chunk, embed and store one admitted thread.
 *
 * Idempotent on `contentHash`: re-admitting an unchanged thread costs nothing,
 * and a thread that gained a reply re-indexes in full rather than appending —
 * appending would leave the superseded chunks in the index forever, and a
 * search that returns a passage from a version of the thread that no longer
 * exists is worse than one that returns nothing.
 */
export async function indexMail(input: IndexMailInput): Promise<IndexMailResult> {
  const { noteId, subject, contentHash } = input;

  const existing = await db
    .select({ hash: mailEmbeddings.contentHash })
    .from(mailEmbeddings)
    .where(eq(mailEmbeddings.noteId, noteId))
    .limit(1);
  if (existing.length && existing[0].hash === contentHash) {
    return { status: 'skipped', reason: 'unchanged' };
  }

  // Every chunk carries the subject as a prefix, because a passage torn out of
  // the middle of a thread has no idea what conversation it belongs to and
  // neither does its vector. Costs a few tokens per chunk and is the difference
  // between "the deadline is the 14th" matching a query about the tender and
  // matching nothing at all.
  const runs: Array<{ part: 'body' | 'attachment'; filename: string | null; text: string }> = [];
  const body = (input.body ?? '').trim();
  if (body) runs.push({ part: 'body', filename: null, text: body });
  for (const att of input.attachments ?? []) {
    const text = (att.text ?? '').trim();
    if (text) runs.push({ part: 'attachment', filename: att.filename, text });
  }
  if (!runs.length) return { status: 'skipped', reason: 'no-text' };

  const rows: Array<Omit<NewMailEmbedding, 'embedding'> & { _text: string }> = [];
  let ord = 0;
  for (const run of runs) {
    for (const piece of chunkText(run.text)) {
      rows.push({
        noteId,
        contentHash,
        chunkOrd: ord++,
        source: subject.slice(0, 300),
        part: run.part,
        filename: run.filename,
        text: piece.text,
        charStart: piece.charStart,
        charEnd: piece.charEnd,
        embeddingModel: MAIL_INDEX_EMBEDDING_MODEL,
        embeddingDim: 0,
        _text: `${subject}\n\n${piece.text}`,
      });
    }
  }
  if (!rows.length) return { status: 'skipped', reason: 'no-text' };

  let vectors: number[][];
  try {
    vectors = await embedChunks(rows.map((r) => r._text));
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
  const dim = vectors[0]?.length ?? 0;

  // Delete-then-insert inside one transaction: a crash between the two would
  // otherwise leave an admitted thread silently unsearchable, which looks
  // exactly like a thread that was never admitted.
  await db.transaction(async (tx) => {
    await tx.delete(mailEmbeddings).where(eq(mailEmbeddings.noteId, noteId));
    await tx.insert(mailEmbeddings).values(
      rows.map((r, i) => {
        const { _text, ...rest } = r;
        return { ...rest, embeddingDim: dim, embedding: vectors[i] } as NewMailEmbedding;
      }),
    );
  });

  return { status: 'indexed', chunkCount: rows.length };
}

/**
 * Re-index every admitted thread that has no chunks yet.
 *
 * Exists because admission and indexing can come apart: a thread admitted while
 * the embedding gateway was down is in the graph and not in the index, and
 * nothing else would ever notice. Bounded per call so one request cannot walk
 * the whole corpus.
 */
export async function backfillMailIndex(
  limit = 100,
): Promise<{ scanned: number; indexed: number; failed: number; stopped: boolean }> {
  const out = { scanned: 0, indexed: 0, failed: 0, stopped: false };
  const { isCreditOrAuthFailure } = await import('$lib/jkai/llm-client');
  const indexed = await db.selectDistinct({ noteId: mailEmbeddings.noteId }).from(mailEmbeddings);
  const done = new Set(indexed.map((r) => r.noteId));

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
    })
    .from(intelNotes)
    .where(eq(intelNotes.graphState, 'admitted'));

  for (const note of notes) {
    if (note.metadata && (note.metadata as Record<string, unknown>).channel !== 'gmail') continue;
    if (done.has(note.id)) continue;
    if (out.indexed + out.failed >= limit) break;
    out.scanned++;
    const hash = String((note.metadata as Record<string, unknown> | null)?.contentHash ?? '');
    const result = await indexMail({
      noteId: note.id,
      subject: note.title ?? 'Email',
      body: note.rawContent ?? '',
      contentHash: hash,
    });
    if (result.status === 'indexed') {
      out.indexed++;
    } else if (result.status === 'error') {
      // `indexMail` reports an embedding failure as a reason string rather than
      // throwing, so the credit case is recognised from that. Same reasoning as
      // the note backfill: a refusal applies to every remaining thread, and
      // grinding through them produces nothing but identical log lines.
      if (isCreditOrAuthFailure({ status: /\b402\b/.test(result.reason) ? 402 : 0 }) || /insufficient credits/i.test(result.reason)) {
        out.stopped = true;
        console.warn(`[mail-index] embedding provider refused — stopping with ${out.indexed} indexed: ${result.reason}`);
        break;
      }
      out.failed++;
    }
  }
  return out;
}

/** Drop chunks for notes that are no longer admitted. Cheap safety net. */
export async function pruneUnadmittedMail(): Promise<number> {
  const stale = await db
    .select({ id: intelNotes.id })
    .from(intelNotes)
    .where(inArray(intelNotes.graphState, ['pending', 'rejected']));
  if (!stale.length) return 0;
  const ids = stale.map((r) => r.id);
  const result = await db.delete(mailEmbeddings).where(inArray(mailEmbeddings.noteId, ids));
  const count = (result as { rowCount?: number | null } | null)?.rowCount;
  return typeof count === 'number' ? count : 0;
}
