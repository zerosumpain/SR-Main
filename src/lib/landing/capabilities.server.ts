// capabilities.server.ts — the slow-moving facts the landing page's capability
// sections print beside the live readings.
//
// Same rule as the Engine Room study this page links into: nothing here is a
// literal. The think cadence and its waking hours are imported from the module
// the Daydream loop runs on, the endpoint count is read from the route manifest
// the build emits, and the hit rate is the impact figure the study itself shows.
// Counts and ratios only: no note, title or path leaves the server.
//
// The front door pays no slow-path latency for these. The DB-backed figure is
// memoised for five minutes and timeboxed, so a cold or missing table renders as
// a dash on that one line, never as a slow page.

import { ROUTE_MANIFEST } from 'virtual:sr-route-manifest';
import { THINK_CADENCE_MS } from '$lib/daydream/think/questions';
import { ACTIVE_HOURS } from '$lib/daydream/budget';
import { IMPACT_WINDOW_DAYS } from '$lib/daydream/impact';

import type { CapabilityFacts } from './capabilities';

export type { CapabilityFacts };

const TTL_MS = 5 * 60_000;
const BUDGET_MS = 400;

let memo: { at: number; hitRate: number | null } | null = null;

async function hitRate(now: Date): Promise<number | null> {
  if (memo && now.getTime() - memo.at < TTL_MS) return memo.hitRate;
  try {
    const { loadImpact } = await import('$lib/daydream/impact.server');
    const { impact } = await loadImpact(now);
    memo = { at: now.getTime(), hitRate: impact.current.hitRate };
    return memo.hitRate;
  } catch (err) {
    console.error('[landing] daydream hit rate unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export async function loadCapabilityFacts(now = new Date()): Promise<CapabilityFacts> {
  return {
    daydream: {
      cadenceMinutes: THINK_CADENCE_MS / 60_000,
      activeHours: { ...ACTIVE_HOURS },
      hitRate: await within(hitRate(now), BUDGET_MS, memo?.hitRate ?? null),
      windowDays: IMPACT_WINDOW_DAYS,
    },
    app: {
      nativeEndpoints: ROUTE_MANIFEST.filter((r) => r.kind === 'api' && r.path.startsWith('/api/native/')).length,
    },
  };
}
