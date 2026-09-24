import { getFromExtracted } from '$lib/server/extracted-app';
import type { HubDigest } from './health-hub-contract';

/**
 * /health's summary intelligence for the phone — sections A to I, digested by
 * SR-Health (`GET /api/health/hub`), which owns every number and every
 * sentence in it.
 *
 * A pass-through, deliberately, unlike `native-health.ts`. That one reshapes a
 * contract written for the chat rail; this contract was written for the phone,
 * so reshaping it here would be a second place for the same decision to live.
 *
 * Cached for a minute like the summary: the hub is the most expensive read on
 * /health (eleven services, the trails dashboard, the coach), and a phone
 * scrolling up and down the tab must not recompute it on every appearance.
 */
const CACHE_MS = 60_000;
let cached: { at: number; value: HubDigest } | null = null;

export async function getNativeHealthHub({ fresh = false }: { fresh?: boolean } = {}): Promise<HubDigest> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  // Longer than the summary's six seconds: the coach alone can spend an
  // openrouteservice round trip, and a slow full answer beats a fast timeout.
  const value = await getFromExtracted<HubDigest>('health', '/api/health/hub', { timeoutMs: 15000 });
  cached = { at: Date.now(), value };
  return value;
}
