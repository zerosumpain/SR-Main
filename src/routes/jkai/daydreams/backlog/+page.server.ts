import type { PageServerLoad } from './$types';
import { loadEpicBacklog } from '$lib/selfimprove/epic-backlog.server';
import { errMsg } from '$lib/selfimprove/types';

export const load: PageServerLoad = async () => {
  try { return { epics: await loadEpicBacklog(), error: null }; }
  catch (error) { return { epics: [], error: errMsg(error) }; }
};
