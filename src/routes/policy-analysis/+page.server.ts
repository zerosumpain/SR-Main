import type { PageServerLoad } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { listAnalyses } from '$lib/policy-analysis/server/store';
export const load: PageServerLoad = async (event) => ({ analyses: await listAnalyses(await requirePolicyOwner(event)), enabled: process.env.POLICY_ANALYSIS_ENABLED !== '0' });
