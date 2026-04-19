import type { PageServerLoad } from './$types';
import { listEntities, listEntityTypes } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const typeId = url.searchParams.get('typeId') ?? undefined;
  const [entities, types] = await Promise.all([
    listEntities({ limit: 100, typeId }),
    listEntityTypes(),
  ]);
  return { entities, types, activeTypeId: typeId };
};
