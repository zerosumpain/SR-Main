import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { APIUserAbortError } from 'openai';
import { isRateLimitError, chatCompletion, jsonCompletion, streamCompletion } from './ai';

// ---------------------------------------------------------------------------
// Mock the keys module so tests never touch the filesystem or env vars
// ---------------------------------------------------------------------------

const mockZaiCreate = vi.fn();
const mockOrCreate = vi.fn();

vi.mock('./keys', () => ({
  getOpenAIClient: () => ({ chat: { completions: { create: mockZaiCreate } } }),
  getOpenRouterClient: () => ({ chat: { completions: { create: mockOrCreate } } }),
  getModel: () => 'glm-5.1',
  getFallbackModel: () => 'anthropic/claude-3-5-haiku',
  hasOpenRouter: vi.fn(() => true),
  getEmbeddingModel: () => 'openai/text-embedding-3-small',
}));

// Pull the mocked hasOpenRouter so individual tests can override it
import * as keysModule from './keys';
const mockHasOpenRouter = keysModule.hasOpenRouter as unknown as MockInstance;

// Use fake timers globally so withRetry's setTimeout delays don't stall tests
vi.useFakeTimers();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeZaiSuccess(content: string) {
  return { choices: [{ message: { content } }] };
}

function makeOrSuccess(content: string) {
  return { choices: [{ message: { content } }] };
}

function rate429() {
  return Object.assign(new Error('Rate limit exceeded'), { status: 429 });
}

/**
 * The exact error the OpenAI SDK throws when our AbortSignal.timeout watchdog
 * fires. NOTE: its `.name` is the inherited "Error" (the SDK never overrides it)
 * — this is precisely why isAbortError must match by instanceof, not by name.
 */
function abortErr() {
  return new APIUserAbortError();
}

/**
 * Build a minimal async-iterable stream mock so we can exercise the
 * for-await loop inside runStream without hitting any network.
 * The OpenAI SDK's stream is iterated directly as an async-iterable,
 * so we need to return something that IS async-iterable.
 */
