// src/lib/llm/usage-log.ts
//
// Durable LLM-cost ledger. /admin/ops/costs and /api/agent/costs read the
// `agent_actions` table (action_type='llm_call'), but historically the ONLY
// writer was the external-agent POST /api/agent/actions — so the site's own LLM
// spend (jkai chat, workflows, deep research, RAG, project pages) never showed
// up. This helper is the single place the site records its own calls into the
// same table, so the cost dashboards reflect real spend.
//
// Fire-and-forget: cost logging must NEVER break an LLM response, so the insert
// is best-effort and swallows its own errors.

import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';

export interface DurableLLMCall {
  provider: string;
  model: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  /** Input tokens the provider served from its prompt cache. */
  cacheReadTokens?: number | null;
  /** Output tokens spent reasoning before the visible answer. */
  reasoningTokens?: number | null;
  costUsd: number | null;
  /** Where the call came from: 'workflow' | 'jkai-chat' | 'gateway' | ... */
  source?: string;
  /**
   * Which LLM ROLE spent it — a workload id from `$lib/models/workloads`, or
   * null when the call was not made inside one (a chat turn, a canvas LLM node).
   *
   * Kept separate from `source`, which says which *mechanism* carried the call.
   * A vision OCR pass and an entity extraction both arrive as `source:'gateway'`
   * and are entirely different bills.
   */
  activity?: string | null;
  /** Optional correlation id (e.g. a workflow runId or chat jobId). */
  sessionId?: string | null;
  /**
   * Wall-clock for the whole call, request to last byte.
   *
   * The column has existed since the table did and nothing has ever written it
   * — measured 2026-08-25, null on 4,058 of 4,058 rows over three days. Which
   * meant every statement about reply latency came from log scraping rather
   * than the ledger that already holds the tokens and the cost.
   */
  durationMs?: number | null;
  /**
   * Time to the first content token on a streamed call, or null when the call
   * was not streamed.
   *
   * Separate from `durationMs` because they move independently and for
   * different reasons: TTFT is prompt size and cache state, total duration is
   * how much the model then wrote. Collapsing them hides which one regressed.
   */
  ttftMs?: number | null;
  /** The thread a chat call belongs to. Tool-free turns write no trace row, so
   *  without this their `session_id` joins to nothing. */
  conversationId?: string | null;
}

/**
 * Facets that live in `input` rather than in columns.
 *
 * Same reasoning as the original two: this table is shared with the
 * external-agent action log, which already writes arbitrary payloads here, and
 * a jsonb key needs no migration on a table that is hot on every LLM call.
 * `durationMs` is the exception — it gets the real column, because one already
 * existed and had simply never been written.
 */
function buildInput(call: DurableLLMCall): Record<string, unknown> | null {
  const input: Record<string, unknown> = {};
  if (call.source) input.source = call.source;
  if (call.activity) input.activity = call.activity;
  if (call.conversationId) input.conversationId = call.conversationId;
  if (typeof call.ttftMs === 'number') input.ttftMs = call.ttftMs;
  return Object.keys(input).length > 0 ? input : null;
}

export function recordDurableLLMCall(call: DurableLLMCall): void {
  void db
    .insert(agentActions)
    .values({
      actionType: 'llm_call',
      provider: call.provider,
      model: call.model,
      tokensInput: call.tokensInput ?? null,
      tokensOutput: call.tokensOutput ?? null,
      cacheReadTokens: call.cacheReadTokens ?? null,
      reasoningTokens: call.reasoningTokens ?? null,
      costUsd: call.costUsd ?? null,
      sessionId: call.sessionId ?? null,
      durationMs: call.durationMs ?? null,
      // Both facets live in `input` rather than in new columns: this table is
      // shared with the external-agent action log, which writes arbitrary
      // payloads here already, and a jsonb key needs no migration on a table
      // that is hot on every LLM call.
      input: buildInput(call),
      status: 'completed',
    })
    .catch((err: unknown) => {
      console.error(
        '[llm-usage-log] failed to record llm_call:',
        err instanceof Error ? err.message : err,
      );
    });
}
