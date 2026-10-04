import { getFromExtracted } from '$lib/server/extracted-app';
import type { HubDigest } from './health-hub-contract';

/**
 * The overnight vitals, Watch beside WHOOP strap, for the phone's Today tile.
 *
 * SR-Health's `GET /api/health/vitals` — the same section the hub digest
 * carries, without the hub's eleven services, because Today is the screen the
 * app opens on and must stay one cheap request. A pass-through: the headline,
 * the brief and the tone are SR-Health's, decided by the code that owns the
 * numbers (see `health-hub-contract.ts`).
 *
 * Cached for a minute like the summary beside it.
 */
export type NativeVitals = NonNullable<HubDigest['vitals']>;

const CACHE_MS = 60_000;
let cached: { at: number; value: NativeVitals | null } | null = null;

export async function getNativeHealthVitals({ fresh = false }: { fresh?: boolean } = {}): Promise<NativeVitals | null> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const { vitals } = await getFromExtracted<{ vitals: HubDigest['vitals'] }>('health', '/api/health/vitals', { timeoutMs: 4000 });
  cached = { at: Date.now(), value: vitals ?? null };
  return cached.value;
}

/**
 * What the Today tile carries: the read and one pair, nothing to chart. The
 * Health tab fetches the whole section when it is opened.
 */
export function todayOvernight(vitals: NativeVitals | null): { headline: string; brief: string | null; tone: string } | null {
  if (!vitals?.headline) return null;
  return { headline: vitals.headline, brief: vitals.brief ?? null, tone: vitals.tone ?? 'none' };
}
