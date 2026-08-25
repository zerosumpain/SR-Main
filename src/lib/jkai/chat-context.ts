/**
 * Which CHAT TURN is spending the money.
 *
 * `agent_actions` records provider, model, tokens, cache reads and cost for
 * every LLM call. What it could not record, for a chat turn, is which turn:
 * `usage-capture` sets `sessionId` from `executionContext.runId ?? researchId`,
 * and a chat turn is neither a workflow run nor a research session. Measured
 * 2026-08-25 over three days of production: `session_id` is null on 3,671 of
 * 3,675 openrouter rows and 355 of 370 codex rows.
 *
 * The consequence is not a missing nicety. It is that **no claim about chat
 * latency or cost is checkable.** Rounds-per-turn cannot be counted, because no
 * row knows which turn it belongs to; two review lanes produced 2.83 and 1.13
 * for the same question and both were artefacts of the join they happened to
 * pick. Cost-per-turn, cache-hit-rate-per-turn and time-to-first-token are all
 * the same story.
 *
 * ## Why jobId is the session id
 *
 * `jkai_tool_traces.id` **is** the chat jobId (see its schema comment). So
 * writing the jobId into `session_id` makes the ledger joinable to the trace
 * table on one key, and the tool side of a turn — step count, error count, tool
 * wall-clock — arrives for free. Rounds per turn becomes:
 *
 *     SELECT session_id, count(*) FROM agent_actions
 *     WHERE action_type = 'llm_call' GROUP BY 1;
 *
 * `conversationId` rides along in the ledger's `input` jsonb rather than in
 * `session_id`, because a turn that calls no tool writes **no trace row at all**
 * — its jobId joins to nothing, and without the conversation id those turns
 * would be unattributable again, which is the bug this file exists to fix.
 *
 * ## Why AsyncLocalStorage
 *
 * Same reason as `$lib/jkai/activity-context`, and it is worth restating: the
 * LLM call sits several frames below the code that knows which turn it is
 * serving, and those frames are shared with callers that have no turn at all
 * (embeddings, extraction, the nightly pass). Threading a turn id through every
 * signature would touch a lot of code that has no business knowing about chat.
 *
 * Deliberately NOT `enterWith()`: that would set the store for the rest of the
 * current async context, so a turn's id would leak onto every later LLM call in
 * the same request — an OCR pass billed to the chat turn that preceded it. A
 * confident wrong number is worse in a ledger than an honest blank.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Running totals for one turn, accumulated across every round it makes.
 *
 * A turn is not one LLM call. The first measured turn on production made
 * **nine** — the loop calls the model, runs a tool, calls it again, and so on
 * until it has an answer. So the ledger line under a reply has to sum the
 * rounds, not report the last one, or it understates the turn by most of it.
 *
 * Accumulated in process rather than read back from `agent_actions`, even
 * though PR 3 now writes a row per round keyed on the same job id: those
 * inserts are deliberately fire-and-forget, so a read immediately after the
 * turn would race them and silently under-count.
 */
export interface ChatUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  /** How many times the model was called. The lever, and now visible. */
  rounds: number;
  /** Provider and model of the last round — what actually answered. */
  provider: string | null;
  model: string | null;
  /**
   * Cost the provider itself reported, summed. Null when no round reported one.
   * Preferred over our own arithmetic where present: a per-token table cannot
   * see anything billed per request, such as a web-search fee.
   */
  reportedCostUsd: number | null;
}

export function emptyChatUsage(): ChatUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    rounds: 0,
    provider: null,
    model: null,
    reportedCostUsd: null,
  };
}

export interface ChatCallContext {
  /** The chat job id. Equals `jkai_tool_traces.id` for turns that made a tool call. */
  jobId?: string;
  /** The thread. Carried separately because tool-free turns write no trace row. */
  conversationId?: string;
  /** Mutable running total, when the caller wants one back. */
  usage?: ChatUsageTotals;
}

const chatCtx = new AsyncLocalStorage<ChatCallContext>();

/**
 * Run `fn` with `ctx` as the ambient chat turn, so every LLM call it makes
 * lands in the ledger attributed to that turn.
 *
 * Wrap the turn, not the model resolution — the tag only means anything while
 * the turn is in flight.
 */
export function withChatContext<T>(ctx: ChatCallContext, fn: () => Promise<T>): Promise<T> {
  return chatCtx.run(ctx, fn);
}

/** The chat turn this code is executing inside, or null when there is none. */
export function currentChatContext(): ChatCallContext | null {
  return chatCtx.getStore() ?? null;
}

/**
 * Fold one completed round into the turn's running total.
 *
 * No-op outside a turn, and no-op when the caller did not ask for totals — the
 * WhatsApp bridge and the follow-up queue want attribution without a stamp.
 */
export function noteChatRound(round: {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
  reportedCostUsd: number | null;
}): void {
  const totals = chatCtx.getStore()?.usage;
  if (!totals) return;
  totals.rounds += 1;
  totals.inputTokens += Math.max(0, round.inputTokens ?? 0);
  totals.outputTokens += Math.max(0, round.outputTokens ?? 0);
  totals.cacheReadTokens += Math.max(0, round.cacheReadTokens ?? 0);
  totals.reasoningTokens += Math.max(0, round.reasoningTokens ?? 0);
  // Last writer wins: the final round is the one that produced the visible
  // answer, and that is the model the stamp should name.
  totals.provider = round.provider;
  totals.model = round.model;
  if (typeof round.reportedCostUsd === 'number') {
    totals.reportedCostUsd = (totals.reportedCostUsd ?? 0) + round.reportedCostUsd;
  }
}

/**
 * The id to record as `session_id` for a chat call, or null outside one.
 *
 * Prefers the job (one turn) over the conversation (one thread): the metric the
 * whole exercise turns on is rounds per turn, and a thread-level id would
 * average that away.
 */
export function currentChatSessionId(): string | null {
  const store = chatCtx.getStore();
  return store?.jobId ?? store?.conversationId ?? null;
}
