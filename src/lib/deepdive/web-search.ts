/**
 * The search balancer — every web search the site makes comes through here.
 *
 * Two providers stand behind it: Tavily (`./tavily`) and Brave Search
 * (`./brave`). Brave's monthly allowance is the larger, so a search goes to
 * whichever provider has more of its month left, in proportion: with 14,000
 * Brave requests and 400 Tavily searches remaining, about 97% of searches go
 * to Brave. Both run down together instead of one running out mid-month.
 *
 * What overrides the proportion:
 * - A provider with no key is never chosen. With one key configured, the
 *   balancer is that provider plus a retry, exactly as search was before.
 * - A request only Tavily serves well — an `includeAnswer` (Brave writes no
 *   answer), an `advanced` depth (Tavily's richer passages), or a query or
 *   domain list longer than Brave accepts — goes to Tavily first.
 * - Brave's burst limit (one request a second on its base plans) is tracked
 *   here. A search that would exceed it goes to Tavily instead, so a research
 *   run's parallel fan-out spreads over both providers rather than queueing.
 *   When Brave is the only choice, each search reserves the next free slot
 *   before it waits, so a queue of them goes out one slot apart rather than
 *   waking together and tripping the limit.
 * - A caller can name a provider (`provider`). Only the `tavily_search` tool
 *   does, because John asks for Tavily by name when he uses it.
 * - A provider that refuses is rested: until its allowance resets when it
 *   says it is spent, a few minutes for a bad key or a server error.
 *
 * A failed request fails over to the other provider once; with only one
 * provider available it is retried once after two seconds, as before. Each
 * attempt is written to the ledger by the provider client that made it, so
 * /admin/ops/tavily shows both providers' usage, failovers included.
 *
 * Extraction stays with Tavily (`extract` in `./tavily`): Brave has no
 * equivalent.
 */
import { loadKeys } from '$lib/llm/keys';
import { countBraveSearch, searchCredits } from '$lib/context/research-meter';
import { cachedTavilyAccountUsage, tavilyAccountUsage } from './tavily-usage';
import { tavilySearch, TavilyHttpError, type TavilySearchResponse, type TavilySearchResult } from './tavily';
import { braveSearch, braveCanServe, getBraveApiKey, BraveHttpError, type BraveRateLimits } from './brave';
import type { SearchProvider, SearchQuota } from './tavily-ledger';

export type { SearchProvider };
export type WebSearchResult = TavilySearchResult;
export interface WebSearchResponse extends TavilySearchResponse {
  /** Which provider answered. */
  provider: SearchProvider;
}

export interface WebSearchOptions {
  /** What is searching, for the ledger — see `TavilyCall.purpose`. */
  purpose: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeAnswer?: boolean;
  topic?: 'general' | 'news';
  days?: number;
  excludeDomains?: string[];
  /**
   * Restrict results to these domains. Used only by an `exclusive` research
   * scope — a `bounded` scope expresses its preference through ranking so a
   * thin allow-list cannot starve the run. See `$lib/deepdive/scope`.
   */
  includeDomains?: string[];
  signal?: AbortSignal;
  /** Ask this provider only, with the usual one retry. Unset: the balancer chooses. */
  provider?: SearchProvider;
}

/** Which providers have a key. Read per search: either key can change at runtime. */
export type ProviderKeys = Record<SearchProvider, boolean>;

/**
 * What each provider is assumed to have left before it has said. Tavily's
 * figure comes from its usage endpoint within a minute of the first search;
 * Brave's from the headers on its first response.
 */
const DEFAULT_REMAINING: Record<SearchProvider, number> = { tavily: 1_000, brave: 2_000 };
const RETRY_DELAY_MS = 2_000;
/** Rest after a refused key, a server error or a dropped connection. */
const SHORT_REST_MS = 5 * 60_000;
/** Rest after a plan-limit refusal that gives no reset time. */
const LIMIT_REST_MS = 60 * 60_000;
/** Never rest longer than a month, whatever a header claims. */
const MAX_REST_MS = 31 * 86_400_000;

