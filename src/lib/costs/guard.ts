/**
 * One shape for "may this spend happen?".
 *
 * The site had four spend guards that shared no vocabulary: the nightly
 * self-improve budget and its near-copy in the workflow doctor (per-run cash
 * caps), the daydream Codex policy (percentage of a subscription window), and
 * the build-loop budget (iterations, minutes, tokens per hour). Each answered
 * the same question with a different return type, so nothing could read them
 * side by side.
 *
 * They keep their own policies — this file is types only. What they share is
 * the verdict:
 *
 *   allowed        may the next unit of spend start
 *   reason         why not, in words a pulse or a log line can carry
 *   remaining      whatever headroom the guard can quantify, keyed by unit
 *   retryAfterMs   a cooldown: the refusal lifts on its own after this long
 *   terminal       the refusal will NOT lift — stop, don't wait
 *
 * A guard is scoped when it is constructed (one per run, per build, per
 * action), so `check()` takes no arguments; `record()` feeds a unit of spend
 * back into whatever the guard counts.
 */

export interface GuardVerdict {
  allowed: boolean;
  reason: string | null;
  remaining: Record<string, number>;
  retryAfterMs?: number;
  terminal?: boolean;
}

export interface SpendGuard<U> {
  check(): Promise<GuardVerdict>;
  record(u: U): void | Promise<void>;
}
