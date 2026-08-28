/**
 * Account-level Tavily consumption.
 *
 * The per-run counters on `research_session` answer "what did THIS
 * investigation cost"; this answers the other question a research dashboard
 * raises — "how much of the month is left". Tavily publishes both against the
 * configured key at `GET /usage`; verified 2026-08-15 returning e.g.
 * `{"account":{"current_plan":"Researcher","plan_usage":587,"plan_limit":1000}}`.
 *
 * Fails soft in every direction. A key that is missing, a plan endpoint that
 * moves, a network blip — none of those are reasons to fail the page that
 * merely wanted to mention the number, so every path returns null instead of
 * throwing.
 */
import { getTavilyKey } from '$lib/llm/keys';

export interface TavilyAccountUsage {
  plan: string | null;
  /** Credits consumed on the plan this period. */
  used: number;
  /** Plan allowance, or null on a plan that does not publish one. */
  limit: number | null;
  searches: number;
  extracts: number;
}

const CACHE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 6_000;

let cached: { at: number; value: TavilyAccountUsage | null } | null = null;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function tavilyAccountUsage(now = Date.now()): Promise<TavilyAccountUsage | null> {
  // One call a minute at most: the research page polls while a run is live, and
  // the number moves in credits, not milliseconds.
  if (cached && now - cached.at < CACHE_MS) return cached.value;

  let value: TavilyAccountUsage | null = null;
  try {
    const res = await fetch('https://api.tavily.com/usage', {
      headers: { Authorization: `Bearer ${getTavilyKey()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { account?: Record<string, unknown> };
      const a = body.account ?? {};
      value = {
        plan: typeof a.current_plan === 'string' ? a.current_plan : null,
        used: num(a.plan_usage),
        // `plan_limit` is null on pay-as-you-go, which is a real answer rather
        // than a missing one — an unlimited plan has no bar to fill.
        limit: typeof a.plan_limit === 'number' ? a.plan_limit : null,
        searches: num(a.search_usage),
        extracts: num(a.extract_usage),
      };
    }
  } catch {
    value = null;
  }

  cached = { at: now, value };
  return value;
}

/** Test seam — drops the memo so a test does not wait a minute. */
export function resetTavilyUsageCache(): void {
  cached = null;
}
