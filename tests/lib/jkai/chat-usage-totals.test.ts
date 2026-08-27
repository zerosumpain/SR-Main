import { describe, it, expect } from 'vitest';
import {
  withChatContext,
  emptyChatUsage,
  noteChatRound,
  type ChatUsageTotals,
} from '$lib/jkai/chat-context';
import { readTurnStamp } from '$lib/jkai/turn-stamp';

function round(over: Partial<Parameters<typeof noteChatRound>[0]> = {}) {
  return {
    provider: 'codex',
    model: 'codex/gpt-5.6-terra',
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 200,
    reasoningTokens: 0,
    reportedCostUsd: null,
    ...over,
  };
}

describe('per-turn usage totals', () => {
  it('sums every round — a turn is not one call', async () => {
    // The first measured turn on production made NINE rounds. Reporting the
    // last one would have understated the turn by eight ninths.
    const usage = emptyChatUsage();
    await withChatContext({ jobId: 'j', usage }, async () => {
      for (let i = 0; i < 9; i++) noteChatRound(round());
    });
    expect(usage.rounds).toBe(9);
    expect(usage.inputTokens).toBe(9000);
    expect(usage.outputTokens).toBe(900);
    expect(usage.cacheReadTokens).toBe(1800);
  });

  it('names the model that answered — the last round, not the first', async () => {
    // A turn can escalate mid-flight. The line should name what produced the
    // words the reader is looking at.
    const usage = emptyChatUsage();
    await withChatContext({ jobId: 'j', usage }, async () => {
      noteChatRound(round({ model: 'first/model' }));
      noteChatRound(round({ model: 'last/model', provider: 'openrouter' }));
    });
    expect(usage.model).toBe('last/model');
    expect(usage.provider).toBe('openrouter');
  });

  it('leaves reported cost null when no round reported one', async () => {
    // Null means "the provider told us nothing", which is not zero. Codex
    // reports nothing at all.
    const usage = emptyChatUsage();
    await withChatContext({ jobId: 'j', usage }, async () => {
      noteChatRound(round());
    });
    expect(usage.reportedCostUsd).toBeNull();
  });

  it('sums reported cost across rounds when the provider does report', async () => {
    const usage = emptyChatUsage();
    await withChatContext({ jobId: 'j', usage }, async () => {
      noteChatRound(round({ provider: 'openrouter', reportedCostUsd: 0.01 }));
      noteChatRound(round({ provider: 'openrouter', reportedCostUsd: 0.02 }));
    });
    expect(usage.reportedCostUsd).toBeCloseTo(0.03, 6);
  });

  it('treats a null token count as zero rather than NaN', async () => {
    const usage = emptyChatUsage();
    await withChatContext({ jobId: 'j', usage }, async () => {
      noteChatRound(round({ inputTokens: null, outputTokens: null, cacheReadTokens: null }));
    });
    expect(usage.inputTokens).toBe(0);
    expect(usage.rounds).toBe(1);
  });

  it('is a no-op for callers that asked for no totals', async () => {
    // The WhatsApp bridge and the follow-up queue want attribution without a
    // stamp; they must not pay for accumulation they never read.
    await withChatContext({ jobId: 'j' }, async () => {
      expect(() => noteChatRound(round())).not.toThrow();
    });
  });

  it('does not accumulate outside a turn at all', () => {
    expect(() => noteChatRound(round())).not.toThrow();
  });

  it('keeps two concurrent turns apart', async () => {
    // One process serves many turns at once. A shared accumulator would bill
    // one reader's rounds to another's line.
    const a: ChatUsageTotals = emptyChatUsage();
    const b: ChatUsageTotals = emptyChatUsage();
    await Promise.all([
      withChatContext({ jobId: 'a', usage: a }, async () => {
        noteChatRound(round());
        await new Promise((r) => setTimeout(r, 5));
        noteChatRound(round());
      }),
      withChatContext({ jobId: 'b', usage: b }, async () => {
        noteChatRound(round());
      }),
    ]);
    expect(a.rounds).toBe(2);
    expect(b.rounds).toBe(1);
  });
});

describe('turn stamp round-trip', () => {
  it('reads rounds back off persisted metadata', () => {
    const stamp = readTurnStamp({
      usage: {
        model: 'codex/gpt-5.6-terra',
        provider: 'codex',
        inputTokens: 9000,
        outputTokens: 900,
        cacheReadTokens: 1800,
        costUsd: 0,
        latencyMs: 41405,
        rounds: 9,
      },
    });
    expect(stamp?.rounds).toBe(9);
    expect(stamp?.latencyMs).toBe(41405);
  });

  it('leaves rounds undefined on an older row rather than inventing zero', () => {
    // Those turns had rounds, we just never counted them. Zero would be a claim.
    const stamp = readTurnStamp({
      usage: { model: 'm', provider: 'openrouter', inputTokens: 10, outputTokens: 5 },
    });
    expect(stamp).not.toBeNull();
    expect(stamp?.rounds).toBeUndefined();
  });
});
