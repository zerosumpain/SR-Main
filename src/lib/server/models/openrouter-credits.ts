import { getOpenRouterApiKey } from './settings';

/**
 * The account's real OpenRouter credit position.
 *
 * The /jkai header used to render today's spend against a STATIC number — a
 * `jkai.dailyBudgetUsd` app_setting defaulting to $15 — which reads as "of total
 * credit" but had no connection to the account at all. It never moved when
 * credit was topped up or burnt down, so the one number a spend strip exists to
 * answer ("how much have I got left?") was decorative.
 *
 * `/api/v1/credits` is the account-level endpoint: lifetime credits purchased
 * and lifetime usage. `/api/v1/auth/key` is deliberately NOT used — it reports
 * per-KEY usage against an optional per-key limit, which is null on this
 * account, so it cannot answer the balance question.
 */
export interface OpenRouterCredits {
  /** Lifetime credits purchased, USD. */
  totalUsd: number;
  /** Lifetime credits consumed, USD. */
  usedUsd: number;
  /** What is actually left to spend, USD. */
  remainingUsd: number;
  /** Epoch ms the figure was fetched — drives the "as of" tooltip. */
  fetchedAt: number;
}

/** The /jkai layout load runs on EVERY navigation across the hub, so this is
 *  cached in-process rather than hit per page view. A minute is fresh enough
 *  for a balance that only moves as fast as you can spend it. */
const TTL_MS = 60_000;
/** Shorter re-try window after a failure, so a blip doesn't cost a full TTL. */
const FAILURE_TTL_MS = 15_000;

let cached: { value: OpenRouterCredits | null; expiresAt: number } | null = null;
let inflight: Promise<OpenRouterCredits | null> | null = null;

export function clearOpenRouterCreditsCache(): void {
  cached = null;
  inflight = null;
}

async function fetchCredits(): Promise<OpenRouterCredits | null> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn(`[openrouter-credits] /credits returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const totalUsd = Number(body?.data?.total_credits);
    const usedUsd = Number(body?.data?.total_usage);
    if (!Number.isFinite(totalUsd) || !Number.isFinite(usedUsd)) return null;

    return {
      totalUsd,
      usedUsd,
      remainingUsd: Math.max(0, totalUsd - usedUsd),
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn(
      '[openrouter-credits] fetch failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Current credit position, or null when OpenRouter can't be reached and nothing
 * has ever been fetched.
 *
 * A failed refresh carries the LAST GOOD figure forward rather than nulling it —
 * same reasoning as the throughput column in ./openrouter-catalogue.ts. A header
 * that drops to "—" every time a request times out is worse than one showing a
 * balance that is a few minutes stale.
 */
export async function getOpenRouterCredits(): Promise<OpenRouterCredits | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  // Collapse concurrent loads (several /jkai tabs, or a navigation storm) onto
  // one request instead of one per caller.
  if (inflight) return inflight;

  inflight = fetchCredits()
    .then((fresh) => {
      const value = fresh ?? cached?.value ?? null;
      cached = {
        value,
        expiresAt: Date.now() + (fresh ? TTL_MS : FAILURE_TTL_MS),
      };
      return value;
    })
    .catch(() => cached?.value ?? null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
