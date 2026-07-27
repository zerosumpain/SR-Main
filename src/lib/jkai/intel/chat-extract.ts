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
import { extractIntoIntel } from './auto-extract';
import { publishConversationSignal } from '$lib/workflows/chat/followup-queue';

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
  let entityCount = 0;
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

    // Signalled rather than fire-and-forgotten. Extraction is an LLM call that
    // takes tens of seconds, and until it lands the reply the user is already
    // reading has no entity links and the graph rail is stale. Telling the open
    // thread when it starts and finishes is what lets the UI fill itself in
    // instead of waiting for a page reload — see ChatArea's `intel` handler.
    publishConversationSignal(conversationId, { type: 'intel', phase: 'running' });

    // `done` fires in a finally: a thread that opened the indicator and never
    // closed it would sit saying "linking…" for the rest of the session, which
    // is a worse failure than no indicator at all.
    try {
      const outcome = await extractIntoIntel({
        kind: 'chat',
        refId: conversationId,
        title: title?.trim() || 'jkai thread',
        text: transcript,
        contentHash: createHash('sha256').update(transcript).digest('hex'),
        metadata: { conversationId, assistantTurns },
      });
      entityCount = outcome.status === 'extracted' ? outcome.entityCount : 0;
    } finally {
      publishConversationSignal(conversationId, { type: 'intel', phase: 'done', entityCount });
    }
  } catch (err) {
    console.error(
      '[intel:chat] thread extraction failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
