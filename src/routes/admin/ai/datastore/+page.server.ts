import type { PageServerLoad } from './$types';
import { listCollections, recordCountsByCollection } from '$lib/datastore';

// The datastore admin UI operates as the `owner` actor (page is owner-gated in
// hooks.server.ts). Server load reads via $lib/datastore directly; mutations go
// through the /api/admin/datastore/* JSON routes with ?token= (blog/access precedent).

export const load: PageServerLoad = async () => {
  // One grouped count query for all collections instead of an N+1 per-collection
  // count (each of which also re-fetched the collection by slug).
  const [collections, counts] = await Promise.all([
    listCollections('owner'),
    recordCountsByCollection(),
  ]);
  const withCounts = collections.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    isSystem: c.isSystem,
    updatedAt: c.updatedAt,
    recordCount: counts[c.id] ?? 0,
  }));
  return { collections: withCounts };
};