function makeStream(chunks: Array<{ delta?: string; usage?: number }>) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) {
        yield {
          choices: [{ delta: { content: c.delta ?? '' } }],
          usage: c.usage ? { total_tokens: c.usage } : undefined,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// isRateLimitError — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('isRateLimitError', () => {
  it('returns true for status 429', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  it('returns true for z.ai code 1302 as string', () => {
    expect(isRateLimitError({ code: '1302' })).toBe(true);
  });

  it('returns true for z.ai code 1302 as number', () => {
    expect(isRateLimitError({ code: 1302 })).toBe(true);
  });

  it('returns true when message contains "rate limit"', () => {
    expect(isRateLimitError(new Error('rate limit reached'))).toBe(true);
  });

  it('returns true when message contains "ratelimit" (no space)', () => {
    expect(isRateLimitError(new Error('ratelimit exceeded'))).toBe(true);
  });

  it('returns true when err.error.message contains rate limit text', () => {
    expect(isRateLimitError({ error: { message: 'Rate-Limit exceeded' } })).toBe(true);
  });

  it('returns false for a 500 status error', () => {
    expect(isRateLimitError({ status: 500 })).toBe(false);
  });

  it('returns false for a generic Error', () => {
    expect(isRateLimitError(new Error('network error'))).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// chatCompletion
// ---------------------------------------------------------------------------

describe('chatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    mockHasOpenRouter.mockReturnValue(true);
  });

  it('returns z.ai response when z.ai succeeds (OpenRouter NOT called)', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeZaiSuccess('hello from zai'));

    const result = await chatCompletion('sys', 'user');
    expect(result).toBe('hello from zai');
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter when z.ai throws 429 and hasOpenRouter is true', async () => {
    // withRetry retries 3× before throwing; make it throw consistently.
    // We use fake timers to skip the backoff delays.
    mockZaiCreate.mockRejectedValue(rate429());
    mockOrCreate.mockResolvedValueOnce(makeOrSuccess('hello from openrouter'));

    const promise = chatCompletion('sys', 'user');
    // Advance through all withRetry backoff delays (2s + 4s + 8s = 14s)
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('hello from openrouter');
    expect(mockOrCreate).toHaveBeenCalledOnce();

    // The OpenRouter call must use the fallback model
    const [body] = mockOrCreate.mock.calls[0];
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
  });

  it('rethrows a 500 error without calling OpenRouter', async () => {
    const err = Object.assign(new Error('server error'), { status: 500 });
    mockZaiCreate.mockRejectedValue(err);

    // Attach rejection handler BEFORE advancing timers to avoid unhandledRejection noise
    const promise = chatCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.message).toBe('server error');
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('rethrows a rate-limit error when hasOpenRouter is false', async () => {
    mockHasOpenRouter.mockReturnValue(false);
    mockZaiCreate.mockRejectedValue(rate429());

    const promise = chatCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.status).toBe(429);
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter on a z.ai timeout-abort, calling z.ai exactly ONCE (no retry)', async () => {
    mockZaiCreate.mockRejectedValue(abortErr());
    mockOrCreate.mockResolvedValueOnce(makeOrSuccess('from openrouter'));

    const promise = chatCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('from openrouter');
    // An abort must NOT be retried (would otherwise burn 4× the 90s timeout).
    expect(mockZaiCreate).toHaveBeenCalledTimes(1);
    expect(mockOrCreate).toHaveBeenCalledOnce();
  });

  it('does NOT fall back when the CALLER aborts (signal already aborted) — rethrows', async () => {
    mockZaiCreate.mockRejectedValue(abortErr());
    const ac = new AbortController();
    ac.abort();

    const promise = chatCompletion('sys', 'user', { signal: ac.signal });
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;

    expect(result.ok).toBe(false);
    expect(mockOrCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// jsonCompletion
// ---------------------------------------------------------------------------

describe('jsonCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    mockHasOpenRouter.mockReturnValue(true);
  });

  it('returns parsed JSON when z.ai succeeds', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeZaiSuccess('{"key":"value"}'));
    const result = await jsonCompletion<{ key: string }>('sys', 'user');
    expect(result).toEqual({ key: 'value' });
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter on 429, omitting response_format', async () => {
    mockZaiCreate.mockRejectedValue(rate429());
    mockOrCreate.mockResolvedValueOnce(makeOrSuccess('{"answer":42}'));

    const promise = jsonCompletion<{ answer: number }>('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ answer: 42 });
    expect(mockOrCreate).toHaveBeenCalledOnce();

    // Crucially: response_format must NOT be present in the fallback call body
    const [body] = mockOrCreate.mock.calls[0];
    expect(body).not.toHaveProperty('response_format');
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
  });

  it('rethrows 500 from z.ai without calling OpenRouter', async () => {
    const err = Object.assign(new Error('bad gateway'), { status: 502 });
    mockZaiCreate.mockRejectedValue(err);

    const promise = jsonCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.message).toBe('bad gateway');
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter on a z.ai timeout-abort (once, no retry)', async () => {
    mockZaiCreate.mockRejectedValue(abortErr());
    mockOrCreate.mockResolvedValueOnce(makeOrSuccess('{"k":"v"}'));

    const promise = jsonCompletion<{ k: string }>('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ k: 'v' });
    expect(mockZaiCreate).toHaveBeenCalledTimes(1);
    expect(mockOrCreate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// streamCompletion
// ---------------------------------------------------------------------------

describe('streamCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    mockHasOpenRouter.mockReturnValue(true);
  });

  it('returns streamed text when z.ai succeeds (OpenRouter NOT called)', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'hello ' }, { delta: 'world', usage: 5 }]));

    // Stream completion has an idle watchdog timer — run timers after starting
    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('hello world');
    expect(result.tokensUsed).toBe(5);
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter stream when z.ai initial create throws 429', async () => {
    mockZaiCreate.mockRejectedValueOnce(rate429());
    mockOrCreate.mockResolvedValueOnce(makeStream([{ delta: 'fallback text' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('fallback text');
    expect(mockOrCreate).toHaveBeenCalledOnce();

    const [body] = mockOrCreate.mock.calls[0];
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
  });

  it('rethrows non-rate-limit errors without calling OpenRouter', async () => {
    const err = Object.assign(new Error('upstream down'), { status: 503 });
    mockZaiCreate.mockRejectedValueOnce(err);

    const promise = streamCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.message).toBe('upstream down');
    expect(mockOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter stream on a z.ai timeout-abort before any token', async () => {
    mockZaiCreate.mockRejectedValueOnce(abortErr());
    mockOrCreate.mockResolvedValueOnce(makeStream([{ delta: 'recovered' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('recovered');
    expect(mockOrCreate).toHaveBeenCalledOnce();
  });

  it('does NOT apply fallback when caller explicitly chose an OpenRouter model', async () => {
    // When options.model is set, streamCompletion already uses getOpenRouterClient()
    // directly. A 429 from that path should NOT trigger a second OpenRouter attempt.
    mockOrCreate.mockRejectedValueOnce(rate429());

    const promise = streamCompletion('sys', 'user', { model: 'anthropic/claude-opus-4' });
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.status).toBe(429);
    // Called once (the explicit model call), never a second time as fallback
    expect(mockOrCreate).toHaveBeenCalledOnce();
  });

  it('passes thinking:{type:disabled} to the z.ai create when disableThinking is true', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'ok', usage: 3 }]));

    const promise = streamCompletion('sys', 'user', { disableThinking: true });
    await vi.runAllTimersAsync();
    await promise;

    const [body] = mockZaiCreate.mock.calls[0];
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBe(true);
  });

  it('omits the thinking field entirely when disableThinking is not set', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'ok' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    await promise;

    const [body] = mockZaiCreate.mock.calls[0];
    expect(body).not.toHaveProperty('thinking');
  });

  it('still falls back to OpenRouter on 429 with disableThinking set, and forwards thinking to the fallback create', async () => {
    mockZaiCreate.mockRejectedValueOnce(rate429());
    mockOrCreate.mockResolvedValueOnce(makeStream([{ delta: 'fallback' }]));

    const promise = streamCompletion('sys', 'user', { disableThinking: true });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('fallback');
    expect(mockOrCreate).toHaveBeenCalledOnce();
    const [body] = mockOrCreate.mock.calls[0];
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});
