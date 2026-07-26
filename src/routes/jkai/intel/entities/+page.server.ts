import type { PageServerLoad } from './$types';
import { listEntityTypes } from '$lib/jkai/intel/queries';
import { parseEntityQuery } from '$lib/jkai/intel/entity-query';
import { queryEntityPage } from '$lib/jkai/intel/entity-query.server';

export const load: PageServerLoad = async ({ url }) => {
  const query = parseEntityQuery(url.searchParams);
  const [result, types] = await Promise.all([queryEntityPage(query), listEntityTypes()]);

  return {
    ...result,
    // Retired types stay in the DB so historic rows still resolve, but offering
    // one as a filter would only ever produce an empty list.
    types: types.filter((t) => t.status !== 'retired'),
    query,
  };
};
