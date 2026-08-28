import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What the ledger row actually contains.
 *
 * `duration_ms` had existed on `agent_actions` since the table did and had never
 * once been written — null on 4,058 of 4,058 rows over three days of production
 * (measured 2026-08-25). So every claim about reply latency came from scraping
 * journald rather than from the table that already held the tokens and the cost.
 */

const inserted: Record<string, unknown>[] = [];
vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ agentActions: {} }));

import { recordDurableLLMCall } from '$lib/llm/usage-log';

const base = {
  provider: 'codex',
  model: 'codex/gpt-5.6-terra',
  tokensInput: 100,
  tokensOutput: 20,
  costUsd: null,
};

beforeEach(() => {
  inserted.length = 0;
});

describe('recordDurableLLMCall', () => {
  it('writes duration into the real column, not the jsonb', async () => {
    recordDurableLLMCall({ ...base, durationMs: 4321 });
    await Promise.resolve();
    expect(inserted[0].durationMs).toBe(4321);
  });

  it('records TTFT in input, where the other facets live', async () => {
    recordDurableLLMCall({ ...base, durationMs: 4321, ttftMs: 900 });
    await Promise.resolve();
    expect(inserted[0].input).toMatchObject({ ttftMs: 900 });
  });

  it('keeps TTFT null on a non-streamed call rather than equating it to duration', async () => {
    // They move for different reasons — TTFT is prompt size and cache state,
    // duration is how much the model then wrote. A fabricated equality would
    // read as a measurement.
    recordDurableLLMCall({ ...base, durationMs: 4321 });
    await Promise.resolve();
    expect((inserted[0].input as Record<string, unknown> | null)?.ttftMs).toBeUndefined();
  });

  it('accepts a zero duration without turning it into null', async () => {
    recordDurableLLMCall({ ...base, durationMs: 0 });
    await Promise.resolve();
    expect(inserted[0].durationMs).toBe(0);
  });

  it('still writes null duration when the caller could not measure', async () => {
    recordDurableLLMCall(base);
    await Promise.resolve();
    expect(inserted[0].durationMs).toBeNull();
  });

  it('carries the conversation id so a tool-free turn is still attributable', async () => {
    // jkai_tool_traces only has a row when the turn called a tool, so a
    // tool-free turn's jobId joins to nothing without this.
    recordDurableLLMCall({ ...base, sessionId: 'job-9', conversationId: 'conv-9' });
    await Promise.resolve();
    expect(inserted[0].sessionId).toBe('job-9');
    expect(inserted[0].input).toMatchObject({ conversationId: 'conv-9' });
  });

  it('leaves input null when there is nothing to say', async () => {
    recordDurableLLMCall(base);
    await Promise.resolve();
    expect(inserted[0].input).toBeNull();
  });

  it('keeps a codex cost null rather than zero', async () => {
    // A Codex call has no cash cost but is not free-and-measured. Zero would be
    // summed as a real number; null is honestly absent. Two conventions for one
    // engine is what made SUM silently drop the chat engine.
    recordDurableLLMCall({ ...base, costUsd: null });
    await Promise.resolve();
    expect(inserted[0].costUsd).toBeNull();
  });
});
