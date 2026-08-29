// Wider usage windows for the /jkai header strip and the sidebar tok/s meter.
//
// The layout load hands every hub page today's figures already. This module
// holds the 7-day and 30-day ones, which nobody has asked for until they click
// a chunk to widen it — so it is fetched lazily, once, and shared: the header
// strip and the ConversationSidebar footer are in different trees with no
// common parent state, the same reason `throughput-bus.svelte.ts` lives here.
//
// The day figures come back too, but the strip keeps showing the load's — they
// are the same number, and re-rendering it from a second source would make it
// flicker by a few hundred tokens when you cycled back round to TODAY.

export interface UsageWindowsPayload {
  tokens: { day: number; week: number; month: number };
  spendUsd: { day: number; week: number; month: number };
  tps: { day: number | null; week: number | null };
  fetchedAt: number;
}

export const usageWindows = $state({
  /** A fetch is in flight — the strip shows `…` rather than a stale figure. */
  loading: false,
  /** At least one fetch has landed, so the numbers below mean something. */
  loaded: false,
  /** The last fetch failed. Shown as `—`, not as a zero. */
  failed: false,
  tokens: { day: 0, week: 0, month: 0 },
  spendUsd: { day: 0, week: 0, month: 0 },
  tps: { day: null as number | null, week: null as number | null },
  fetchedAt: 0,
});

/** Internal handles — never `$state`: `ensure` both reads and writes them. */
let inflight: Promise<void> | null = null;
/** How long a reading stays good. Matches the layout's own credit cache. */
const TTL_MS = 60_000;

/**
 * Fetch the wider windows if we don't have a fresh copy.
 *
 * Safe to call on every click: concurrent callers share one request, and a
 * reading younger than the TTL is reused rather than re-fetched.
 */
export function ensureUsageWindows(force = false): void {
  if (typeof fetch === 'undefined') return;
  if (inflight) return;
  if (!force && usageWindows.loaded && Date.now() - usageWindows.fetchedAt < TTL_MS) return;

  usageWindows.loading = true;
  inflight = fetch('/api/jkai/usage-windows')
    .then(async (res) => {
      if (!res.ok) throw new Error(`usage-windows ${res.status}`);
      const body = (await res.json()) as UsageWindowsPayload;
      usageWindows.tokens = body.tokens;
      usageWindows.spendUsd = body.spendUsd;
      usageWindows.tps = body.tps;
      usageWindows.fetchedAt = body.fetchedAt ?? Date.now();
      usageWindows.loaded = true;
      usageWindows.failed = false;
    })
    .catch((err: unknown) => {
      // A widened window that can't be read is worth one console line and a
      // dash on screen — it must never take the header down with it.
      console.warn('[usage-windows] fetch failed:', err instanceof Error ? err.message : err);
      usageWindows.failed = true;
    })
    .finally(() => {
      usageWindows.loading = false;
      inflight = null;
    });
}
