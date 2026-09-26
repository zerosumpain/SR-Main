import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchKnowledge, type KnowledgeSource } from '$lib/knowledge/search';
import { areaAccess } from '$lib/server/area-scope';
import { viewerHolds, viewerOf } from '$lib/server/viewer';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

/**
 * Unified knowledge recall for /jkai/intel/search. The owner's recall fans out
 * across files + research + memory + datastore + intel. A member holding
 * `jkai.knowledge` recalls only what they may already read: their intel scope
 * (with `jkai.intel`) and their readable research runs (with `research`) —
 * never the owner's files, memory, datastore or activity.
 */
async function readerOf(event: Parameters<RequestHandler>[0]) {
  const access = await areaAccess(event, 'jkai.knowledge');
  if (access.level === 'owner') return undefined;
  const viewer = await viewerOf(event);
  return {
    intel: viewerHolds(viewer, 'jkai.intel:self') ? await resolveRequestScope(event) : null,
    research: viewerHolds(viewer, 'research:self') ? await areaAccess(event, 'research') : null,
  };
}

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  const reader = await readerOf(event);
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
      reader,
    });
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'search failed' }, { status: 500 });
  }
};
