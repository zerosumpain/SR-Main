import type { PageServerLoad } from './$types';
import { listDevices } from '$lib/server/native-auth';

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth();
  const email = session?.user?.email ?? '';
  // The LAN review bypass has no OAuth session to resolve. It reaches the page
  // because the route gate already let it through; an empty list is the honest
  // answer rather than a crash.
  return { devices: email ? await listDevices(email) : [] };
};
