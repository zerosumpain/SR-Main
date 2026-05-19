import { AsyncLocalStorage } from 'node:async_hooks';

export interface LLMCallRecord {
  provider: string;
  model: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  priceSnapshot: Record<string, number> | null;
}

export interface NodeExecutionContext {
  workflowId: string;
  runId: string;
  nodeId: string;
  llmCalls: LLMCallRecord[];
}

export const executionContext = new AsyncLocalStorage<NodeExecutionContext>();

/** Append a captured LLM call to the current execution context. No-op when
 *  called outside an engine-managed node (e.g. /jkai chat hub uses the same
 *  gateway but isn't a workflow node). */
export function recordLLMCall(call: LLMCallRecord): void {
  const ctx = executionContext.getStore();
  if (!ctx) return;
  ctx.llmCalls.push(call);
}

export interface UsageRollup {
  tokensInput: number | null;
  tokensOutput: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
  costUsd: string | null;
  provider: string | null;
  model: string | null;
  priceSnapshot: Record<string, unknown> | null;
}

/** Sum the LLM calls collected during a node execution into a single row's
 *  worth of columns. Returns null when no calls were captured, so the
 *  caller can skip writing these columns entirely for non-LLM nodes. */
export function rollupUsage(calls: LLMCallRecord[]): UsageRollup | null {
  if (calls.length === 0) return null;

  let tokensInput: number | null = null;
  let tokensOutput: number | null = null;
  let cacheReadTokens: number | null = null;
  let reasoningTokens: number | null = null;
  let costUsd: number | null = null;

  const accum = (running: number | null, next: number | null): number | null => {
    if (next === null) return running;
    return (running ?? 0) + next;
  };

  for (const c of calls) {
    tokensInput = accum(tokensInput, c.tokensInput);
    tokensOutput = accum(tokensOutput, c.tokensOutput);
    cacheReadTokens = accum(cacheReadTokens, c.cacheReadTokens);
    reasoningTokens = accum(reasoningTokens, c.reasoningTokens);
    costUsd = accum(costUsd, c.costUsd);
  }

  // If the node made multiple LLM calls against different providers/models,
  // attribute the row to the most recent one — that's the call whose output
  // most directly drove the node's result, and is the most useful label in
  // a per-node chart. The full breakdown is implicit in tokens / cost sums.
  const last = calls[calls.length - 1];

  // numeric(12,6) wants a string to preserve precision through the driver.
  const costUsdStr = costUsd === null ? null : costUsd.toFixed(6);

  return {
    tokensInput,
    tokensOutput,
    cacheReadTokens,
    reasoningTokens,
    costUsd: costUsdStr,
    provider: last.provider,
    model: last.model,
    priceSnapshot: last.priceSnapshot,
  };
}
