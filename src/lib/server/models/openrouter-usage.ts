/**
 * What OpenRouter says this key actually spent — the figure the ledger is
 * checked against.
 *
 * `agent_actions` is the site's own account of its LLM spend, and an account
 * kept by the thing being measured cannot tell you what it MISSED. Three known
 * classes of spend never reached it: embeddings and the FLUX image endpoint
 * (both now recorded), and the Hermes engine, which is a separate Python
 * runtime that never goes through the SvelteKit gateway at all. Only the
 * provider can settle the difference.
 *
 * `GET /api/v1/activity` would give a per-day, per-model breakdown and would be
 * the ideal source. It is not available here: it answers 403 "Only management
 * keys can fetch activity for an account" to the inference key, verified
 * 2026-08-22, and this account has no management key.
 *
 * What IS reachable is `GET /api/v1/key`, which reports rolling usage windows
 * for the calling key. That is the right scope for the reconciliation, because
 * Hermes shares this key (`~/.hermes-jkai/.env` carries the same `sk-or-v1-56e8…`)
 * — so "billed to this key" covers the site and the engine together, which is
 * exactly the boundary the ledger is trying to cover.
 *
 * `$lib/server/models/openrouter-credits` answers a different question — the
 * ACCOUNT's lifetime position across every key ever issued — and the two are
 * both shown, because their difference is real: $79.17 account against $59.30
 * key at the time of writing, i.e. ~$20 spent on keys that no longer exist.
 */
import { getOpenRouterApiKey } from './settings';

export interface OpenRouterKeyUsage {
  /** Masked label OpenRouter shows for the key, e.g. `sk-or-v1-56e…fd7`. */
  label: string | null;
  /** Rolling windows, USD. OpenRouter's own definitions of "day"/"week"/"month". */
  daily: number;
  weekly: number;
  monthly: number;
  /** Lifetime usage on this key, USD. */
  lifetime: number;
  /** A per-key spend ceiling, when one is set. Null on this account. */
  limitUsd: number | null;
  /** Epoch ms the figure was fetched. */
  fetchedAt: number;
  /**
   * Locally computed `sk-or-v1-xxx…yyy` for the key these figures belong to.
   *
   * NOT `label` — that is OpenRouter's own masking and only ever describes the
   * key this process holds. This one is computed the same way on both hosts, so
   * it can be compared against the engine's key to answer the question the
   * coverage table depends on: is the engine's spend even billed to this key?
   */
  fingerprint: string | null;
}

/** Enough of a key to compare two of them, and never enough to use one. */
export function keyFingerprint(key: string | null | undefined): string | null {
  if (!key || key.length < 12) return null;
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}

/** Same cadence as ./openrouter-credits.ts — the number only moves as fast as
 *  it can be spent, and the costs page is not a hot path. */
const TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;

let cached: { value: OpenRouterKeyUsage | null; expiresAt: number } | null = null;
let inflight: Promise<OpenRouterKeyUsage | null> | null = null;

export function clearOpenRouterKeyUsageCache(): void {
  cached = null;
  inflight = null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchKeyUsage(): Promise<OpenRouterKeyUsage | null> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn(`[openrouter-usage] /key returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      data?: {
        label?: string;
        usage?: number;
        usage_daily?: number;
        usage_weekly?: number;
        usage_monthly?: number;
        limit?: number | null;
      };
    };
    const d = body?.data;
    if (!d) return null;

    return {
      label: typeof d.label === 'string' ? d.label : null,
      daily: num(d.usage_daily),
      weekly: num(d.usage_weekly),
      monthly: num(d.usage_monthly),
      lifetime: num(d.usage),
      limitUsd: typeof d.limit === 'number' ? d.limit : null,
      fetchedAt: Date.now(),
      fingerprint: keyFingerprint(apiKey),
    };
  } catch (err) {
    console.warn('[openrouter-usage] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * This key's usage windows, or null when OpenRouter cannot be reached and
 * nothing has ever been fetched.
 *
 * A failed refresh carries the last good figure forward rather than nulling it,
 * matching ./openrouter-credits.ts: a reconciliation panel that empties itself
 * on a timeout reads as "nothing was billed", which is the one wrong answer.
 */
export async function getOpenRouterKeyUsage(): Promise<OpenRouterKeyUsage | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inflight) return inflight;

  inflight = fetchKeyUsage()
    .then((fresh) => {
      const value = fresh ?? cached?.value ?? null;
      cached = { value, expiresAt: Date.now() + (fresh ? TTL_MS : FAILURE_TTL_MS) };
      return value;
    })
    .catch(() => cached?.value ?? null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