interface State {
  restUntil: Record<SearchProvider, number>;
  restReason: Record<SearchProvider, string | null>;
  brave: { monthly: SearchQuota | null; monthlyAt: number | null; burstLimit: number; burstWindowMs: number; sent: number[] };
  served: Record<SearchProvider, number>;
  lastError: Record<SearchProvider, string | null>;
}

function freshState(): State {
  return {
    restUntil: { tavily: 0, brave: 0 },
    restReason: { tavily: null, brave: null },
    // One a second until Brave's headers say otherwise.
    brave: { monthly: null, monthlyAt: null, burstLimit: 1, burstWindowMs: 1_000, sent: [] },
    served: { tavily: 0, brave: 0 },
    lastError: { tavily: null, brave: null },
  };
}

let state = freshState();
let random: () => number = Math.random;

/** Test seam — forgets rests, quotas and counts, and fixes the dice if given. */
export function resetSearchBalancer(rng: () => number = Math.random): void {
  state = freshState();
  random = rng;
}

export async function providerKeys(): Promise<ProviderKeys> {
  return { tavily: !!loadKeys().tavilyApiKey, brave: !!(await getBraveApiKey()) };
}

/**
 * Brave's last reported allowance, or null once its reset time has passed: a
 * "0 left" read on the 28th must not keep Brave unchosen through the next
 * month, when nothing but a Brave request would ever replace it.
 */
function braveMonthly(now: number): SearchQuota | null {
  const { monthly, monthlyAt } = state.brave;
  if (!monthly || monthlyAt === null) return null;
  if (monthly.resetSeconds !== null && now >= monthlyAt + monthly.resetSeconds * 1_000) {
    state.brave.monthly = null;
    state.brave.monthlyAt = null;
    return null;
  }
  return monthly;
}

/** Searches each provider can still make this month, as best known now. */
export function remainingSearches(depth: 'basic' | 'advanced' = 'basic', now = Date.now()): Record<SearchProvider, number> {
  const tavily = cachedTavilyAccountUsage();
  const tavilyLeft =
    tavily && tavily.limit !== null ? Math.max(0, tavily.limit - tavily.used) / searchCredits(depth) : DEFAULT_REMAINING.tavily;
  const brave = braveMonthly(now)?.remaining;
  return { tavily: tavilyLeft, brave: typeof brave === 'number' ? Math.max(0, brave) : DEFAULT_REMAINING.brave };
}

/**
 * When the next Brave request may go out. `sent` holds past sends and the
 * future slots already reserved, so a queue of waiting searches each get a
 * later slot rather than all the same one.
 */
function braveSlotAt(now: number): number {
  const { burstLimit, burstWindowMs } = state.brave;
  state.brave.sent = state.brave.sent.filter((t) => now - t < burstWindowMs).sort((a, b) => a - b);
  const sent = state.brave.sent;
  if (sent.length < burstLimit) return now;
  return Math.max(now, sent[sent.length - burstLimit] + burstWindowMs);
}

/** Milliseconds until Brave's burst window has room for another request. */
function braveBurstWait(now: number): number {
  return braveSlotAt(now) - now;
}

/**
 * The providers to try, in order. Exported for the tests and the admin page;
 * `search` is the only caller that acts on it.
 */
