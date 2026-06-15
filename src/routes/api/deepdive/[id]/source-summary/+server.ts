// src/routes/api/deepdive/[id]/source-summary/+server.ts
//
// POST /api/deepdive/[id]/source-summary
// Body: { sourceId: string }
//
// Returns: { summary: string } — a 2-4 sentence "what this page says"
// built from already-gathered facts + source title/snippet (no live fetch).
//
// In-memory cache keyed `${sessionId}:${sourceId}` with a 30-min TTL.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources, facts } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { chatCompletion } from '$lib/deepdive/ai';
import { buildSourceSummaryPrompt } from '$lib/deepdive/source-summary-prompt';

// ——— in-memory cache ———
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  summary: string;
  expiresAt: number;
}

const summaryCache = new Map<string, CacheEntry>();

function cacheKey(sessionId: string, sourceId: string): string {
  return `${sessionId}:${sourceId}`;
}

function getCached(sessionId: string, sourceId: string): string | null {
  const entry = summaryCache.get(cacheKey(sessionId, sourceId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    summaryCache.delete(cacheKey(sessionId, sourceId));
    return null;
  }
  return entry.summary;
}

function setCached(sessionId: string, sourceId: string, summary: string): void {
  summaryCache.set(cacheKey(sessionId, sourceId), {
    summary,
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
    return json({ summary: cached, cached: true });
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

  // Load facts for this source (content only, up to 30 to keep prompts bounded)
  const sourceFacts = await db
    .select({ id: facts.id, content: facts.content })
    .from(facts)
    .where(and(eq(facts.sourceId, sourceId), eq(facts.sessionId, sessionId)))
    .limit(30);

  // Build prompt and call LLM
  const { system, user } = buildSourceSummaryPrompt(source, sourceFacts);

  let summary: string;
  try {
    summary = await chatCompletion(system, user, { maxTokens: 256, temperature: 0.4 });
    summary = summary.trim();
    if (!summary) {
      summary = 'No summary could be generated for this source.';
    }
  } catch (err) {
    console.error('[source-summary] LLM error:', err);
    return json({ error: 'Summary generation failed' }, { status: 502 });
  }

  // Cache + return
  setCached(sessionId, sourceId, summary);
  return json({ summary });
};
