// Retrieval over the mail passage index.
//
// Mirrors $lib/file-index/search: embed the query with the pinned model, rank
// by pgvector's `<=>` cosine distance in-database, report similarity. Vectors
// are unit-normalized at write time so cosine distance = 1 − dot.
//
// One addition the files index does not need — every hit carries the thread's
// subject, sender and date, and a link back into Gmail. A passage from a
// document stands on its own; a passage from an email does not, because "we
// agreed the 14th" means nothing until you know who said it and when.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { mailEmbeddings, intelNotes } from '$lib/db/schema';
import { embedQuery } from './embed';

export type MailSearchHit = {
  noteId: string;
  subject: string;
  /** 'body' | 'attachment' — where in the thread this passage came from. */
  part: string;
  /** Attachment filename for an attachment hit; null for the body. */
  filename: string | null;
  chunkOrd: number;
  passage: string;
  score: number;
  /** Sender addresses recorded on the thread. */
  participants: string[];
  /** The thread's own receipt time, not the sweep's clock. */
  observedAt: Date | null;
  /** Deep link into Gmail, when the thread id is known. */
  gmailUrl: string | null;
};

export type MailSearchOptions = { topK?: number; minSim?: number };

const DEFAULT_TOP_K = 8;
const DEFAULT_MIN_SIM = 0.2;
const MAX_PASSAGE_CHARS = 1200;

/**
 * Semantic search over admitted mail. Returns ranked passages.
 *
 * The `graph_state = 'admitted'` join is belt and braces: only admitted threads
 * are ever indexed, so a pending note has no chunks to find. It is here anyway
 * because "only admitted mail is indexed" is an invariant maintained by two
 * other modules, and a search that quietly starts returning unapproved mail is
 * precisely the failure this whole feature exists to prevent.
 */
export async function searchMail(query: string, options: MailSearchOptions = {}): Promise<MailSearchHit[]> {
  const q = (query || '').trim();
  if (!q) return [];
  const topK = Number.isFinite(options.topK) ? Math.min(Math.max(options.topK as number, 1), 30) : DEFAULT_TOP_K;
  const minSim = Number.isFinite(options.minSim) ? (options.minSim as number) : DEFAULT_MIN_SIM;

  const vector = await embedQuery(q);
  if (!vector.length) return [];
  const literal = `[${vector.join(',')}]`;
  const maxDistance = 1 - minSim;

  const distance = sql<number>`${mailEmbeddings.embedding} <=> ${literal}::vector`;

  const rows = await db
    .select({
      noteId: mailEmbeddings.noteId,
      subject: mailEmbeddings.source,
      part: mailEmbeddings.part,
      filename: mailEmbeddings.filename,
      chunkOrd: mailEmbeddings.chunkOrd,
      text: mailEmbeddings.text,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      distance,
    })
    .from(mailEmbeddings)
    .innerJoin(intelNotes, eq(mailEmbeddings.noteId, intelNotes.id))
    .where(
      and(
        eq(intelNotes.graphState, 'admitted'),
        sql`${mailEmbeddings.embedding} <=> ${literal}::vector <= ${maxDistance}`,
      ),
    )
    .orderBy(distance)
    .limit(topK);

  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const threadId = typeof meta.gmailThreadId === 'string' ? meta.gmailThreadId : null;
    return {
      noteId: r.noteId,
      subject: r.subject,
      part: r.part,
      filename: r.filename,
      chunkOrd: r.chunkOrd,
      passage: r.text.length > MAX_PASSAGE_CHARS ? `${r.text.slice(0, MAX_PASSAGE_CHARS)}…` : r.text,
      score: Math.round((1 - Number(r.distance)) * 1000) / 1000,
      participants: Array.isArray(meta.participants) ? meta.participants.map(String) : [],
      observedAt: r.observedAt,
      gmailUrl: threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null,
    };
  });
}

/**
 * Every passage of one thread, in order. The "open it" half of a search hit.
 */
export async function readMail(noteId: string): Promise<{ subject: string; passages: Array<{ part: string; filename: string | null; text: string }> } | null> {
  const rows = await db
    .select({
      subject: mailEmbeddings.source,
      part: mailEmbeddings.part,
      filename: mailEmbeddings.filename,
      text: mailEmbeddings.text,
      chunkOrd: mailEmbeddings.chunkOrd,
    })
    .from(mailEmbeddings)
    .innerJoin(intelNotes, eq(mailEmbeddings.noteId, intelNotes.id))
    .where(and(eq(mailEmbeddings.noteId, noteId), eq(intelNotes.graphState, 'admitted')))
    .orderBy(mailEmbeddings.chunkOrd);
  if (!rows.length) return null;
  return {
    subject: rows[0].subject,
    passages: rows.map((r) => ({ part: r.part, filename: r.filename, text: r.text })),
  };
}

/** How many threads and passages the index holds. For the queue header. */
export async function mailIndexStats(): Promise<{ threads: number; chunks: number }> {
  const [row] = await db
    .select({
      threads: sql<number>`count(distinct ${mailEmbeddings.noteId})::int`,
      chunks: sql<number>`count(*)::int`,
    })
    .from(mailEmbeddings);
  return { threads: Number(row?.threads) || 0, chunks: Number(row?.chunks) || 0 };
}

/** Chunk counts for a set of notes — used to show "indexed" on a queue row. */
export async function chunkCountsFor(noteIds: string[]): Promise<Map<string, number>> {
  if (!noteIds.length) return new Map();
  const rows = await db
    .select({ noteId: mailEmbeddings.noteId, n: sql<number>`count(*)::int` })
    .from(mailEmbeddings)
    .where(inArray(mailEmbeddings.noteId, noteIds))
    .groupBy(mailEmbeddings.noteId);
  return new Map(rows.map((r) => [r.noteId, Number(r.n) || 0]));
}
