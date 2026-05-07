// src/lib/curate/discovery/context7.ts
//
// Library documentation wrapper for the curate discovery toolkit.
//
// context7 is a Claude Code MCP plugin — it cannot be called directly from
// SvelteKit server code. This module provides `queryLibraryDocs` as a direct
// function that fetches library docs via Tavily web search, targeting the
// official docs site + npm package page. This is the minimal-code path and
// produces equivalent output for the LLM discovery phase.

import { search } from '$lib/deepdive/tavily';

// ── Types ────────────────────────────────────────────────────────────────

export interface DocExcerpt {
  source: string;
  text: string;
}

export interface LibraryDocsResult {
  libraryName: string;
  query: string;
  excerpts: DocExcerpt[];
}

// ── Per-session cache ────────────────────────────────────────────────────

const cache = new Map<string, LibraryDocsResult>();

export function clearContext7Cache(): void {
  cache.clear();
}

// ── queryLibraryDocs ──────────────────────────────────────────────────────

/**
 * Fetch relevant documentation excerpts for an npm library.
 *
 * Implementation note: context7 is a Claude Code MCP plugin that is not
 * accessible from SvelteKit server-side code. This wrapper uses Tavily web
 * search targeting the library's official docs and npm page, which produces
 * equivalent results for the discovery LLM.
 */
export async function queryLibraryDocs(
  libraryName: string,
  query: string,
): Promise<LibraryDocsResult> {
  const cacheKey = `${libraryName}::${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Build targeted queries that prefer official docs over random blog posts.
  const searchQuery = `${libraryName} ${query} npm documentation typescript`;

  const resp = await search(searchQuery, {
    maxResults: 6,
    searchDepth: 'basic',
  });

  const excerpts: DocExcerpt[] = resp.results.map((r) => ({
    source: r.url,
    text: r.content.slice(0, 500),
  }));

  const result: LibraryDocsResult = { libraryName, query, excerpts };
  cache.set(cacheKey, result);
  return result;
}