export function chooseProviders(
  query: string,
  options: Omit<WebSearchOptions, 'purpose' | 'signal'>,
  keys: ProviderKeys,
  now = Date.now(),
): SearchProvider[] {
  if (options.provider) return keys[options.provider] ? [options.provider] : [];
  const braveFits = braveCanServe(query, options);
  const usable = (p: SearchProvider) => keys[p] && (p === 'tavily' || braveFits);
  const rested = (p: SearchProvider) => state.restUntil[p] > now;

  const candidates = (['tavily', 'brave'] as const).filter(usable);
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return candidates;

  const awake = candidates.filter((p) => !rested(p));
  // Both resting: try them anyway, soonest awake first, rather than refuse.
  if (awake.length === 0) return [...candidates].sort((a, b) => state.restUntil[a] - state.restUntil[b]);
  if (awake.length === 1) return [awake[0], ...candidates.filter((p) => p !== awake[0])];

  if (options.includeAnswer || options.searchDepth === 'advanced') return ['tavily', 'brave'];
  if (braveBurstWait(now) > 0) return ['tavily', 'brave'];

  const left = remainingSearches(options.searchDepth, now);
  const total = left.tavily + left.brave;
  // Both spent by their own account: let Brave answer first (its refusal is
  // cheap and carries a reset time), and Tavily after it.
  if (total <= 0) return ['brave', 'tavily'];
  return random() < left.brave / total ? ['brave', 'tavily'] : ['tavily', 'brave'];
}

function rest(provider: SearchProvider, ms: number, reason: string, now = Date.now()): void {
  state.restUntil[provider] = Math.max(state.restUntil[provider], now + Math.min(ms, MAX_REST_MS));
  state.restReason[provider] = reason;
}

function noteBraveLimits(limits: BraveRateLimits, now: number): void {
  if (limits.monthly) {
    state.brave.monthly = limits.monthly;
    state.brave.monthlyAt = now;
  }
  if (limits.perWindow && limits.perWindow.limit > 0) {
    state.brave.burstLimit = limits.perWindow.limit;
    state.brave.burstWindowMs = Math.max(1, limits.perWindow.windowSeconds) * 1_000;
  }
}

