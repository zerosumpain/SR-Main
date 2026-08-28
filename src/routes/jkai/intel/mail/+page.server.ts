// The mail gate's page load.
//
// Everything expensive is already one query or one pure pass in
// $lib/jkai/intel/mail-queue; this only adds the rules, which live in the
// datastore and are read separately.
import type { PageServerLoad } from './$types';
import { loadMailQueue } from '$lib/jkai/intel/mail-queue';
import { listMailRules, SEED_RULE } from '$lib/jkai/intel/mail-rules/store';
import { describeCondition } from '$lib/jkai/intel/mail-rules/spec';
import { tallyMailDecisions } from '$lib/jkai/intel/mail-decisions';
import { mailIndexStats } from '$lib/mail-index/search';

export const load: PageServerLoad = async () => {
  const [queue, rules, decisions, index] = await Promise.all([
    loadMailQueue(),
    listMailRules().catch(() => []),
    tallyMailDecisions().catch(() => ({ total: 0, admitted: 0, rejected: 0, byOwner: 0 })),
    mailIndexStats().catch(() => ({ threads: 0, chunks: 0 })),
  ]);

  return {
    queue,
    decisions,
    index,
    rules: rules.map((r) => ({ ...r, explanation: describeCondition(r.condition) })),
    seedAvailable: !rules.some((r) => r.key === SEED_RULE.key),
  };
};
