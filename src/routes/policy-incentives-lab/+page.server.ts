import type { PageServerLoad } from './$types';
import { requireLabOwner } from '$lib/policy-incentives-lab/server/access';
import { listProjects } from '$lib/policy-incentives-lab/server/store';
export const load: PageServerLoad = async ({ locals }) => ({ projects: await listProjects(await requireLabOwner(locals)) });
