/**
 * Brave Search, the second provider behind the search balancer.
 *
 * Not called directly: every search on the site goes through `search()` in
 * `./web-search`, which picks Brave or Tavily per request. This file makes one
 * Brave request and hands back the same shape Tavily does, so no caller has to
 * know which provider answered.
 *
 * What does not translate, and how it is handled:
 * - Brave returns no relevance score. Results arrive ranked, so the score is
 *   made from the rank, in the band Tavily's own scores sit in — credibility
 *   scoring reads `score` and would otherwise treat every Brave hit alike.
 * - Brave has no `include_domains`. A short allow-list becomes `site:` terms
 *   in the query; the results are filtered to the list afterwards as well,
 *   because an operator is a hint the index may not honour. Exclusions are
 *   filtered afterwards only, from a slightly larger page.
 * - Brave writes no answer. A caller that asks for one is sent to Tavily by
 *   the balancer while Tavily can take it.
 * - `days` maps to Brave's coarse `freshness` buckets (24h, week, month,
 *   year), for news only — Tavily honours `days` only on news, and a general
 *   search must not come back narrower because Brave answered it.
 *
 * Every request is written to the same ledger as Tavily's
 * (`./tavily-ledger`, `action_type = 'brave_call'`), carrying the allowance
 * Brave's rate-limit headers reported on that response.
 *
 * The key lives in the `brave.api_key` app setting (saved from
 * /admin/ai/keys), falling back to `BRAVE_SEARCH_API_KEY` in the environment —
 * not in keys.json, which is not backed up and has been overwritten twice, and
 * not in `$lib/llm/keys`, which five extracted apps hold byte for byte. The
 * database is shared with SR-Workflows, so one saved key serves both apps.
 */
import { env as dynamicEnv } from '$env/dynamic/private';
import { getSetting } from '$lib/server/models/settings';
import { recordTavilyCall, type SearchQuota } from './tavily-ledger';
import type { TavilySearchResponse, TavilySearchResult } from './tavily';

export const BRAVE_KEY_SETTING = 'brave.api_key';

/**
 * The Brave key: the app setting first, then the environment. Undefined when
 * neither has one. The setting is read through `getSetting`'s 30-second cache,
 * and a host with no database (a script, a test) still gets the environment.
 */
export async function getBraveApiKey(): Promise<string | undefined> {
  try {
    const v = await getSetting<{ value?: string }>(BRAVE_KEY_SETTING);
    if (v?.value) return v.value;
  } catch {
    // No database here, or it is down. Fall through to the environment.
  }
  return dynamicEnv.BRAVE_SEARCH_API_KEY || process.env.BRAVE_SEARCH_API_KEY || undefined;
}

const BRAVE_BASE = 'https://api.search.brave.com/res/v1';
const BRAVE_TIMEOUT_MS = 15_000;
/** Brave's per-request page cap for web results. */
export const BRAVE_MAX_COUNT = 20;
/** Brave rejects longer queries; the balancer sends those to Tavily. */
export const BRAVE_MAX_QUERY_CHARS = 400;
export const BRAVE_MAX_QUERY_WORDS = 50;
/** More `site:` terms than this and the query is no longer the question asked. */
export const BRAVE_MAX_SITE_TERMS = 6;

export interface BraveSearchOptions {
  purpose: string;
  maxResults?: number;
  topic?: 'general' | 'news';
  days?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  signal?: AbortSignal;
  attempt?: number;
}

/**
 * The two windows Brave reports on every response: a short burst limit
 * (requests per second on most plans) and the plan's monthly allowance.
 */
export interface BraveRateLimits {
  perWindow: { limit: number; remaining: number; windowSeconds: number } | null;
  monthly: SearchQuota | null;
}

/** The status and reported allowance a failed request carried. */
export class BraveHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly limits: BraveRateLimits,
  ) {
    super(message);
  }
}

const list = (value: string | null): number[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number)
    .filter((v) => Number.isFinite(v));

/**
 * Read Brave's `X-RateLimit-*` headers. Each holds one comma-separated value
 * per window (`"1, 15000"`), and `X-RateLimit-Policy` names the windows
 * (`"1;w=1, 15000;w=2592000"`). The shortest window is the burst limit and the
 * longest the monthly allowance. Missing or malformed headers give nulls, and
 * the balancer falls back to its defaults.
 */
export function parseBraveRateLimits(headers: Headers): BraveRateLimits {
  const limits = list(headers.get('x-ratelimit-limit'));
  const remaining = list(headers.get('x-ratelimit-remaining'));
  const reset = list(headers.get('x-ratelimit-reset'));
  if (!limits.length || limits.length !== remaining.length) return { perWindow: null, monthly: null };

  const windows = (headers.get('x-ratelimit-policy') ?? '')
    .split(',')
    .map((part) => Number(/w=(\d+)/.exec(part)?.[1]));
  const windowOf = (i: number) => (Number.isFinite(windows[i]) ? windows[i] : null);

  const entries = limits.map((limit, i) => ({ limit, remaining: remaining[i], reset: reset[i] ?? null, window: windowOf(i) }));
  // Without a policy header, Brave's documented order is shortest first.
  const sorted = entries.every((e) => e.window !== null)
    ? [...entries].sort((a, b) => (a.window as number) - (b.window as number))
    : entries;
  const short = sorted.length > 1 ? sorted[0] : null;
  const long = sorted[sorted.length - 1];
  return {
    perWindow: short ? { limit: short.limit, remaining: short.remaining, windowSeconds: short.window ?? 1 } : null,
    monthly: { limit: long.limit, remaining: long.remaining, resetSeconds: long.reset },
  };
}

