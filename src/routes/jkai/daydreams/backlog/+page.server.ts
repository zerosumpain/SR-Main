import type { PageServerLoad } from './$types';
import { autoGroomBacklog } from '$lib/workflows/backlog-grooming.server';
import { errMsg } from '$lib/selfimprove/types';

export const load: PageServerLoad = async () => {
  try { return { epics: await autoGroomBacklog(), error: null }; }
  catch (error) { return { epics: [], error: errMsg(error) }; }
};
