import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIUserAbortError } from 'openai';
import { isRateLimitError, chatCompletion, jsonCompletion, streamCompletion } from './ai';

// ---------------------------------------------------------------------------
// Post-migration the primary client is the admin-configured OpenRouter default,
// resolved via getLLMClient(resolveDefaultModel()). The fallback path
// uses getOpenRouterClient() + getFallbackModel() (both from ./keys). Mock all
// of these so tests never touch the filesystem, env vars, or the network.
// ---------------------------------------------------------------------------

const mockPrimaryCreate = vi.fn();
const mockFallbackCreate = vi.fn();

let primaryModel = 'z-ai/glm-5.2';
let fallbackModel = 'google/gemini-3.1-flash-lite-preview';

vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(async () => ({
    client: { chat: { completions: { create: mockPrimaryCreate } } },
    model: primaryModel,
  })),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn(async () => ({ provider: 'openrouter', modelId: primaryModel })),
}));
vi.mock('$lib/llm/keys', () => ({
  getOpenRouterClient: () => ({ chat: { completions: { create: mockFallbackCreate } } }),
  getFallbackModel: () => fallbackModel,
  getEmbeddingModel: () => 'openai/text-embedding-3-small',
}));

// Use fake timers globally so withRetry's setTimeout delays don't stall tests
vi.useFakeTimers();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccess(content: string) {
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
    primaryModel = 'z-ai/glm-5.2';
    fallbackModel = 'google/gemini-3.1-flash-lite-preview';
  });

  it('returns the primary response when the primary succeeds (fallback NOT called)', async () => {
    mockPrimaryCreate.mockResolvedValueOnce(makeSuccess('hello from primary'));

    const result = await chatCompletion('sys', 'user');
    expect(result).toBe('hello from primary');
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('falls back to the fallback model when the primary throws 429', async () => {
    // withRetry retries 3× before throwing; make it throw consistently.
    // We use fake timers to skip the backoff delays.
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(makeSuccess('hello from fallback'));

    const promise = chatCompletion('sys', 'user');
    // Advance through all withRetry backoff delays (2s + 4s + 8s = 14s)
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('hello from fallback');
    expect(mockFallbackCreate).toHaveBeenCalledOnce();

    // The fallback call must use the fallback model
    const [body] = mockFallbackCreate.mock.calls[0];
    expect(body.model).toBe('google/gemini-3.1-flash-lite-preview');
  });

  it('rethrows a 500 error without falling back', async () => {
    const err = Object.assign(new Error('server error'), { status: 500 });
    mockPrimaryCreate.mockRejectedValue(err);

    // Attach rejection handler BEFORE advancing timers to avoid unhandledRejection noise
    const promise = chatCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.message).toBe('server error');
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('rethrows a rate-limit error when the fallback model equals the primary', async () => {
    fallbackModel = primaryModel; // fallback id === primary → no distinct model to try
    mockPrimaryCreate.mockRejectedValue(rate429());

    const promise = chatCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.status).toBe(429);
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('falls back on a primary timeout-abort, calling the primary exactly ONCE (no retry)', async () => {
    mockPrimaryCreate.mockRejectedValue(abortErr());
    mockFallbackCreate.mockResolvedValueOnce(makeSuccess('from fallback'));

    const promise = chatCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('from fallback');
    // An abort must NOT be retried (would otherwise burn 4× the 90s timeout).
    expect(mockPrimaryCreate).toHaveBeenCalledTimes(1);
    expect(mockFallbackCreate).toHaveBeenCalledOnce();
  });

  it('does NOT fall back when the CALLER aborts (signal already aborted) — rethrows', async () => {
    mockPrimaryCreate.mockRejectedValue(abortErr());
    const ac = new AbortController();
    ac.abort();

    const promise = chatCompletion('sys', 'user', { signal: ac.signal });
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;

    expect(result.ok).toBe(false);
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// jsonCompletion
// ---------------------------------------------------------------------------

describe('jsonCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    primaryModel = 'z-ai/glm-5.2';
    fallbackModel = 'google/gemini-3.1-flash-lite-preview';
  });

  it('returns parsed JSON when the primary succeeds', async () => {
    mockPrimaryCreate.mockResolvedValueOnce(makeSuccess('{"key":"value"}'));
    const result = await jsonCompletion<{ key: string }>('sys', 'user');
    expect(result).toEqual({ key: 'value' });
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('falls back to the fallback model on 429, omitting response_format', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(makeSuccess('{"answer":42}'));

    const promise = jsonCompletion<{ answer: number }>('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ answer: 42 });
    expect(mockFallbackCreate).toHaveBeenCalledOnce();

    // Crucially: response_format must NOT be present in the fallback call body
    const [body] = mockFallbackCreate.mock.calls[0];
    expect(body).not.toHaveProperty('response_format');
    expect(body.model).toBe('google/gemini-3.1-flash-lite-preview');
  });

  it('rethrows 500 from the primary without falling back', async () => {
    const err = Object.assign(new Error('bad gateway'), { status: 502 });
    mockPrimaryCreate.mockRejectedValue(err);

    const promise = jsonCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.message).toBe('bad gateway');
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('falls back on a primary timeout-abort (once, no retry)', async () => {
    mockPrimaryCreate.mockRejectedValue(abortErr());
    mockFallbackCreate.mockResolvedValueOnce(makeSuccess('{"k":"v"}'));

    const promise = jsonCompletion<{ k: string }>('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ k: 'v' });
    expect(mockPrimaryCreate).toHaveBeenCalledTimes(1);
    expect(mockFallbackCreate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// streamCompletion
// ---------------------------------------------------------------------------

describe('streamCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    primaryModel = 'z-ai/glm-5.2';
    fallbackModel = 'google/gemini-3.1-flash-lite-preview';
  });

  it('returns streamed text when the primary succeeds (fallback NOT called)', async () => {
    mockPrimaryCreate.mockResolvedValueOnce(makeStream([{ delta: 'hello ' }, { delta: 'world', usage: 5 }]));

    // Stream completion has an idle watchdog timer — run timers after starting
    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('hello world');
    expect(result.tokensUsed).toBe(5);
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('falls back to a fallback-model stream when the primary initial create throws 429', async () => {
    mockPrimaryCreate.mockRejectedValueOnce(rate429());
    mockFallbackCreate.mockResolvedValueOnce(makeStream([{ delta: 'fallback text' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('fallback text');
    expect(mockFallbackCreate).toHaveBeenCalledOnce();

    const [body] = mockFallbackCreate.mock.calls[0];
    expect(body.model).toBe('google/gemini-3.1-flash-lite-preview');
  });

  it('rethrows non-rate-limit errors without falling back', async () => {
    const err = Object.assign(new Error('upstream down'), { status: 503 });
    mockPrimaryCreate.mockRejectedValueOnce(err);

    const promise = streamCompletion('sys', 'user');
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.message).toBe('upstream down');
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('falls back to a fallback-model stream on a primary timeout-abort before any token', async () => {
    mockPrimaryCreate.mockRejectedValueOnce(abortErr());
    mockFallbackCreate.mockResolvedValueOnce(makeStream([{ delta: 'recovered' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('recovered');
    expect(mockFallbackCreate).toHaveBeenCalledOnce();
  });

  it('does NOT apply fallback when the caller explicitly chose a model', async () => {
    // When options.model is set, streamCompletion uses getOpenRouterClient()
    // directly with that model. A 429 from that path must NOT trigger a second
    // (fallback) attempt.
    mockFallbackCreate.mockRejectedValueOnce(rate429());

    const promise = streamCompletion('sys', 'user', { model: 'anthropic/claude-opus-4' });
    const settled = promise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.e.status).toBe(429);
    // Called once (the explicit-model call), never a second time as fallback
    expect(mockFallbackCreate).toHaveBeenCalledOnce();
    expect(mockPrimaryCreate).not.toHaveBeenCalled();
  });
});
