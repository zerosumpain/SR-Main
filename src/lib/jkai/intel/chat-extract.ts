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
import { conversations, orchestratorChats } from '$lib/db/schema';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { extractIntoIntel, type AutoExtractOutcome } from './auto-extract';
import { publishConversationSignal } from '$lib/workflows/chat/followup-queue';
import { COMMAND_ECHO_RE } from '$lib/jkai/hermes-frames';

/**
 * Assistant-turn counts at which we re-extract.
 *
 * This used to be "the 2nd turn, then every 4th", which sounded frugal and was
 * in practice a near-total loss of the thread. Measured over production threads
 * on 2026-07-27, the median /jkai conversation runs 3–5 real assistant turns —
 * SHORTER than the 4-turn gap. So the overwhelming majority of threads extracted
 * exactly once, at turn 2, and everything said from turn 3 onwards never reached
 * the graph at all. A thread about the Data Spine had its opening answer
 * extracted and its national-implementation-survey and OpenSAFELY turns — the
 * ones naming jurisdictions, countries and organisations — silently dropped.
 *
 * The fix is a ramp, not a flat "every turn": dense over the range threads
 * actually occupy, thinning out where the old spend control was genuinely
 * earning its keep. A 60-turn marathon still costs ~18 extractions rather than
 * 60, while a normal 3–5 turn thread now extracts on every one of them instead
 * of once.
 */
/** Turns 1..8 — where nearly every real thread lives. Extract on each. */
const DENSE_UNTIL_TURN = 8;
/** Turns 9..24 — thinning out. */
const MID_UNTIL_TURN = 24;
const MID_EVERY = 3;
/** Turn 25 and beyond — a marathon thread; the graph is well fed by now. */
const LATE_EVERY = 6;

export function shouldExtractAtTurn(assistantTurns: number): boolean {
  if (assistantTurns < 1) return false;
  if (assistantTurns <= DENSE_UNTIL_TURN) return true;
  if (assistantTurns <= MID_UNTIL_TURN) {
    return (assistantTurns - DENSE_UNTIL_TURN) % MID_EVERY === 0;
  }
  return (assistantTurns - MID_UNTIL_TURN) % LATE_EVERY === 0;
}

/**
 * Hermes writes its own tool-call progress log into the assistant TEXT stream,
 * so `⚙️ mcp_jkai_knowledge_search: "data spine"` is stored as message content
 * (see $lib/workflows/chat/hermes-tool-log). It is machinery, not knowledge, and
 * feeding it to the extractor invites entities named after MCP tools.
 */
const TOOL_LOG_LINE_RE = /^\s*⚙️.*$/gm;

/**
 * Slash-command output Hermes echoes into the thread as an assistant message —
 * `/model` being the common one. It carries no knowledge about the subject, and
 * before this it both polluted the transcript and counted as a turn, which
 * shifted the extraction cadence off the real replies.
 *
 * Defined in `$lib/jkai/hermes-frames`, which now also uses it to keep the echo
 * off the text channel in the first place. One definition on purpose: a detector
 * kept in two places here has drifted before.
 */

