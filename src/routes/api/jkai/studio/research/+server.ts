import { json, error } from '@sveltejs/kit';
import { verifyBridgeToken } from '$lib/jkai/tool-bridge';
import { searchResearch } from '$lib/deepdive/research-search';
import type { RequestHandler } from './$types';

/**
 * Let a running build ask the research corpus a question.
 *
 * The research brief is assembled once, before planning, and never consulted
 * again. So when the agent reaches chapter 4 and needs the eligibility
 * material, it has whatever survived into the fifteen facts chosen for a
 * whole-project query — and when that is thin, the honest thing it can write
 * is "the record does not establish this". Which is what the IBCA builds kept
 * writing.
 *
 * This is the pull to the brief's push. Called by scripts/studio-research.mjs,
 * which the agent runs via bash — the transport that has never been stripped.
 *
 * Facts only, deliberately: raw source chunks are unreviewed page text, cut
 * mid-sentence, carrying a hardcoded confidence of 0. Fine for a human reading
 * chat, not something to render to a learner as a sourced claim. The brief's
 * own path made the same choice for the same reason.
 */
export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const buildId = verifyBridgeToken(auth.replace(/^Bearer\s+/i, ''));
  if (!buildId) throw error(401, 'invalid token');

  let body: { query?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'expected a JSON body');
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) throw error(400, 'query is required');
  if (query.length > 400) throw error(400, 'query must be under 400 characters');

  const limit = Number.isFinite(Number(body.limit))
    ? Math.min(Math.max(Math.floor(Number(body.limit)), 1), 20)
    : 8;

  try {
    const hits = await searchResearch(query, { topK: limit, factsOnly: true });
    return json({
      query,
      count: hits.length,
      facts: hits
        .filter((h) => h.sourceUrl)
        .map((h) => ({
          claim: h.passage,
          sourceUrl: h.sourceUrl,
          sourceTitle: h.sourceTitle,
          sourceType: h.credibilityType,
          credibility: h.credibilityScore,
          asOf: h.fetchedAt,
          relevance: h.score,
        })),
    });
  } catch (err) {
    // Loud, never an empty result: searchResearch embeds the query, so a
    // missing embeddings key throws here, and returning [] would tell the
    // agent "this topic is not covered" — turning an infrastructure outage
    // into a false statement about the corpus, in a published explainer.
    throw error(502, err instanceof Error ? err.message : 'research search failed');
  }
};
