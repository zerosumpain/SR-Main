import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchKnowledge, type KnowledgeSource } from '$lib/knowledge/search';

/**
 * Unified knowledge recall for the /jkai/knowledge page. Owner-gated by hooks
 * (the whole /api/jkai area is owner-only). Fans out across files + research +
 * memory + datastore and returns ranked, provenance-tagged hits.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return json({ error: 'query is required' }, { status: 400 });

  const sources = Array.isArray(body.sources)
    ? (body.sources as unknown[]).filter((s): s is KnowledgeSource =>
        ['notes', 'entities', 'files', 'research', 'memory', 'datastore', 'activity'].includes(s as string),
      )
    : undefined;

  try {
    const result = await searchKnowledge(query, {
      sources: sources && sources.length ? sources : undefined,
      limitPerSource: 6,
    });
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'search failed' }, { status: 500 });
  }
};
