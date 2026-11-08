// jkai's identity, read from SR-Jkai-Core (slice 9).
//
// Core owns the soul (`data/prompts/` there; Main's copy is gone). A surface
// here that writes prose as jkai — the daydream note writer today — asks Core
// for the soul plus its overlay:
//
//   GET /api/jkai/service/identity?surface=<heartbeat|daydream|canvas|briefing>
//   Authorization: Bearer <JKAI_INVOKE_TOKEN>      (the standard lane only)
//   → 200 { surface, identityVersion, text }
//
// Cached for five minutes per surface. If Core cannot be reached, or answers
// with something else, this logs and returns '' so the caller falls back to
// its own task prompt: a daydream cycle never throws for want of a persona.
// A failure is remembered for a minute, so a down Core costs one timeout a
// minute rather than one per call.
import { getFromExtracted } from '$lib/server/extracted-app';

export type IdentitySurface = 'heartbeat' | 'daydream' | 'canvas' | 'briefing';

export interface JkaiIdentity {
  text: string;
  identityVersion: string | null;
}

const TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 60_000;
const TIMEOUT_MS = 3_000;
const cache = new Map<IdentitySurface, { at: number; ttl: number; value: JkaiIdentity }>();

const NONE: JkaiIdentity = { text: '', identityVersion: null };

export async function getJkaiIdentity(surface: IdentitySurface, now: number = Date.now()): Promise<JkaiIdentity> {
  const hit = cache.get(surface);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  try {
    const res = await getFromExtracted<{ text?: unknown; identityVersion?: unknown }>(
      'jkai-core',
      `/api/jkai/service/identity?surface=${surface}`,
      { timeoutMs: TIMEOUT_MS },
    );
    if (typeof res?.text !== 'string' || !res.text.trim()) throw new Error('no identity text in the answer');
    const value = {
      text: res.text.trim(),
      identityVersion: typeof res.identityVersion === 'string' ? res.identityVersion.slice(0, 120) : null,
    };
    cache.set(surface, { at: now, ttl: TTL_MS, value });
    return value;
  } catch (err) {
    console.warn(`[jkai-identity] ${surface}: ${err instanceof Error ? err.message : err} — falling back to the task prompt`);
    cache.set(surface, { at: now, ttl: FAILURE_TTL_MS, value: NONE });
    return NONE;
  }
}

/** Tests only. */
export function clearJkaiIdentityCache(): void {
  cache.clear();
}
