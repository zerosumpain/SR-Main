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
 */
const COMMAND_ECHO_RE = /^\s*(?:Model switched to|Usage:|Unknown command\b|Available (?:commands|models)\b)/i;

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
    if (!shouldExtractAtTurn(assistantTurns)) return;

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
