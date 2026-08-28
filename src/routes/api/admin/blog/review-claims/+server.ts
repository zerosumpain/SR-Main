import type { RequestHandler } from './$types';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { search as tavilySearch } from '$lib/deepdive/tavily';
import { hostnameOf, isReputable } from '$lib/blog/reputable-domains';
import { plainTextFromHtml } from '$lib/blog/readability';

const MAX_CLAIMS = 12;
const TAVILY_RESULTS_PER_CLAIM = 8;
const MAX_CANDIDATES_RETURNED = 4;
const SEARCH_CONCURRENCY = 3;

interface ClaimSeed {
  claim: string;
  snippet: string;
  searchQuery: string;
}

interface RankedCandidate {
  url: string;
  title: string;
  domain: string;
  reputable: boolean;
  why: string;
  score: number;
}

const EXTRACT_SYSTEM = `You review a blog post and extract factual, falsifiable CLAIMS that should be sourced.

A claim is something that:
- States a fact about the world (numbers, events, attributions, scientific or historical statements)
- Could in principle be checked against an external source
- Is NOT the author's opinion, preference, anecdote, or rhetorical flourish

For each claim return:
- "claim": a one-sentence restatement of the factual assertion
- "snippet": the exact substring from the post (verbatim, ≤180 chars) that contains the claim — used to locate it for citation
- "searchQuery": a concise web search query (≤12 words) — use specific entity names, dates, and key terms that would appear in news headlines or official documents

Return AT MOST ${MAX_CLAIMS} claims, the most important / load-bearing ones. If the post contains no factual claims, return an empty array.

Respond with VALID JSON ONLY, matching this shape:
{"claims": [{"claim": "...", "snippet": "...", "searchQuery": "..."}]}`;

function safeJSON<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(cleaned.slice(a, b + 1)) as T; } catch { return null; }
    }
    return null;
  }
}

async function extractClaims(plain: string): Promise<ClaimSeed[]> {
  const { client, model } = await getLLMClient(await resolveDefaultModel());
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `BLOG POST:\n\n${plain}` },
    ],
    temperature: 0.2,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
  });
  const raw = res.choices[0]?.message?.content ?? '';
  const parsed = safeJSON<{ claims: ClaimSeed[] }>(raw);
  const claims = parsed?.claims ?? [];
  return claims
    .filter((c) => c && typeof c.claim === 'string' && typeof c.snippet === 'string' && typeof c.searchQuery === 'string')
    .slice(0, MAX_CLAIMS);
}

function trimWhy(content: string, max = 220): string {
  if (!content) return '';
  const stripped = content.replace(/\s+/g, ' ').trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

function pickCandidates(results: { url: string; title: string; content: string; score: number }[]): RankedCandidate[] {
  // Score = Tavily relevance, with a +1 bonus if the domain is reputable.
  // Returns up to MAX_CANDIDATES_RETURNED, prioritising reputable ones.
  const scored = results
    .filter((r) => r && r.url)
    .map((r) => {
      const reputable = isReputable(r.url);
      return {
        url: r.url,
        title: r.title || hostnameOf(r.url),
        domain: hostnameOf(r.url),
        reputable,
        why: trimWhy(r.content),
        score: (r.score ?? 0) + (reputable ? 1 : 0),
      } satisfies RankedCandidate;
    });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES_RETURNED);
}

export const POST: RequestHandler = async ({ request }) => {
  let body: { html?: string; content?: string; format?: 'html' | 'markdown' };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const raw = body.html ?? body.content ?? '';
  if (!raw || typeof raw !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing content' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const plain = body.format === 'markdown' ? raw : plainTextFromHtml(raw);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        if (plain.trim().length < 40) {
          send({ type: 'done', claims: [], reason: 'too-short' });
          controller.close();
          return;
        }

        send({ type: 'phase', phase: 'extracting', message: 'Reading post and extracting factual claims with the site default model…' });

        let seeds: ClaimSeed[];
        try {
          seeds = await extractClaims(plain);
        } catch (e) {
          send({ type: 'error', error: e instanceof Error ? e.message : 'Claim extraction failed' });
          controller.close();
          return;
        }

        send({ type: 'claims-found', count: seeds.length, seeds });

        if (!seeds.length) {
          send({ type: 'done', claims: [] });
          controller.close();
          return;
        }

        send({ type: 'phase', phase: 'searching', message: `Searching the web for sources (${seeds.length} claim${seeds.length === 1 ? '' : 's'})…` });

        let cursor = 0;
        async function worker() {
          while (cursor < seeds.length) {
            const idx = cursor++;
            const seed = seeds[idx];
            send({ type: 'claim-start', index: idx, query: seed.searchQuery });
            try {
              const search = await tavilySearch(seed.searchQuery, {
                maxResults: TAVILY_RESULTS_PER_CLAIM,
                searchDepth: 'advanced',
              });
              const candidates = pickCandidates(search.results);
              send({
                type: 'claim-done',
                index: idx,
                resultsCount: search.results.length,
                candidates,
              });
            } catch (e) {
              send({
                type: 'claim-done',
                index: idx,
                resultsCount: 0,
                candidates: [],
                error: e instanceof Error ? e.message : 'lookup failed',
              });
            }
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(SEARCH_CONCURRENCY, seeds.length) }, worker),
        );

        send({ type: 'done' });
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'unknown error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
};
