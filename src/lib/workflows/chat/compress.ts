import { ensureCollection, upsertRecord, getRecordByKey } from '$lib/datastore';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { HistoryMessage } from './conversation-history';

/**
 * Keep a long thread coherent instead of silently forgetting it.
 *
 * The in-process lane used to do `conversationHistory.slice(-MAX_HISTORY)` with
 * MAX_HISTORY = 30. That is not a context-window guard — it is amnesia. Message
 * 31 onwards simply vanished, with nothing in the prompt saying so, which is why
 * a long thread would confidently contradict something agreed an hour earlier.
 *
 * Hermes compressed instead. This does the same, in three properties that matter:
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

export interface CompressedHistory {
  /** Messages to send verbatim. */
  messages: HistoryMessage[];
  /** Prose describing everything older, or null when nothing was dropped. */
  summary: string | null;
  /** How many raw messages the summary stands in for. */
  compressedCount: number;
  /** True when older messages were dropped WITHOUT a usable summary. */
  degraded: boolean;
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

Keep:
- decisions made and the reasoning behind them
- facts established, names, numbers, file paths, identifiers
- open threads, unresolved questions, things promised
- corrections — especially where something earlier was found to be wrong

Drop: pleasantries, restated context, tool call mechanics.

Write plain prose in past tense. No preamble, no headings, no markdown. Be specific over brief: this is the only record of these messages that will survive.`;

async function summarise(text: string, previous: string | null): Promise<string | null> {
  try {
    const ctx = await resolveDefaultModel();
    const { client, model } = await getLLMClient(ctx);
    const user = previous
      ? `Digest so far (fold the new messages into it, keeping what still matters):\n\n${previous}\n\n---\n\nNew messages that just fell out of the window:\n\n${text}`
      : text;
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: user },
      ],
      max_tokens: 1500,
    });
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
export async function compressHistory(
  history: HistoryMessage[],
  conversationId?: string | null,
  keepRecent = KEEP_RECENT,
): Promise<CompressedHistory> {
  if (history.length <= keepRecent) {
    return { messages: history, summary: null, compressedCount: 0, degraded: false };
  }

  const older = history.slice(0, history.length - keepRecent);
  const recent = history.slice(-keepRecent);

  if (!conversationId) {
    // No cache key: keep today's behaviour rather than re-summarising every turn,
    // but say that context is missing instead of pretending it never existed.
    return { messages: recent, summary: null, compressedCount: older.length, degraded: true };
  }

  const cached = await loadCompression(conversationId);
  const coversUpTo = cached ? new Date(cached.coversUpTo).getTime() : 0;
  const fresh = older.filter((m) => m.createdAt.getTime() > coversUpTo);

  // Nothing new has fallen out since the last summary — reuse it as-is.
  if (cached && fresh.length < COMPRESS_THRESHOLD) {
    return {
      messages: recent,
      summary: cached.summary,
      compressedCount: cached.messageCount,
      degraded: false,
    };
  }

  const summary = await summarise(renderForSummary(fresh), cached?.summary ?? null);
  if (!summary) {
    // Honest degradation: keep MORE than we would have, and flag it.
    return {
      messages: history.slice(-(keepRecent * 2)),
      summary: cached?.summary ?? null,
      compressedCount: older.length,
      degraded: !cached,
    };
  }

  const rec: CompressionRecord = {
    conversationId,
    summary,
    coversUpTo: older[older.length - 1].createdAt.toISOString(),
    messageCount: (cached?.messageCount ?? 0) + fresh.length,
    updatedAt: new Date().toISOString(),
  };
  await saveCompression(rec);

  return { messages: recent, summary, compressedCount: rec.messageCount, degraded: false };
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
