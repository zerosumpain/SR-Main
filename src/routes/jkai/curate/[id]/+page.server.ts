import { error } from '@sveltejs/kit';
import { getSession } from '$lib/curate/session-store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);
  return { session };
};
