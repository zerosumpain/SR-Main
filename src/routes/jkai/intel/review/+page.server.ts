import type { PageServerLoad } from './$types';
import { listPendingReview } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async () => {
  return listPendingReview();
};