/** Whether Brave can be asked this exact question, before spending a request on it. */
export function braveCanServe(query: string, options: { includeDomains?: string[] } = {}): boolean {
  const q = braveQuery(query, options.includeDomains);
  return q.length <= BRAVE_MAX_QUERY_CHARS && q.split(/\s+/).filter(Boolean).length <= BRAVE_MAX_QUERY_WORDS
    && (options.includeDomains?.length ?? 0) <= BRAVE_MAX_SITE_TERMS;
}

function braveQuery(query: string, includeDomains?: string[]): string {
  if (!includeDomains?.length) return query.trim();
  const sites = includeDomains.map((d) => `site:${d}`).join(' OR ');
  return `${query.trim()} (${sites})`;
}

function freshness(days: number | undefined): string | null {
  if (!days || days <= 0) return null;
  if (days <= 1) return 'pd';
  if (days <= 7) return 'pw';
  if (days <= 31) return 'pm';
  return 'py';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function plain(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when `host` is `domain` or one of its subdomains. */
function onDomain(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/** Rank to a Tavily-like score: first result 0.9, falling 0.04 a place, never below 0.3. */
export function rankScore(index: number): number {
  return Math.max(0.3, Math.round((0.9 - index * 0.04) * 100) / 100);
}

interface BraveRawResult {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
}

/** Brave's results in Tavily's shape, filtered to the domains the caller allowed. */
export function normaliseBraveResults(
  raw: BraveRawResult[],
  options: { maxResults: number; includeDomains?: string[]; excludeDomains?: string[] },
): TavilySearchResult[] {
  const out: TavilySearchResult[] = [];
  for (const r of raw) {
    if (!r?.url) continue;
    const host = hostOf(r.url);
    if (!host) continue;
    if (options.excludeDomains?.some((d) => onDomain(host, d))) continue;
    if (options.includeDomains?.length && !options.includeDomains.some((d) => onDomain(host, d))) continue;
    const content = [plain(r.description), ...(r.extra_snippets ?? []).map(plain)].filter(Boolean).join(' … ');
    out.push({ title: plain(r.title) || r.url, url: r.url, content, score: rankScore(out.length) });
    if (out.length >= options.maxResults) break;
  }
  return out;
}

/** One Brave request, ledgered whatever happens to it. */
export async function braveSearch(
  query: string,
  options: BraveSearchOptions,
): Promise<TavilySearchResponse & { limits: BraveRateLimits }> {
  const apiKey = await getBraveApiKey();
  if (!apiKey) throw new Error('Brave Search API key not configured');
  const maxResults = Math.max(1, Math.min(options.maxResults ?? 10, BRAVE_MAX_COUNT));
  const news = options.topic === 'news';
  // Room for the results an exclusion will drop.
  const count = Math.min(BRAVE_MAX_COUNT, maxResults + (options.excludeDomains?.length ? 5 : 0));

  const params = new URLSearchParams({ q: braveQuery(query, options.includeDomains), count: String(count) });
  if (!news) {
    params.set('extra_snippets', 'true');
    params.set('text_decorations', 'false');
  }
  const fresh = news ? freshness(options.days) : null;
  if (fresh) params.set('freshness', fresh);

  const requestOptions: Record<string, unknown> = { maxResults };
  if (options.topic) requestOptions.topic = options.topic;
  if (options.days) requestOptions.days = options.days;
  if (options.includeDomains?.length) requestOptions.includeDomains = options.includeDomains;
  if (options.excludeDomains?.length) requestOptions.excludeDomains = options.excludeDomains;

  const call = {
    provider: 'brave' as const,
    kind: 'search' as const,
    purpose: options.purpose,
    depth: 'basic' as const,
    query,
    options: requestOptions,
    credits: 1,
    attempt: options.attempt ?? 1,
  };

  const timeout = AbortSignal.timeout(BRAVE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const started = Date.now();
  let limits: BraveRateLimits = { perWindow: null, monthly: null };
  try {
    const res = await fetch(`${BRAVE_BASE}/${news ? 'news' : 'web'}/search?${params}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
      signal,
    });
    limits = parseBraveRateLimits(res.headers);
    if (!res.ok) {
      throw new BraveHttpError(`Brave search failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status, limits);
    }
    const body = (await res.json()) as { web?: { results?: BraveRawResult[] }; results?: BraveRawResult[] };
    const results = normaliseBraveResults((news ? body.results : body.web?.results) ?? [], {
      maxResults,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
    });
    recordTavilyCall({
      ...call,
      ok: true,
      httpStatus: res.status,
      durationMs: Date.now() - started,
      resultCount: results.length,
      quota: limits.monthly,
    });
    return { results, limits };
  } catch (err) {
    recordTavilyCall({
      ...call,
      ok: false,
      httpStatus: err instanceof BraveHttpError ? err.status : null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
      quota: limits.monthly,
    });
    throw err;
  }
}
