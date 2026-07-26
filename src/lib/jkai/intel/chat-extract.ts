// Concept extraction for a /jkai thread.
//
// Feeds the knowledge-graph rail beside the conversation by running the SAME
// intel pipeline a /drive upload or a finished deep dive uses (extract →
// persist → embed), with a derived note per conversation. Nothing here is new
// machinery; `chat` is simply a third AutoKind.
//
// Spend control matters here in a way it doesn't for files: a thread grows
// every turn, and re-extracting on each one would put an LLM call behind every
// reply. So extraction fires on a cadence — early enough that a young thread
// gets a graph, sparse enough that a long one doesn't bill for one per turn.

import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { queueIntelExtraction } from './auto-extract';

/** Assistant-turn counts at which we re-extract: the 2nd turn, then every 4th.
 *  A one-turn thread rarely has a graph worth drawing; by the second there is
 *  usually a subject. */
const FIRST_EXTRACT_TURN = 2;
const EXTRACT_EVERY = 4;

export function shouldExtractAtTurn(assistantTurns: number): boolean {
  if (assistantTurns < FIRST_EXTRACT_TURN) return false;
  if (assistantTurns === FIRST_EXTRACT_TURN) return true;
  return (assistantTurns - FIRST_EXTRACT_TURN) % EXTRACT_EVERY === 0;
}

/** Transcript cap. The intel extractor clips again at its own limit; this keeps
 *  us from loading a huge thread into memory to hand over a slice of it. */
const MAX_TRANSCRIPT_CHARS = 24_000;

/**
 * Queue concept extraction for a thread if it has hit an extraction turn.
 * Fire-and-forget: never throws, never delays the reply.
 */
export async function maybeExtractThreadConcepts(
  conversationId: string,
  title: string | null,
): Promise<void> {
  try {
    const rows = await db
      .select({
        role: orchestratorChats.role,
        content: orchestratorChats.content,
      })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(asc(orchestratorChats.createdAt));

    const assistantTurns = rows.filter((r) => r.role === 'assistant').length;
    if (!shouldExtractAtTurn(assistantTurns)) return;

    // Newest turns matter most for "what is this thread about", so the clip
    // takes the tail, not the head.
    let transcript = rows
      .map((r) => `${r.role === 'assistant' ? 'jkai' : r.role}: ${r.content}`)
      .join('\n\n');
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
    }

    queueIntelExtraction({
      kind: 'chat',
      refId: conversationId,
      title: title?.trim() || 'jkai thread',
      text: transcript,
      contentHash: createHash('sha256').update(transcript).digest('hex'),
      metadata: { conversationId, assistantTurns },
    });
  } catch (err) {
    console.error(
      '[intel:chat] failed to queue thread extraction:',
      err instanceof Error ? err.message : err,
    );
  }
}
