/**
 * Simple in-memory per-key token bucket rate limiter.
 *
 * Intended for a single-instance deployment. For multi-instance setups,
 * swap the backing Map for Redis.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max tokens in the bucket (i.e., burst size). */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: opts.capacity, updatedAt: now };

  // Refill
  const elapsedSec = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsedSec * opts.refillPerSecond);
  bucket.updatedAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }

  buckets.set(key, bucket);
  const deficit = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil((deficit / opts.refillPerSecond) * 1000);
  return { allowed: false, remaining: 0, retryAfterMs };
}

/** Remove buckets older than 10 minutes. Call periodically or skip — memory pressure is minimal. */
export function cleanupBuckets(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    if (bucket.updatedAt < cutoff) {
      buckets.delete(key);
    }
  }
}

setInterval(cleanupBuckets, 5 * 60 * 1000).unref?.();
