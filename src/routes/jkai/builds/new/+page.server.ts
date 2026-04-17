import { resolveDefaultModel } from '$lib/server/models/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const defaultBuilderModel = await resolveDefaultModel('builder');
  return { defaultBuilderModel };
};
