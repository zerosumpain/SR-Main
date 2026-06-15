// src/lib/deepdive/fetch-page-text.ts
//
// Best-effort live page text fetcher for the source-summary endpoint.
//
// Order:
//   1. Tavily Extract (primary — fast, 15s internal timeout via tavily.ts)
//      If raw_content ≥ TAVILY_MIN_CHARS → return immediately.
//   2. Residential scraper via SCRAPER_SERVICE_URL (fallback — Chromium on
//      homeserv residential IP). Hard-bounded at RESIDENTIAL_TIMEOUT_MS.
//      Only attempted when the env var is set.
//   3. If both fail / thin → return { text: '', method: 'none' }.
//
// This function NEVER throws. All errors are swallowed. Callers decide what
// to do with method === 'none'.

import { extract as defaultTavilyExtract } from './tavily';
import type { TavilyExtractResponse } from './tavily';
import type { ScrapeResult } from '$lib/workflows/scraper/types';

const TAVILY_MIN_CHARS = 400;
const RESIDENTIAL_MIN_CHARS = 200;
const RESIDENTIAL_TIMEOUT_MS = 30_000;
const MAX_TEXT_CHARS = 8_000;

export type FetchPageTextMethod = 'tavily' | 'residential' | 'none';

export interface FetchPageTextResult {
  text: string;
  method: FetchPageTextMethod;
}

/**
 * Injectable seams — allows unit tests to mock network calls without
 * touching real env vars or the network.
 */
export interface FetchPageTextDeps {
  tavilyExtract: (urls: string[], signal?: AbortSignal) => Promise<TavilyExtractResponse>;
  fetchFn: typeof fetch;
  scraperServiceUrl: string | undefined;
  scraperServiceToken: string | undefined;
}

function defaultDeps(): FetchPageTextDeps {
  return {
    tavilyExtract: defaultTavilyExtract,
    fetchFn: fetch,
    scraperServiceUrl: process.env.SCRAPER_SERVICE_URL,
    scraperServiceToken: process.env.SCRAPER_SERVICE_TOKEN,
  };
}

/**
 * Fetch readable page text for a URL. Best-effort: always returns a result,
 * never throws. Caps text at 8000 chars so prompts stay bounded.
 */
export async function fetchPageText(
  url: string,
  opts: { signal?: AbortSignal } = {},
  deps?: FetchPageTextDeps,
): Promise<FetchPageTextResult> {
  const { tavilyExtract, fetchFn, scraperServiceUrl, scraperServiceToken } = deps ?? defaultDeps();

  // ── Step 1: Tavily Extract ───────────────────────────────────────────────
  try {
    const tavilyResult = await tavilyExtract([url], opts.signal);
    const rawContent = tavilyResult.results[0]?.raw_content ?? '';
    if (rawContent.length >= TAVILY_MIN_CHARS) {
      return { text: rawContent.slice(0, MAX_TEXT_CHARS), method: 'tavily' };
    }
    // Fall through — content too thin
  } catch {
    // Tavily failed (timeout, network error, 429…) — fall through to residential
  }

  // ── Step 2: Residential scraper (fallback, only if configured) ───────────
  if (scraperServiceUrl) {
    try {
      // Combine caller signal with a hard 30-second timeout
      const timeoutSignal = AbortSignal.timeout(RESIDENTIAL_TIMEOUT_MS);
      const combinedSignal =
        opts.signal
          ? AbortSignal.any([opts.signal, timeoutSignal])
          : timeoutSignal;

      const res = await fetchFn(scraperServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(scraperServiceToken
            ? { Authorization: `Bearer ${scraperServiceToken}` }
            : {}),
        },
        body: JSON.stringify({
          url,
          profile: 'default',
          waitFor: { type: 'networkidle' },
          extract: 'text',
        }),
        signal: combinedSignal,
      });

      if (res.ok) {
        const data = (await res.json()) as ScrapeResult;
        const text: string =
          (data?.pages?.[0]?.fields?.text as string | undefined) ?? '';
        if (data.success && text.length >= RESIDENTIAL_MIN_CHARS) {
          return { text: text.slice(0, MAX_TEXT_CHARS), method: 'residential' };
        }
      }
      // Non-OK or thin content → fall through
    } catch {
      // Timeout (AbortError), network error, JSON parse error — swallow all
    }
  }

  // ── Step 3: Nothing usable ───────────────────────────────────────────────
  return { text: '', method: 'none' };
}
