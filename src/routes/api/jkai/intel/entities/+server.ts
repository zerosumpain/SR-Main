import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEntities, listEntityTypes } from '$lib/jkai/intel/queries';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const typeId = url.searchParams.get('typeId') ?? undefined;
  const [entities, types] = await Promise.all([
    listEntities({ limit, offset, typeId }),
    listEntityTypes(),
  ]);
  return json({ entities, types });
};
