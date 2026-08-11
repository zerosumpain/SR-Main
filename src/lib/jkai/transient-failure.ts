/**
 * Is this failure the upstream saying "not now", rather than the build being wrong?
 *
 * A provider that is overloaded, rate-limiting, or briefly 5xx-ing tells us to
 * come back later. Counting that towards the consecutive-failure abort — a
 * threshold designed to stop an agent looping on a task it cannot do — throws
 * away work for a condition that resolves itself.
 *
 * Cost of getting this wrong, observed 2026-08-11: build 3d62ae01 completed
 * three iterations then hit `service_unavailable_error / server_is_overloaded`
 * on the fourth. Codex answered normally minutes later. Half an hour of work
 * lost to a moment of someone else's load.
 *
 * `wall_clock_timeout` and `iteration_token_cap` are already excluded from that
 * count for the same reason — the work survives and the cause is not a defect.
 * These belong in the same category.
 */
const TRANSIENT_PATTERNS = [
  /server_is_overloaded/i,
  /service_unavailable/i,
  /overloaded/i,
  /\btemporarily unavailable\b/i,
  /\btry again later\b/i,
  /\bgateway timeout\b/i,
  /\bbad gateway\b/i,
  /\b(429|500|502|503|504)\b/,
  /rate.?limit/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
];

export function isTransientProviderFailure(failure: { kind: string; message?: string } | null): boolean {
  if (!failure) return false;
  // rate_limited is transient by definition, whatever the message says.
  if (failure.kind === 'rate_limited') return true;
  if (failure.kind !== 'provider_error' && failure.kind !== 'stalled') return false;
  const msg = failure.message ?? '';
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

/**
 * How long to wait before the next attempt, growing with consecutive transient
 * failures. Hammering an overloaded provider is how a blip becomes an outage.
 */
export function transientBackoffMs(consecutiveTransient: number): number {
  const n = Math.max(1, consecutiveTransient);
  return Math.min(5 * 60_000, 30_000 * 2 ** (n - 1));
}

/** Give up if the provider stays down this many attempts in a row. */
export const MAX_CONSECUTIVE_TRANSIENT = 6;
