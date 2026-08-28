/** The per-turn ledger stamped onto every assistant message.
 *
 *  Written into `orchestrator_chats.metadata.usage` by the chat endpoint and
 *  also handed to the client on the `done` event, so the cost line under a
 *  reply is identical whether the turn just streamed or was reloaded from
 *  history. Cost is priced against the conversation's own model (the engine's own
 *  estimate is only a fallback), in USD — display converts to GBP.
 */
export interface TurnStamp {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  costUsd: number;
  latencyMs: number;
  /**
   * How many times the model was called to produce this reply.
   *
   * Absent on older rows, which had no notion of it — the gateway reported one
   * usage block per turn and the round structure stayed inside the gateway. On
   * the in-process loop it is the single most useful number on the line: the
   * first measured turn on production took NINE rounds at ~3.3s of
   * time-to-first-token each, and that, not tool speed, is what a reply costs.
   */
  rounds?: number;
}

/** Narrow an unknown metadata blob to a TurnStamp. Old messages predate the
 *  stamp and legacy rows can carry anything, so every read goes through here. */
export function readTurnStamp(meta: unknown): TurnStamp | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as Record<string, unknown>)['usage'];
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const inputTokens = typeof u['inputTokens'] === 'number' ? u['inputTokens'] : null;
  const outputTokens = typeof u['outputTokens'] === 'number' ? u['outputTokens'] : null;
  if (inputTokens === null && outputTokens === null) return null;
  return {
    model: typeof u['model'] === 'string' ? u['model'] : '',
    provider: typeof u['provider'] === 'string' ? u['provider'] : 'openrouter',
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadTokens: typeof u['cacheReadTokens'] === 'number' ? u['cacheReadTokens'] : null,
    costUsd: typeof u['costUsd'] === 'number' ? u['costUsd'] : 0,
    latencyMs: typeof u['latencyMs'] === 'number' ? u['latencyMs'] : 0,
    // Optional: undefined on every row written before the loop counted rounds,
    // which must stay distinguishable from a genuine zero.
    ...(typeof u['rounds'] === 'number' ? { rounds: u['rounds'] } : {}),
  };
}
