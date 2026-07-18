// src/routes/api/deepdive/[id]/source-summary/+server.ts
//
// POST /api/deepdive/[id]/source-summary
// Body: { sourceId: string }
//
// Returns: { summary: string, method: 'tavily'|'residential'|'none', cached?: true }
//   method — how the summary was built:
//     'tavily'      — live page text fetched via Tavily Extract
//     'residential' — live page text fetched via homeserv residential Chromium
//     'none'        — fell back to stored facts/snippet (original behaviour)
//
// In-memory cache keyed `${sessionId}:${sourceId}` with a 30-min TTL.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources, facts } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { chatCompletion } from '$lib/deepdive/ai';
import { buildSourceSummaryPrompt, buildPageTextSummaryPrompt } from '$lib/deepdive/source-summary-prompt';
import { fetchPageText } from '$lib/deepdive/fetch-page-text';
import type { FetchPageTextMethod } from '$lib/deepdive/fetch-page-text';

// ——— in-memory cache ———
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  summary: string;
  method: FetchPageTextMethod;
  expiresAt: number;
}

const summaryCache = new Map<string, CacheEntry>();

function cacheKey(sessionId: string, sourceId: string): string {
  return `${sessionId}:${sourceId}`;
}

function getCached(sessionId: string, sourceId: string): CacheEntry | null {
  const entry = summaryCache.get(cacheKey(sessionId, sourceId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    summaryCache.delete(cacheKey(sessionId, sourceId));
    return null;
  }
  return entry;
}

function setCached(sessionId: string, sourceId: string, summary: string, method: FetchPageTextMethod): void {
  summaryCache.set(cacheKey(sessionId, sourceId), {
    summary,
    method,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id;

  // Parse body
  let body: { sourceId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sourceId = body?.sourceId;
  if (!sourceId || typeof sourceId !== 'string') {
    return json({ error: 'sourceId is required' }, { status: 400 });
  }

  // Verify session exists
  const [session] = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  // Cache hit?
  const cached = getCached(sessionId, sourceId);
  if (cached) {
    return json({ summary: cached.summary, method: cached.method, cached: true });
  }

  // Load the source row (must belong to this session)
  const [source] = await db
    .select({
      id: sources.id,
      url: sources.url,
      title: sources.title,
      snippet: sources.snippet,
      domain: sources.domain,
    })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.sessionId, sessionId)))
    .limit(1);

  if (!source) {
    return json({ error: 'Source not found in this session' }, { status: 404 });
  }

  // ── Fetch live page text (primary path) ──────────────────────────────────
  // Use the caller's request signal so the fetch is cancelled if the client
  // disconnects, but only for Tavily — the residential path has its own hard
  // 30s timeout inside fetchPageText.
  const pageTextResult = await fetchPageText(source.url, { signal: request.signal });

  // ── Build prompt ─────────────────────────────────────────────────────────
  let system: string;
  let user: string;

  if (pageTextResult.method !== 'none') {
    // Good live text — summarise the real page content
    ({ system, user } = buildPageTextSummaryPrompt(source, pageTextResult.text));
  } else {
    // No live text — fall back to stored facts + snippet (original behaviour)
    const sourceFacts = await db
      .select({ id: facts.id, content: facts.content })
      .from(facts)
      .where(and(eq(facts.sourceId, sourceId), eq(facts.sessionId, sessionId)))
      .limit(30);
    ({ system, user } = buildSourceSummaryPrompt(source, sourceFacts));
  }

  // ── LLM call ─────────────────────────────────────────────────────────────
  let summary: string;
  try {
    // maxTokens must be generous: the default model is a GLM model, which spends
    // reasoning tokens out of max_tokens — a small cap (e.g. 256) gets entirely
    // consumed by reasoning and returns EMPTY content ("No summary could be
    // generated"). ≥3000 leaves room for reasoning + the short summary.
    summary = await chatCompletion(system, user, { maxTokens: 3072, temperature: 0.4 });
    summary = summary.trim();
    if (!summary) {
      summary = 'No summary could be generated for this source.';
    }
  } catch (err) {
    console.error('[source-summary] LLM error:', err);
    return json({ error: 'Summary generation failed' }, { status: 502 });
  }

  // Cache + return (cache includes the method so cache hits keep it consistent)
  const method = pageTextResult.method;
  setCached(sessionId, sourceId, summary, method);
  return json({ summary, method });
};