/** The knowledge-bearing text of one assistant turn, or '' if there is none. */
export function cleanAssistantContent(content: string): string {
  if (COMMAND_ECHO_RE.test(content)) return '';
  return content.replace(TOOL_LOG_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Transcript cap. The intel extractor clips again at its own limit; this keeps
 *  us from loading a huge thread into memory to hand over a slice of it. */
const MAX_TRANSCRIPT_CHARS = 24_000;

/**
 * Queue concept extraction for a thread if it has hit an extraction turn.
 * Fire-and-forget: never throws, never delays the reply.
 *
 * `force` bypasses the cadence for the backfill sweep below — a thread already
 * past its extraction turns still needs one pass to pick up everything the old
 * every-4th-turn cadence never showed the extractor.
 */
export async function maybeExtractThreadConcepts(
  conversationId: string,
  title: string | null,
  opts: { force?: boolean } = {},
): Promise<AutoExtractOutcome | undefined> {
  let entityCount = 0;
  try {
    const rows = await db
      .select({
        role: orchestratorChats.role,
        content: orchestratorChats.content,
        metadata: orchestratorChats.metadata,
      })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(asc(orchestratorChats.createdAt));

    // The heartbeat engine posts its own `assistant` rows ("orchestrator paused
    // 3 min ago — waiting on your reply"). They are thread furniture: they say
    // nothing about the subject, and counting them as turns pushed the cadence
    // off the real replies.
    const isHeartbeat = (m: unknown) =>
      !!(m as { heartbeat?: unknown } | null)?.heartbeat;

    const turns: Array<{ role: string; content: string }> = [];
    for (const r of rows) {
      if (isHeartbeat(r.metadata)) continue;
      if (r.role === 'assistant') {
        const cleaned = cleanAssistantContent(r.content);
        if (!cleaned) continue;
        turns.push({ role: 'jkai', content: cleaned });
      } else {
        const cleaned = r.content.trim();
        if (cleaned) turns.push({ role: r.role, content: cleaned });
      }
    }

    const assistantTurns = turns.filter((r) => r.role === 'jkai').length;
    // Forcing still requires a real reply to exist — an empty thread has
    // nothing to extract, and calling the model on one is pure waste.
    if (opts.force ? assistantTurns < 1 : !shouldExtractAtTurn(assistantTurns)) return;

    // Newest turns matter most for "what is this thread about", so the clip
    // takes the tail, not the head.
    let transcript = turns.map((r) => `${r.role}: ${r.content}`).join('\n\n');
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
        // A forced pass is the backfill, and the backfill exists because the
        // EXTRACTOR changed, not the transcript — so the hash gate would skip
        // every thread it is meant to redo.
        force: opts.force,
      });
      entityCount = outcome.status === 'extracted' ? outcome.entityCount : 0;
      return outcome;
    } finally {
      publishConversationSignal(conversationId, { type: 'intel', phase: 'done', entityCount });
    }
  } catch (err) {
    console.error(
      '[intel:chat] thread extraction failed:',
      err instanceof Error ? err.message : err,
    );
    return { status: 'failed' };
  }
}

export interface ThreadBackfillProgress {
  scanned: number;
  extracted: number;
  unchanged: number;
  skipped: number;
  failed: number;
  entities: number;
  truncated: boolean;
}

/**
 * Re-extract existing /jkai threads.
 *
 * Needed once because the old cadence (turn 2, then every 4th) was longer than
 * the median thread, so every thread in production had been extracted exactly
 * once — from its opening exchange only. Nothing said afterwards had ever been
 * shown to the extractor, so the graph is missing most of what was discussed.
 * Re-running is not a no-op the way a file backfill is: the transcript is longer
 * AND cleaner now, so the content hash differs and real work happens.
 *
 * Newest threads first — those are the ones being looked at. Sequential, for the
 * same reason the file/research sweep is: each item is an LLM call.
 */
export async function backfillThreadConcepts(
  opts: { limit?: number } = {},
): Promise<ThreadBackfillProgress> {
  const workLimit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const progress: ThreadBackfillProgress = {
    scanned: 0,
    extracted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    entities: 0,
    truncated: false,
  };

  // Only threads that actually contain an assistant reply. `conversations`
  // rows are created on first open, so most of the table is empty shells.
  const rows = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(
      sql`EXISTS (
        SELECT 1 FROM orchestrator_chats c
        WHERE c.conversation_id = ${conversations.id} AND c.role = 'assistant'
      )`,
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(workLimit * 3);

  let worked = 0;
  for (const row of rows) {
    if (worked >= workLimit) {
      progress.truncated = true;
      break;
    }
    progress.scanned++;
    const outcome = await maybeExtractThreadConcepts(row.id, row.title, { force: true });
    if (!outcome) {
      progress.skipped++;
      continue;
    }
    if (outcome.status === 'extracted') {
      progress.extracted++;
      progress.entities += outcome.entityCount;
      worked++;
    } else if (outcome.status === 'unchanged') progress.unchanged++;
    else if (outcome.status === 'failed') {
      progress.failed++;
      worked++;
    } else progress.skipped++;
  }

  console.log(
    `[intel:chat] backfill done — scanned ${progress.scanned}, extracted ${progress.extracted} (${progress.entities} entities), unchanged ${progress.unchanged}, skipped ${progress.skipped}, failed ${progress.failed}`,
  );
  return progress;
}
