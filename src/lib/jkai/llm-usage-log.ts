// src/lib/jkai/llm-usage-log.ts
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
  costUsd: number | null;
  /** Where the call came from: 'workflow' | 'jkai-chat' | 'gateway' | ... */
  source?: string;
  /** Optional correlation id (e.g. a workflow runId or conversation id). */
  sessionId?: string | null;
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
      costUsd: call.costUsd ?? null,
      sessionId: call.sessionId ?? null,
      input: call.source ? { source: call.source } : null,
      status: 'completed',
    })
    .catch((err: unknown) => {
      console.error(
        '[llm-usage-log] failed to record llm_call:',
        err instanceof Error ? err.message : err,
      );
    });
}
