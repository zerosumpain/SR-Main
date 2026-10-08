import { getTavilyKey } from '$lib/llm/keys';
import {
  countTavilySearch,
  countTavilyExtract,
  searchCredits,
  extractCredits,
  type TavilyDepth,
} from '$lib/context/research-meter';
import { recordTavilyCall, type TavilyCall } from './tavily-ledger';

const TAVILY_BASE = 'https://api.tavily.com';
const TAVILY_TIMEOUT_MS = 15_000;

function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  // AbortSignal.any is available in Node 20+
  return AbortSignal.any([external, timeout]);
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, label: string): Promise<T> {
  try {
    return await fn(1);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    console.error(`[deepdive] ${label} failed, retrying once:`, err);
    await new Promise((r) => setTimeout(r, 2000));
    return fn(2);
  }
}

/** The status a failed request carried, when it got as far as a response. */
class TavilyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Make one request and write it to the ledger, whatever happens to it. A
 * refused or timed-out request is recorded too, at zero credits: a burst of
 * failures is itself something worth seeing on /admin/ops/tavily.
 */
async function ledgered<T extends object>(
  call: Omit<TavilyCall, 'ok' | 'durationMs' | 'httpStatus' | 'error' | 'resultCount'>,
  request: () => Promise<Response>,
  label: string,
  count: (body: T) => number,
): Promise<T> {
  const started = Date.now();
  try {
    const res = await request();
    if (!res.ok) {
      throw new TavilyHttpError(`Tavily ${label} failed: ${res.status} ${await res.text()}`, res.status);
    }
    const body = (await res.json()) as T;
    recordTavilyCall({
      ...call,
      ok: true,
      httpStatus: res.status,
      durationMs: Date.now() - started,
      resultCount: count(body),
    });
    return body;
  } catch (err) {
    recordTavilyCall({
      ...call,
      ok: false,
      httpStatus: err instanceof TavilyHttpError ? err.status : null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    });
    throw err;
  }
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  answer?: string;
}

export async function search(
  query: string,
  options: {
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
  },
): Promise<TavilySearchResponse> {
  const apiKey = getTavilyKey();
  const depth: TavilyDepth = options.searchDepth ?? 'basic';
  const requestOptions: Record<string, unknown> = { maxResults: options.maxResults ?? 10 };
  if (options.topic) requestOptions.topic = options.topic;
  if (options.days) requestOptions.days = options.days;
  if (options.includeAnswer) requestOptions.includeAnswer = true;
  if (options.includeDomains?.length) requestOptions.includeDomains = options.includeDomains;
  if (options.excludeDomains?.length) requestOptions.excludeDomains = options.excludeDomains;

  return withRetry(async (attempt) => {
    const response = await ledgered<TavilySearchResponse>(
      { kind: 'search', purpose: options.purpose, depth, query, options: requestOptions, credits: searchCredits(depth), attempt },
      () => fetch(`${TAVILY_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: options.maxResults ?? 10,
          search_depth: depth,
          include_raw_content: false,
          ...(options.includeAnswer ? { include_answer: true } : {}),
          ...(options.topic ? { topic: options.topic } : {}),
          // `days` is only honoured by the Tavily API when topic='news'; sending
          // it otherwise is ignored by the server but harmless.
          ...(options.days && options.days > 0 ? { days: Math.floor(options.days) } : {}),
          ...(options.excludeDomains?.length ? { exclude_domains: options.excludeDomains } : {}),
          ...(options.includeDomains?.length ? { include_domains: options.includeDomains } : {}),
        }),
        signal: combineSignals(options.signal, TAVILY_TIMEOUT_MS),
      }),
      'search',
      (body) => body.results?.length ?? 0,
    );

    // Metered on success only. A refused request is not billed, and the one
    // retry above is a rare enough over- or under-count to be worth less than
    // the simplicity. No-op outside a research run.
    countTavilySearch(depth);
    return response;
  }, `search("${query.slice(0, 50)}")`);
}

export interface TavilyExtractResult {
  url: string;
  raw_content: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results: { url: string; error: string }[];
}

export async function extract(
  urls: string[],
  options: {
    /** What is extracting, for the ledger — see `TavilyCall.purpose`. */
    purpose: string;
    signal?: AbortSignal;
  },
): Promise<TavilyExtractResponse> {
  const apiKey = getTavilyKey();

  return withRetry(async (attempt) => {
    const response = await ledgered<TavilyExtractResponse>(
      { kind: 'extract', purpose: options.purpose, depth: 'basic', urls, credits: extractCredits(urls.length), attempt },
      () => fetch(`${TAVILY_BASE}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          urls,
        }),
        signal: combineSignals(options.signal, TAVILY_TIMEOUT_MS),
      }),
      'extract',
      (body) => body.results?.length ?? 0,
    );

    countTavilyExtract(urls.length);
    return response;
  }, `extract(${urls.length} urls)`);
}
