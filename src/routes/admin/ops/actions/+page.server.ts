import type { PageServerLoad } from './$types';
import { getRunLog } from '$lib/costs/runs.server';

export const load: PageServerLoad = async ({ url }) => {
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  return { page, ...(await getRunLog(page)) };
};
