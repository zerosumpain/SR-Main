import { describe, it, expect } from 'vitest';
import { readTurnStamp } from '$lib/jkai/turn-stamp';

// Every assistant bubble reads its cost line through readTurnStamp, over
// metadata written by several generations of the chat endpoint. It has to be
// unbothered by all of them.
describe('readTurnStamp', () => {
  it('reads a full stamp', () => {
    expect(
      readTurnStamp({
        usage: {
          model: 'z-ai/glm-5.2',
          provider: 'openrouter',
          inputTokens: 1200,
          outputTokens: 340,
          cacheReadTokens: 800,
          costUsd: 0.0021,
          latencyMs: 4200,
        },
      }),
    ).toEqual({
      model: 'z-ai/glm-5.2',
      provider: 'openrouter',
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 800,
      costUsd: 0.0021,
      latencyMs: 4200,
    });
  });

  it('returns null for messages that predate the stamp', () => {
    expect(readTurnStamp(null)).toBeNull();
    expect(readTurnStamp(undefined)).toBeNull();
    expect(readTurnStamp({})).toBeNull();
    expect(readTurnStamp({ chatNodeId: 'abc' })).toBeNull();
    expect(readTurnStamp({ usage: {} })).toBeNull();
  });

  it('rejects a usage blob with no token counts rather than reporting a free turn', () => {
    // A stamp of "0 tokens, £0.00" would read as a genuine free turn on the
    // bubble; absent data must stay absent.
    expect(readTurnStamp({ usage: { model: 'x', costUsd: 0 } })).toBeNull();
  });

  it('fills defaults when only one token count is present', () => {
    const stamp = readTurnStamp({ usage: { outputTokens: 512 } });
    expect(stamp).not.toBeNull();
    expect(stamp?.inputTokens).toBe(0);
    expect(stamp?.outputTokens).toBe(512);
    expect(stamp?.costUsd).toBe(0);
    expect(stamp?.provider).toBe('openrouter');
  });

  it('ignores wrong-typed fields instead of propagating them', () => {
    const stamp = readTurnStamp({
      usage: { inputTokens: 10, model: 42, latencyMs: 'slow', cacheReadTokens: null },
    });
    expect(stamp?.model).toBe('');
    expect(stamp?.latencyMs).toBe(0);
    expect(stamp?.cacheReadTokens).toBeNull();
  });
});
