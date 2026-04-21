import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { searchIntel, type IntelFacets } from '$lib/jkai/intel/search';

export const GET: RequestHandler = async ({ url, params }) => {
  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.name, `canvas:${params.slug}`))
    .limit(1);
  if (!wf) throw error(404, 'Canvas not found');

  const query = url.searchParams.get('query') ?? '';
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(50, Number(limitRaw))) : 20;
  const orderingRaw = url.searchParams.get('ordering');
  const ordering: 'recent' | 'relevant' =
    orderingRaw === 'recent' || orderingRaw === 'relevant' ? orderingRaw : 'relevant';

  const entityTypes = url.searchParams.getAll('entityType');
  const tags = url.searchParams.getAll('tag');

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const timeRange = from && to ? { from, to } : null;

  const facets: IntelFacets = {
    entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
    tags: tags.length > 0 ? tags : undefined,
    timeRange,
    limit,
    ordering,
  };

  try {
    const { items, total } = await searchIntel(query, facets);
    return json({ items, total });
  } catch (err) {
    console.error('[canvas/intel/preview]', err);
    throw error(500, 'Intel preview failed');
  }
};
