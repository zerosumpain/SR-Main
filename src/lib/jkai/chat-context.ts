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

export interface ChatCallContext {
  /** The chat job id. Equals `jkai_tool_traces.id` for turns that made a tool call. */
  jobId?: string;
  /** The thread. Carried separately because tool-free turns write no trace row. */
  conversationId?: string;
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
