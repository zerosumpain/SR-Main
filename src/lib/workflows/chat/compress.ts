import { ensureCollection, upsertRecord, getRecordByKey } from '$lib/datastore';
import { getLLMClient } from '$lib/llm/client';
import { resolveChatMaintenanceModel } from '$lib/server/models/workload-settings';
import { currentSessionModel } from '$lib/context/chat';
import { withActivity } from '$lib/context/activity';
import type { HistoryMessage } from './conversation-history';

/**
 * Keep a long thread coherent instead of silently forgetting it.
 *
 * The in-process lane used to do `conversationHistory.slice(-MAX_HISTORY)` with
 * MAX_HISTORY = 30. That is not a context-window guard — it is amnesia. Message
 * 31 onwards simply vanished, with nothing in the prompt saying so, which is why
 * a long thread would confidently contradict something agreed an hour earlier.
 *
 * The old gateway compressed instead. This does the same, in three properties that matter:
 *
 * 1. **Incremental.** A summary records how far it covers, so each turn folds in
 *    only what newly fell out of the window. Without that, every turn on a long
 *    thread re-summarises the whole thing — an LLM call per turn, for ever.
 * 2. **Cached across turns**, in the datastore, keyed by conversation.
 * 3. **Honest on failure.** If summarising fails we keep MORE raw messages than
 *    before rather than fewer, and say plainly that earlier context is missing.
 *    Silently dropping is the behaviour being fixed; it must not be the fallback.
 */

export const COMPRESSION_COLLECTION = 'chat-compression';
const SYSTEM_ACTOR = 'system';

/** Raw messages kept verbatim at the end of the thread. */
export const KEEP_RECENT = 30;
/** Only compress once there is a worthwhile amount to compress. */
export const COMPRESS_THRESHOLD = 8;

export interface CompressionRecord {
  conversationId: string;
  summary: string;
  /** ISO timestamp of the last message this summary covers. */
  coversUpTo: string;
  messageCount: number;
  updatedAt: string;
}

/**
 * How far back the loader reaches.
 *
 * `KEEP_RECENT` is what stays VERBATIM; this is what is available to summarise.
 * They were effectively the same number, which is why compression never ran —
 * see the note on `compressHistory`.
 */
export const HISTORY_WINDOW = 200;

export interface CompressedHistory {
  /** Messages to send verbatim. */
  messages: HistoryMessage[];
  /** Prose describing everything older, or null when nothing was dropped. */
  summary: string | null;
  /** How many raw messages the summary stands in for. */
  compressedCount: number;
  /** True when older messages were dropped WITHOUT a usable summary. */
  degraded: boolean;
  /** True when the cached summary is missing or behind, so the caller should
   *  call `refreshCompression` once the reply has been sent. Kept off the
   *  critical path deliberately: summarising is an LLM call. */
  needsRefresh: boolean;
}

async function ensureCollectionExists(): Promise<void> {
  await ensureCollection(
    COMPRESSION_COLLECTION,
    {
      name: 'Chat compression',
      description: 'Rolling summaries of older chat turns, so long threads keep their history',
      isSystem: true,
    },
    SYSTEM_ACTOR,
  );
}

export async function loadCompression(conversationId: string): Promise<CompressionRecord | null> {
  try {
    await ensureCollectionExists();
    const row = await getRecordByKey(COMPRESSION_COLLECTION, conversationId, SYSTEM_ACTOR);
    const rec = row?.data as unknown as CompressionRecord | undefined;
    return rec && typeof rec.summary === 'string' ? rec : null;
  } catch {
    // A cache miss must never cost the user their turn.
    return null;
  }
}

async function saveCompression(rec: CompressionRecord): Promise<void> {
  try {
    await ensureCollectionExists();
    await upsertRecord(
      COMPRESSION_COLLECTION,
      { key: rec.conversationId, data: rec as unknown as Record<string, unknown> },
      SYSTEM_ACTOR,
    );
  } catch (err) {
    console.warn('[compress] could not persist summary:', err instanceof Error ? err.message : err);
  }
}

