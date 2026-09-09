import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLabOwner } from '$lib/policy-incentives-lab/server/access';
import { getProject, versions, runs } from '$lib/policy-incentives-lab/server/store';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params }) => {
  const owner = await requireLabOwner(locals);
  if (!z.uuid().safeParse(params.id).success) error(404, 'Not found');
  try { return { project: await getProject(owner, params.id), versions: await versions(owner, params.id), runs: await runs(owner, params.id) }; }
  catch { error(404, 'Analysis not found'); }
};
