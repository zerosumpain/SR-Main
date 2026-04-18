import type { PageServerLoad } from './$types';
import { getKeysStatus } from '$lib/deepdive/keys';

export const load: PageServerLoad = async () => {
  return { keys: getKeysStatus() };
};
