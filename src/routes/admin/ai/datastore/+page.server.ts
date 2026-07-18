import type { PageServerLoad } from './$types';
import { listCollections, countRecords } from '$lib/datastore';

// The datastore admin UI operates as the `owner` actor (page is owner-gated in
// hooks.server.ts). Server load reads via $lib/datastore directly; mutations go
// through the /api/admin/datastore/* JSON routes with ?token= (blog/access precedent).

export const load: PageServerLoad = async () => {
  const collections = await listCollections('owner');
  const withCounts = await Promise.all(
    collections.map(async (c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      isSystem: c.isSystem,
      updatedAt: c.updatedAt,
      recordCount: await countRecords(c.slug, undefined, 'owner'),
    })),
  );
  return { collections: withCounts };
};
