/**
 * Search sources for ONE claim, on demand.
 *
 * The sibling `/review-claims` endpoint extracts every claim in a post and
 * searches for all of them in one streamed pass. This is the other half of that
 * job and exists because of what an author actually does with the result: none
 * of the four sources offered is the one they want, and until now there was
 * nothing to do about it but re-run the whole extraction — which costs a model
 * call, rewrites every other claim's candidates, and returns the same four
 * sources for this one anyway.
 *
 * So: no extraction, no model call, no stream. One Tavily search against a
 * query the author may have edited, ranked by the shared arithmetic, minus
 * whatever they have already seen. It is a plain JSON response because it is a
 * single fast operation — a stream here would be ceremony around one round trip.
 *
 * Owner-gated by hooks.server.ts like everything under /api/admin; there is
 * deliberately no auth code here.
 */

import { json } from '@sveltejs/kit';
import { search as tavilySearch } from '$lib/deepdive/tavily';
import { rankSources } from '$lib/blog/reputable-domains';
import { withActivity } from '$lib/context/activity';
import type { RequestHandler } from './$types';

/** Wider than the streamed pass fetches. A second look is asked for precisely
 *  because the obvious results were wrong, and the answer is usually further
 *  down the page rather than in a different query. */
const TAVILY_RESULTS = 15;
const RETURNED = 6;
const MAX_QUERY_CHARS = 300;
const MAX_EXCLUDE = 50;

export const POST: RequestHandler = (event) => withActivity('blog', async () => handle(event));

const handle: RequestHandler = async ({ request }) => {
  let body: { query?: unknown; claim?: unknown; exclude?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, MAX_QUERY_CHARS) : '';
  if (!query) return json({ error: 'Missing query' }, { status: 400 });

  // The claim decides which sources count as affiliated. Absent, the ranking
  // still works — it just cannot tell that a page is the subject talking about
  // itself, so the caller should send it whenever it has one.
  const claim = typeof body.claim === 'string' ? body.claim.slice(0, MAX_QUERY_CHARS) : undefined;

  const exclude = Array.isArray(body.exclude)
    ? body.exclude.filter((u): u is string => typeof u === 'string' && !!u).slice(0, MAX_EXCLUDE)
    : [];

  try {
    const found = await tavilySearch(query, { maxResults: TAVILY_RESULTS, searchDepth: 'advanced' });
    const ranked = rankSources(found.results ?? [], { subject: claim, exclude, limit: RETURNED });

    return json({
      query,
      resultsCount: (found.results ?? []).length,
      // Reported so the panel can say "nothing new" rather than showing an
      // empty list that looks like a failure. Exhausting the results for a
      // query is a real answer: it means the query needs changing, not repeating.
      exhausted: ranked.length === 0 && (found.results ?? []).length > 0,
      candidates: ranked.map((r) => ({
        url: r.url,
        title: r.title,
        domain: r.domain,
        reputable: r.rating.reputable,
        uk: r.rating.uk,
        academic: r.rating.academic,
        affiliated: r.rating.affiliated,
        why: r.snippet.replace(/\s+/g, ' ').trim().slice(0, 220),
        score: r.score,
      })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Source search failed' }, { status: 502 });
  }
};
