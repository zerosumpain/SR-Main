import type { NodeOnErrorConfig } from './types';

/**
 * Typed node failures, and the one retry loop the engine wraps every executor in.
 *
 * A node throws `FatalError` for what no retry can fix (missing config, bad
 * input, a 4xx) and `RetryableError` for what a retry may (rate limit, a
 * flapping upstream). Anything else is classified from its shape: network
 * resets and 429/5xx are transient, other 4xx are not, the rest is unknown.
 */
export class RetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RetryableError';
  }
}

export class FatalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FatalError';
  }
}

export type ErrorClass = 'retryable' | 'fatal' | 'unknown';

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
const TRANSIENT_TEXT = /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network error/i;
const HTTP_STATUS_TEXT = /\b(?:HTTP|status|returned|responded)\D{0,12}([1-5]\d\d)\b/i;

function statusOf(err: Record<string, unknown>): number | null {
  for (const v of [err.status, err.statusCode, (err.response as Record<string, unknown> | undefined)?.status]) {
    if (typeof v === 'number' && v >= 100 && v < 600) return v;
  }
  const m = typeof err.message === 'string' ? HTTP_STATUS_TEXT.exec(err.message) : null;
  return m ? Number(m[1]) : null;
}

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof FatalError) return 'fatal';
  if (err instanceof RetryableError) return 'retryable';
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as Record<string, unknown>;
  const cause = (e.cause ?? {}) as Record<string, unknown>;
  if (TRANSIENT_CODES.has(String(e.code)) || TRANSIENT_CODES.has(String(cause.code))) return 'retryable';
  const status = statusOf(e);
  if (status === 429 || (status !== null && status >= 500)) return 'retryable';
  if (status !== null && status >= 400) return 'fatal';
  if (typeof e.message === 'string' && TRANSIENT_TEXT.test(e.message)) return 'retryable';
  return 'unknown';
}

/** Exponential backoff with "equal jitter": a delay in the upper half of base·2^(n-1), capped. */
export function backoffDelay(attempt: number, baseMs: number, capMs = 30_000, random = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  /** Retry an error nobody could classify (only when the owner asked for retries). */
  retryUnknown: boolean;
  /** Retry an error classified transient from its shape, not thrown as RetryableError. */
  retryClassified: boolean;
}

/**
 * `_onError: { mode:'retry', retries, retryDelayMs }` keeps its meaning — the
 * owner asked for N retries of anything not fatal. Without it, transient
 * failures are still retried twice, but only on a node that declares itself
 * idempotent (or throws RetryableError itself): re-sending a POST that a 503
 * may have half-applied is the node's call, not the engine's.
 */
export function retryPolicyFor(onError: NodeOnErrorConfig | undefined, idempotent: boolean): RetryPolicy {
  if (onError?.mode === 'retry') {
    const retries = Math.max(0, Math.min(10, Number(onError.retries ?? 0)));
    return { maxAttempts: retries + 1, baseDelayMs: Math.max(0, Number(onError.retryDelayMs ?? 1000)), retryUnknown: true, retryClassified: true };
  }
  return { maxAttempts: 3, baseDelayMs: 1000, retryUnknown: false, retryClassified: idempotent };
}

function shouldRetry(err: unknown, policy: RetryPolicy): boolean {
  const cls = classifyError(err);
  if (cls === 'fatal') return false;
  if (err instanceof RetryableError) return true;
  if (cls === 'retryable') return policy.retryClassified;
  return policy.retryUnknown;
}

export async function runWithRetries<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  opts: {
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  } = {},
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      // A timed-out or cancelled node has an aborted controller: another attempt
      // would only fail instantly with a cancellation that hides the real error.
      if (attempt >= policy.maxAttempts || opts.signal?.aborted || !shouldRetry(err, policy)) throw err;
      const delay = policy.baseDelayMs > 0 ? backoffDelay(attempt, policy.baseDelayMs, 30_000, opts.random) : 0;
      opts.onRetry?.(attempt, err, delay);
      if (delay > 0) await sleep(delay);
    }
  }
}
