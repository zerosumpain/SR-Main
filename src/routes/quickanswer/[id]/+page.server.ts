import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * Old quick-answer permalinks.
 *
 * The backfill preserved each row's id when moving it into `research_session`,
 * so the id in the URL is still the right id — only the route changed.
 */
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/research/${params.id}`);
};
