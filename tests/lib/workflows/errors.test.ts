import { describe, it, expect, vi } from 'vitest';
import {
  RetryableError,
  FatalError,
  classifyError,
  backoffDelay,
  retryPolicyFor,
  runWithRetries,
} from '$lib/workflows/errors';

describe('classifyError', () => {
  it('trusts the typed errors a node throws', () => {
    expect(classifyError(new RetryableError('busy'))).toBe('retryable');
    expect(classifyError(new FatalError('bad config'))).toBe('fatal');
  });

  it('reads transient network failures as retryable', () => {
    expect(classifyError(new TypeError('fetch failed'))).toBe('retryable');
    expect(classifyError(Object.assign(new Error('socket'), { code: 'ECONNRESET' }))).toBe('retryable');
    expect(classifyError(new Error('boom', { cause: { code: 'ETIMEDOUT' } }))).toBe('retryable');
  });

  it('reads 429 and 5xx as retryable, other 4xx as fatal', () => {
    expect(classifyError(Object.assign(new Error('x'), { status: 429 }))).toBe('retryable');
    expect(classifyError(Object.assign(new Error('x'), { statusCode: 503 }))).toBe('retryable');
    expect(classifyError(new Error('HTTP 502 Bad Gateway'))).toBe('retryable');
    expect(classifyError(new Error('Open-Meteo returned 500 Internal Server Error'))).toBe('retryable');
    expect(classifyError(Object.assign(new Error('x'), { status: 401 }))).toBe('fatal');
    expect(classifyError(new Error('HTTP 404 Not Found'))).toBe('fatal');
  });

  it('leaves everything else unknown', () => {
    expect(classifyError(new Error('Cannot read properties of undefined'))).toBe('unknown');
    expect(classifyError('a string')).toBe('unknown');
  });
});

describe('backoffDelay', () => {
  it('doubles per attempt with jitter in the upper half, capped', () => {
    expect(backoffDelay(1, 1000, 30_000, () => 0)).toBe(500);
    expect(backoffDelay(1, 1000, 30_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 30_000, () => 1)).toBe(4000);
    expect(backoffDelay(10, 1000, 30_000, () => 1)).toBe(30_000);
  });
});

describe('retryPolicyFor', () => {
  it('keeps the _onError retry keys: retries + retryDelayMs', () => {
    expect(retryPolicyFor({ mode: 'retry', retries: 4, retryDelayMs: 250 }, false))
      .toEqual({ maxAttempts: 5, baseDelayMs: 250, retryUnknown: true, retryClassified: true });
  });
  it('clamps retries to 0-10 as before', () => {
    expect(retryPolicyFor({ mode: 'retry', retries: 99 }, false).maxAttempts).toBe(11);
  });
  it('auto-retries transient failures only on an idempotent node', () => {
    expect(retryPolicyFor(undefined, true)).toMatchObject({ maxAttempts: 3, retryUnknown: false, retryClassified: true });
    expect(retryPolicyFor({ mode: 'stop' }, false)).toMatchObject({ maxAttempts: 3, retryUnknown: false, retryClassified: false });
  });
});

describe('runWithRetries', () => {
  const noSleep = vi.fn(async () => {});

  it('retries a transient failure on an idempotent node, then succeeds', async () => {
    let n = 0;
    const out = await runWithRetries(async () => {
      if (++n < 3) throw new TypeError('fetch failed');
      return 'ok';
    }, retryPolicyFor(undefined, true), { sleep: noSleep });
    expect(out).toBe('ok');
    expect(n).toBe(3);
  });

  it('never retries a fatal error, even in retry mode', async () => {
    let n = 0;
    await expect(runWithRetries(async () => {
      n++;
      throw new FatalError('No operation configured');
    }, retryPolicyFor({ mode: 'retry', retries: 5 }, false), { sleep: noSleep })).rejects.toThrow('No operation');
    expect(n).toBe(1);
  });

  it('does not auto-retry a classified failure on a side-effecting node', async () => {
    let n = 0;
    await expect(runWithRetries(async () => {
      n++;
      throw new Error('HTTP 503');
    }, retryPolicyFor(undefined, false), { sleep: noSleep })).rejects.toThrow('503');
    expect(n).toBe(1);
  });

  it('does retry a side-effecting node that throws RetryableError itself', async () => {
    let n = 0;
    await runWithRetries(async () => {
      if (++n < 2) throw new RetryableError('rate limited');
      return 1;
    }, retryPolicyFor(undefined, false), { sleep: noSleep });
    expect(n).toBe(2);
  });

  it('retries an unknown error only in retry mode', async () => {
    let n = 0;
    await runWithRetries(async () => {
      if (++n < 3) throw new Error('weird');
      return 1;
    }, retryPolicyFor({ mode: 'retry', retries: 2, retryDelayMs: 10 }, false), { sleep: noSleep });
    expect(n).toBe(3);
  });

  it('stops as soon as the signal is aborted', async () => {
    const c = new AbortController();
    let n = 0;
    await expect(runWithRetries(async () => {
      n++;
      c.abort();
      throw new TypeError('fetch failed');
    }, retryPolicyFor(undefined, true), { sleep: noSleep, signal: c.signal })).rejects.toThrow('fetch failed');
    expect(n).toBe(1);
  });

  it('backs off between attempts', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let n = 0;
    await runWithRetries(async () => {
      if (++n < 3) throw new RetryableError('x');
      return 1;
    }, { maxAttempts: 3, baseDelayMs: 1000, retryUnknown: false, retryClassified: true }, { sleep, random: () => 1 });
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000]);
  });
});
