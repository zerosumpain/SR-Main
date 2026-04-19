import type { PageServerLoad } from './$types';
import { listTimelineEvents } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const entityId = url.searchParams.get('entityId') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  const events = await listTimelineEvents({ limit: 200, entityId, type });
  return { events, filters: { entityId, type } };
};