function renderForSummary(messages: HistoryMessage[]): string {
  return messages
    .map((m) => {
      const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role;
      const body = (m.content ?? '').slice(0, 4000);
      const atts = m.attachments?.length ? ` [${m.attachments.length} attachment(s)]` : '';
      return `${who}${atts}: ${body}`;
    })
    .join('\n\n');
}

const PROMPT = `You are compressing the earlier part of a conversation so it can be carried forward in a limited context.

Write a factual digest of what follows. It replaces the raw messages entirely, so anything omitted is lost.

Keep a structured digest with these labelled sections: Objective; Constraints; Decisions; Authorization (quote user source, never infer approval); Resource IDs; Evidence (source IDs, times, scope); Pending work.

Keep:
- decisions made and the reasoning behind them
- facts established, names, numbers, file paths, identifiers
- open threads, unresolved questions, things promised
- corrections — especially where something earlier was found to be wrong

Drop: pleasantries, restated context, tool call mechanics.

Write plain prose in past tense. No preamble, no headings, no markdown. Be specific over brief: this is the only record of these messages that will survive.`;

async function summarise(text: string, previous: string | null): Promise<string | null> {
  try {
    // The session's pin first. Compaction rewrites the thread's own history —
    // running it on a different model than the thread is the one place a
    // mismatch actively rewrites what the pinned model gets to read next turn.
    // Unpinned, the `chat-maintenance` role answers rather than the bare site
    // default, so this background work can be moved somewhere cheap on its own.
    const ctx = currentSessionModel() ?? (await resolveChatMaintenanceModel());
    const { client, model } = await getLLMClient(ctx);
    const user = previous
      ? `Digest so far (fold the new messages into it, keeping what still matters):\n\n${previous}\n\n---\n\nNew messages that just fell out of the window:\n\n${text}`
      : text;
    const res = await withActivity('chat-maintenance', () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: user },
        ],
        max_tokens: 1500,
      }),
    );
    const out = res.choices?.[0]?.message?.content?.trim() ?? '';
    return out.length > 40 ? out : null;
  } catch (err) {
    console.warn('[compress] summarise failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Split a thread into "recent, verbatim" and "everything older, summarised".
 *
 * `conversationId` is optional: a canvas chat without one simply cannot cache,
 * so it falls back to today's truncation rather than paying an LLM call per turn
 * for a summary it would immediately throw away.
 */
/**
 * Split a conversation into "recent, verbatim" and "earlier, summarised".
 *
 * ## Why this never ran
 *
 * `loadConversationHistory` fetched every message and then did
 * `.slice(-MAX_HISTORY)`, so it returned at most 30 — and the caller passed
 * `keepRecent = 30`. The guard on the first line therefore matched on every
 * turn and returned immediately. No `chat-compression` record has ever been
 * written. Meanwhile message 31 and everything behind it was simply dropped by
 * that slice: no summary, no note, and nothing in the reply to say the model
 * was answering with a third of the thread missing. Seven live threads are past
 * that line (73, 60, 50, 48, 39, 39, 39 messages).
 *
 * The loader now reaches `HISTORY_WINDOW` back, so there is something to
 * compress.
 *
 * ## Why it never summarises inline
 *
 * `summarise()` is an LLM call and this is awaited before the system prompt is
 * assembled — so doing it here would put a whole model round in front of the
 * first token, on exactly the long threads that are already slowest. That is
 * the cost the previous change spent its time removing.
 *
 * So: read the cache, never write it. When the cache is missing or stale the
 * result says `needsRefresh`, and the caller refreshes AFTER the reply has gone
 * out (`refreshCompression`). The turn that discovers the summary is stale
 * still answers with honest degradation; the turn after it has the summary.
 */
export async function compressHistory(
  history: HistoryMessage[],
  conversationId?: string | null,
  keepRecent = KEEP_RECENT,
): Promise<CompressedHistory> {
  if (history.length <= keepRecent) {
    return { messages: history, summary: null, compressedCount: 0, degraded: false, needsRefresh: false };
  }

  const older = history.slice(0, history.length - keepRecent);
  const recent = history.slice(-keepRecent);

  if (!conversationId) {
    // No cache key, so nothing can be summarised or stored. Say the context is
    // missing rather than pretending it never existed.
    return { messages: recent, summary: null, compressedCount: older.length, degraded: true, needsRefresh: false };
  }

  const cached = await loadCompression(conversationId);
  const coversUpTo = cached ? new Date(cached.coversUpTo).getTime() : 0;
  const fresh = older.filter((m) => m.createdAt.getTime() > coversUpTo);
  const stale = fresh.length >= COMPRESS_THRESHOLD;

  if (cached) {
    return {
      messages: [...fresh, ...recent],
      summary: cached.summary,
      // Count what the summary actually covers, plus anything it does not yet.
      compressedCount: cached.messageCount,
      // A summary that is behind is still better than none, but the turn should
      // not imply it covers messages it has never seen.
      degraded: false,
      needsRefresh: stale,
    };
  }

  // Nothing cached yet. Keep MORE than we otherwise would and be explicit that
  // the earlier part is missing — the summary will exist for the next turn.
  return {
    messages: history,
    summary: null,
    compressedCount: 0,
    degraded: false,
    needsRefresh: true,
  };
}

/**
 * Bring a conversation's summary up to date. Call AFTER the reply has been
 * sent — it makes an LLM call and must never sit in front of the first token.
 *
 * Safe to call when nothing needs doing; safe to call concurrently (the last
 * write wins, and both writers are summarising the same prefix). Never throws:
 * a summary that fails to refresh degrades the next turn's context, which the
 * prompt says out loud, and that is not worth failing a turn over.
 */
async function refreshCompressionUnlocked(
  history: HistoryMessage[],
  conversationId: string,
  keepRecent = KEEP_RECENT,
): Promise<{ refreshed: boolean; reason?: string }> {
  try {
    if (history.length <= keepRecent) return { refreshed: false, reason: 'nothing older than the window' };
    const older = history.slice(0, history.length - keepRecent);

    const cached = await loadCompression(conversationId);
    const coversUpTo = cached ? new Date(cached.coversUpTo).getTime() : 0;
    const fresh = older.filter((m) => m.createdAt.getTime() > coversUpTo);
    if (cached && fresh.length < COMPRESS_THRESHOLD) {
      return { refreshed: false, reason: 'summary already covers the older messages' };
    }
    // With no cache, summarise everything that has fallen out — not just the
    // tail — or the first summary would silently start partway through.
    const toSummarise = cached ? fresh : older;
    if (toSummarise.length === 0) return { refreshed: false, reason: 'nothing to summarise' };

    const summary = await summarise(renderForSummary(toSummarise), cached?.summary ?? null);
    if (!summary) return { refreshed: false, reason: 'summariser returned nothing' };

    await saveCompression({
      conversationId,
      summary,
      coversUpTo: toSummarise[toSummarise.length - 1].createdAt.toISOString(),
      messageCount: (cached?.messageCount ?? 0) + toSummarise.length,
      updatedAt: new Date().toISOString(),
    });
    return { refreshed: true };
  } catch (err) {
    console.error(
      '[compress] refresh failed:',
      err instanceof Error ? err.message : err,
    );
    return { refreshed: false, reason: 'threw' };
  }
}

/** The prompt section carrying the compressed history. */
export function renderCompressionSection(c: CompressedHistory): string {
  if (c.summary) {
    return `\n\n--- Earlier in this conversation (${c.compressedCount} messages, summarised) ---\n${c.summary}\n--- end ---\n`;
  }
  if (c.degraded && c.compressedCount > 0) {
    return `\n\n--- Earlier in this conversation ---\n${c.compressedCount} earlier messages are not available in this turn and could not be summarised. If the user refers to something you cannot see, say so rather than guessing at it.\n--- end ---\n`;
  }
  return '';
}

const refreshes = new Map<string, Promise<unknown>>();
/** Serialize refreshes per thread; newer snapshots always follow earlier writes. */
export async function refreshCompression(history: HistoryMessage[], conversationId: string, keepRecent = KEEP_RECENT) {
  const previous = refreshes.get(conversationId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => refreshCompressionUnlocked(history, conversationId, keepRecent));
  refreshes.set(conversationId, next);
  try { return await next; }
  finally { if (refreshes.get(conversationId) === next) refreshes.delete(conversationId); }
}
