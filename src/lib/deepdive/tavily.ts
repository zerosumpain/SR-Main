import { getTavilyKey } from './keys';

const TAVILY_BASE = 'https://api.tavily.com';

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    console.error(`[deepdive] ${label} failed, retrying once:`, err);
    await new Promise((r) => setTimeout(r, 2000));
    return fn();
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
  options?: { maxResults?: number; searchDepth?: 'basic' | 'advanced'; includeAnswer?: boolean; signal?: AbortSignal },
): Promise<TavilySearchResponse> {
  const apiKey = getTavilyKey();

  return withRetry(async () => {
    const res = await fetch(`${TAVILY_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: options?.maxResults ?? 10,
        search_depth: options?.searchDepth ?? 'basic',
        include_raw_content: false,
        ...(options?.includeAnswer ? { include_answer: true } : {}),
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
    }

    return res.json();
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

export async function extract(urls: string[], signal?: AbortSignal): Promise<TavilyExtractResponse> {
  const apiKey = getTavilyKey();

  return withRetry(async () => {
    const res = await fetch(`${TAVILY_BASE}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        urls,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Tavily extract failed: ${res.status} ${await res.text()}`);
    }

    return res.json();
  }, `extract(${urls.length} urls)`);
}
