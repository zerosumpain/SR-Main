// src/lib/curate/discovery/web.ts
//
// Web search + fetch wrappers for the curate discovery toolkit.
// Wraps Tavily (the project-standard search/extract provider).
// Light per-session in-process cache prevents identical queries double-billing.

import { search, extract } from '$lib/deepdive/tavily';

// ── Types ────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchResult {
  status: 'ok' | 'error';
  contentType: string;
  text: string;
}

// ── Per-session caches ───────────────────────────────────────────────────
//
// Stored as module-level Maps so callers within the same Node.js process
// share results for the lifetime of a session. Safe for concurrent use
// because JS is single-threaded — no locks required.

const searchCache = new Map<string, SearchResult[]>();
const fetchCache = new Map<string, FetchResult>();

/** Reset caches (call between sessions in tests or when starting fresh). */
export function clearWebCaches(): void {
  searchCache.clear();
  fetchCache.clear();
}

// ── webSearch ─────────────────────────────────────────────────────────────

/**
 * Search the web for the given query.
 * Identical queries within the same process lifetime return the cached result.
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
  const cached = searchCache.get(query);
  if (cached) return cached;

  const resp = await search(query, { maxResults: 8, searchDepth: 'basic' });

  const results: SearchResult[] = resp.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content.slice(0, 400),
  }));

  searchCache.set(query, results);
  return results;
}

// ── webFetch ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch a URL and return its text content.
 * Uses Tavily's extract API for clean text from HTML pages.
 * Falls back to a raw `fetch()` for non-HTML resources (JSON, plain text).
 */
export async function webFetch(url: string): Promise<FetchResult> {
  const cached = fetchCache.get(url);
  if (cached) return cached;

  let result: FetchResult;

  try {
    // Tavily extract gives clean, reader-mode text from HTML — best for docs.
    const resp = await extract([url]);

    if (resp.results.length > 0) {
      const raw = resp.results[0].raw_content;
      result = {
        status: 'ok',
        contentType: 'text/html',
        text: raw.slice(0, 60_000),
      };
    } else {
      // Tavily returned a failure — fall back to raw fetch.
      result = await rawFetch(url);
    }
  } catch {
    // Tavily unavailable or rate-limited — fall back to raw fetch.
    result = await rawFetch(url);
  }

  fetchCache.set(url, result);
  return result;
}

async function rawFetch(url: string): Promise<FetchResult> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CurateBot/1.0)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
    const text = await resp.text();

    return {
      status: resp.ok ? 'ok' : 'error',
      contentType,
      text: text.slice(0, 60_000),
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      contentType: 'text/plain',
      text: err instanceof Error ? err.message : String(err),
    };
  }
}