/** Why a request failed, turned into how long its provider should rest. */
function noteFailure(provider: SearchProvider, err: unknown, now = Date.now()): void {
  state.lastError[provider] = err instanceof Error ? err.message.slice(0, 200) : String(err);
  if (err instanceof BraveHttpError) {
    noteBraveLimits(err.limits, now);
    if (err.status === 429) {
      const monthly = err.limits.monthly;
      if (monthly?.remaining === 0) {
        rest('brave', (monthly.resetSeconds ?? LIMIT_REST_MS / 1_000) * 1_000, 'monthly allowance spent', now);
      } else {
        // Burst limit: the window is a second long, so step aside for one.
        rest('brave', state.brave.burstWindowMs, 'rate limited', now);
      }
      return;
    }
    if (err.status === 402) return rest('brave', LIMIT_REST_MS, 'plan refused the request', now);
    if (err.status === 401 || err.status === 403) return rest('brave', SHORT_REST_MS, 'key refused', now);
    if (err.status >= 500) return rest('brave', SHORT_REST_MS, `server error ${err.status}`, now);
    return;
  }
  if (err instanceof TavilyHttpError) {
    // 432 and 433 are Tavily's plan and pay-as-you-go limits.
    if (err.status === 432 || err.status === 433) return rest('tavily', LIMIT_REST_MS, 'plan limit reached', now);
    if (err.status === 429) return rest('tavily', 60_000, 'rate limited', now);
    if (err.status === 401 || err.status === 403) return rest('tavily', SHORT_REST_MS, 'key refused', now);
    if (err.status >= 500) return rest('tavily', SHORT_REST_MS, `server error ${err.status}`, now);
    return;
  }
  // No response at all — a timeout or a dropped connection.
  rest(provider, SHORT_REST_MS / 5, 'no response', now);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(provider: SearchProvider, query: string, options: WebSearchOptions, attempt: number): Promise<WebSearchResponse> {
  if (provider === 'tavily') {
    const res = await tavilySearch(query, { ...options, attempt });
    return { ...res, provider };
  }
  // Reserve the slot before waiting for it, so the next search queues behind.
  const now = Date.now();
  const slot = braveSlotAt(now);
  state.brave.sent.push(slot);
  if (slot > now) await sleep(slot - now);
  const { limits, ...res } = await braveSearch(query, { ...options, attempt });
  noteBraveLimits(limits, Date.now());
  countBraveSearch();
  return { ...res, provider };
}

export async function search(query: string, options: WebSearchOptions): Promise<WebSearchResponse> {
  // Keeps Tavily's remaining figure fresh for the next choice. Memoised for a
  // minute and never throws.
  void tavilyAccountUsage();

  const keys = await providerKeys();
  const order = chooseProviders(query, options, keys);
  if (order.length === 0) {
    if (options.provider) throw new Error(`${options.provider === 'brave' ? 'Brave Search' : 'Tavily'} API key not configured`);
    if (!keys.tavily && !keys.brave) throw new Error('No web search provider configured (set a Tavily or Brave Search API key)');
    // Only Brave has a key, and Brave cannot take this one.
    throw new Error('This search is too long for Brave Search (400 characters, 50 words, 6 domains) and no Tavily key is configured');
  }
  // One provider: try it twice, as search always did.
  const attempts = order.length === 1 ? [order[0], order[0]] : order;

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const provider = attempts[i];
    if (i > 0 && provider === attempts[i - 1]) await sleep(RETRY_DELAY_MS);
    try {
      const res = await ask(provider, query, options, i + 1);
      state.served[provider]++;
      return res;
    } catch (err) {
      if (options.signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
      lastErr = err;
      noteFailure(provider, err);
      if (i < attempts.length - 1) {
        console.error(`[search] ${provider} search("${query.slice(0, 50)}") failed, trying ${attempts[i + 1]}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  throw lastErr;
}

/** What the balancer knows right now, for /admin/ops/tavily. Process-local. */
export interface SearchBalancerStatus {
  configured: Record<SearchProvider, boolean>;
  remaining: Record<SearchProvider, number>;
  /** Whether each remaining figure was reported by the provider or is the default guess. */
  reported: Record<SearchProvider, boolean>;
  /** Share of basic searches each provider is drawing now, 0–1. */
  share: Record<SearchProvider, number>;
  restingUntil: Record<SearchProvider, string | null>;
  restReason: Record<SearchProvider, string | null>;
  braveQuota: (SearchQuota & { at: string | null }) | null;
  braveBurst: { limit: number; windowSeconds: number };
  servedSinceStart: Record<SearchProvider, number>;
  lastError: Record<SearchProvider, string | null>;
}

export async function searchBalancerStatus(now = Date.now()): Promise<SearchBalancerStatus> {
  const keys = await providerKeys();
  const left = remainingSearches('basic', now);
  const monthly = braveMonthly(now);
  const live = {
    tavily: keys.tavily ? left.tavily : 0,
    brave: keys.brave ? left.brave : 0,
  };
  const total = live.tavily + live.brave;
  const share = total > 0
    ? { tavily: live.tavily / total, brave: live.brave / total }
    : { tavily: keys.tavily ? 1 : 0, brave: keys.tavily ? 0 : keys.brave ? 1 : 0 };
  const tavilyUsage = cachedTavilyAccountUsage();
  const until = (p: SearchProvider) => (state.restUntil[p] > now ? new Date(state.restUntil[p]).toISOString() : null);
  return {
    configured: keys,
    remaining: left,
    reported: { tavily: !!tavilyUsage && tavilyUsage.limit !== null, brave: monthly?.remaining != null },
    share,
    restingUntil: { tavily: until('tavily'), brave: until('brave') },
    restReason: { tavily: until('tavily') ? state.restReason.tavily : null, brave: until('brave') ? state.restReason.brave : null },
    braveQuota: monthly
      ? { ...monthly, at: state.brave.monthlyAt ? new Date(state.brave.monthlyAt).toISOString() : null }
      : null,
    braveBurst: { limit: state.brave.burstLimit, windowSeconds: state.brave.burstWindowMs / 1_000 },
    servedSinceStart: { ...state.served },
    lastError: { ...state.lastError },
  };
}
