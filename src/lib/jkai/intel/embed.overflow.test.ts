// Embedding inputs that are too long for the model.
//
// `text-embedding-3-small` caps at 8,192 TOKENS, and no constant converts that
// into characters: English prose is ~4 chars/token, an email full of headers,
// URLs and quoted signatures nearer 2. This module cut at 32,000 chars on the
// prose assumption, and on 2026-08-27 nine notes — the longest 23,999 chars —
// failed the backfill with `maximum context length is 8192 tokens`. They would
// have failed every night afterwards.
import { describe, it, expect } from 'vitest';

/** `isContextOverflow`, as implemented in ./embed. */
function isContextOverflow(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /maximum context length|context_length_exceeded|too many tokens|reduce the length/i.test(msg);
}

/** The shrink loop, extracted so it can be driven without a network call. */
async function shrinkToFit(
  inputs: string[],
  call: (inputs: string[]) => Promise<string[]>,
  maxChars = 16_000,
  attempts = 3,
): Promise<string[]> {
  let cut = maxChars;
  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await call(inputs.map((t) => t.slice(0, cut)));
    } catch (err) {
      if (!isContextOverflow(err)) throw err;
      lastError = err;
      cut = Math.floor(cut / 2);
    }
  }
  throw lastError;
}

const overflow = () => Object.assign(new Error('maximum context length is 8192 tokens'), { status: 400 });

describe('isContextOverflow', () => {
  it('recognises the message the API actually returns', () => {
    expect(isContextOverflow(new Error("Invalid 'input': maximum context length is 8192 tokens."))).toBe(true);
    expect(isContextOverflow(new Error('context_length_exceeded'))).toBe(true);
  });

  it('does not mistake other failures for it', () => {
    expect(isContextOverflow(new Error('402 Insufficient credits'))).toBe(false);
    expect(isContextOverflow(new Error('socket hang up'))).toBe(false);
  });
});

describe('shrinkToFit', () => {
  it('sends the conservative cut first, not the full text', async () => {
    let seen = 0;
    await shrinkToFit(['x'.repeat(50_000)], async (inputs) => {
      seen = inputs[0].length;
      return ['ok'];
    });
    expect(seen).toBe(16_000);
  });

  it('halves until the model accepts it', async () => {
    const lengths: number[] = [];
    const out = await shrinkToFit(['x'.repeat(50_000)], async (inputs) => {
      lengths.push(inputs[0].length);
      if (inputs[0].length > 4_000) throw overflow();
      return ['ok'];
    });
    expect(lengths).toEqual([16_000, 8_000, 4_000]);
    expect(out).toEqual(['ok']);
  });

  it('gives up rather than looping for ever', async () => {
    let calls = 0;
    await expect(
      shrinkToFit(['x'.repeat(50_000)], async () => {
        calls += 1;
        throw overflow();
      }),
    ).rejects.toThrow('maximum context length');
    expect(calls).toBe(4);
  });

  it('does not retry a failure that is not about length', async () => {
    // A credit refusal will not improve by sending less text, and retrying it
    // four times just makes four identical failures.
    let calls = 0;
    await expect(
      shrinkToFit(['short'], async () => {
        calls += 1;
        throw new Error('402 Insufficient credits');
      }),
    ).rejects.toThrow('402');
    expect(calls).toBe(1);
  });

  it('leaves a short input alone', async () => {
    let seen = 0;
    await shrinkToFit(['hello'], async (inputs) => {
      seen = inputs[0].length;
      return ['ok'];
    });
    expect(seen).toBe(5);
  });
});
