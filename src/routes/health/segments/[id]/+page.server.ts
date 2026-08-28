import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSegment, getSimilarSegments } from '$lib/trails/segments-service';

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw error(404, 'Segment not found');

  const segment = await getSegment(id);
  if (!segment) throw error(404, 'Segment not found');

  // Comparison panels are garnish; the segment page must survive their failure.
  const similar = await getSimilarSegments(segment).catch((err) => {
    console.warn('[trails] similar segments failed:', (err as Error)?.message);
    return { byClimb: [], byEfficiency: [] };
  });

  return { segment, similar };
};
