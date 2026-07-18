// src/lib/llm/resilience.ts
//
// Provider-agnostic LLM resilience primitives, shared by the deep-research
// gateway ($lib/deepdive/ai.ts) and the workflow LLM nodes
// ($lib/llm/workflow-gateway.ts). No key/provider coupling lives here — just the
// error classification, retry, timeout-signal and concurrency mechanics that
// both call sites need.

import { APIUserAbortError, APIConnectionTimeoutError } from 'openai';

/**
 * Returns true when an error indicates a rate-limit (HTTP 429 or a
 * rate-limit-worded error body).
 */
export function isRateLimitError(err: any): boolean {
  if (err?.status === 429) return true;
  if (/rate.?limit/i.test(String(err?.message ?? ''))) return true;
  if (/rate.?limit/i.test(String(err?.error?.message ?? ''))) return true;
  return false;
}

/**
 * True for any abort/timeout error.
 *
 * The OpenAI SDK throws `APIUserAbortError` when an AbortSignal fires and
 * `APIConnectionTimeoutError` on its own timeout. CRITICAL: the SDK's error
 * classes inherit `Error.prototype.name` ("Error") — they do NOT set `.name` to
 * their class name — so an `err.name === 'APIUserAbortError'` check NEVER matches
 * a real SDK abort. Match by `instanceof` (and constructor name / message as a
 * belt-and-suspenders) instead. The native `.name` strings are kept for the
 * raw-`fetch` paths (e.g. fetch-page-text) and a client's own timeout.
 */
export function isAbortError(err: any): boolean {
  if (err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError) return true;
  if (err?.constructor?.name === 'APIUserAbortError' || err?.constructor?.name === 'APIConnectionTimeoutError') return true;
  if (err?.message === 'Request was aborted.') return true;
  const name = err?.name;
  return name === 'AbortError' || name === 'APIUserAbortError' || name === 'TimeoutError';
}

/**
 * True when an abort came from OUR own timeout (the provider was too slow), as
 * opposed to the CALLER cancelling via their signal. When the caller's signal is
 * already aborted we must NOT fall back — the work was cancelled on purpose.
 * Otherwise an abort means our timeout watchdog fired, so a fallback provider is
 * a valid recovery.
 */
export function isOurTimeoutAbort(err: any, externalSignal: AbortSignal | undefined): boolean {
  if (externalSignal?.aborted) return false;
  return isAbortError(err);
}

/**
 * Combine an optional caller signal with a fresh timeout signal so a call aborts
 * on whichever fires first.
 */
export function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  return AbortSignal.any([external, timeout]);
}

/**
 * Retry `fn` with backoff. NEVER retries an abort/timeout — a caller-cancellation
 * must propagate, and our own timeout-abort should drop straight to the caller's
 * fallback rather than burning N× the timeout retrying the same slow provider.
 * Rate limits back off 2s/4s/8s; other transient errors retry after 2s.
 */
export async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      const isRateLimit = err?.status === 429;
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) throw err;

      const delay = isRateLimit
        ? Math.min(2000 * Math.pow(2, attempt), 30000) // 2s, 4s, 8s for rate limits
        : 2000;

      console.error(`[llm] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}${isRateLimit ? ', rate limited' : ''}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

/**
 * Counting-semaphore: `pLimit(max)` returns a wrapper that runs at most `max`
 * tasks concurrently; the rest queue and start as a slot frees.
 *
 *   const limit = pLimit(3);
 *   await Promise.all(items.map((i) => limit(() => process(i))));
 */
export function pLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`pLimit: max must be a positive integer, got ${max}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function tryNext(): void {
    if (active >= max || queue.length === 0) return;
    const run = queue.shift()!;
    active++;
    run();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (value) => {
            resolve(value);
            active--;
            tryNext();
          },
          (err) => {
            reject(err);
            active--;
            tryNext();
          },
        );
      };

      queue.push(run);
      tryNext();
    });
  };
}
