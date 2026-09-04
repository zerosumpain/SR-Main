export type ActivitySyncFailureKind =
  | 'rate_limited'
  | 'temporary_provider'
  | 'credential'
  | 'private_source'
  | 'invalid_payload'
  | 'policy_blocked'
  | 'internal';

export class ActivitySyncError extends Error {
  constructor(
    readonly kind: ActivitySyncFailureKind,
    message: string,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = 'ActivitySyncError';
  }
}

export function isRetryableActivityFailure(kind: ActivitySyncFailureKind): boolean {
  return kind === 'rate_limited' || kind === 'temporary_provider' || kind === 'internal';
}

export function computeActivityRetryDelayMs(input: {
  attempt: number;
  retryAfterMs?: number;
  jitter?: number;
  baseMs?: number;
  maxMs?: number;
}): number {
  if (input.retryAfterMs !== undefined) return Math.max(1_000, input.retryAfterMs);
  const baseMs = input.baseMs ?? 30_000;
  const maxMs = input.maxMs ?? 6 * 60 * 60 * 1000;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, input.attempt - 1));
  const jitter = Math.max(0, Math.min(1, input.jitter ?? Math.random()));
  return Math.round(exponential * (0.75 + jitter * 0.5));
}

export function safeActivityErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Provider responses occasionally echo Authorization headers/tokens. Keep
  // persisted and operator-visible errors useful without storing the value.
  return text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+/gi, '$1[redacted]')
    .replace(/([?&](?:access_token|key|token|client_secret)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 1_000);
}
