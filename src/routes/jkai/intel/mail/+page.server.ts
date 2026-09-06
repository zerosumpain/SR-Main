// The mail gate's page load.
//
// Everything expensive is already one query or one pure pass in
// $lib/jkai/intel/mail-queue; this only adds the rules, which live in the
// datastore and are read separately.
import type { PageServerLoad } from './$types';
import { loadMailQueue } from '$lib/jkai/intel/mail-queue';
import { listMailRules, SEED_RULE, RELEVANCE_SEED_RULE } from '$lib/jkai/intel/mail-rules/store';
import { describeCondition } from '$lib/jkai/intel/mail-rules/spec';
import { tallyMailDecisions } from '$lib/jkai/intel/mail-decisions';
import { mailIndexStats } from '$lib/mail-index/search';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';

/**
 * How much of the queue has been scored against the graph.
 *
 * `unscored` is the number that matters and the reason this is a separate
 * query: the graph* facts read 0 on an unscored thread, which is indistinguish-
 * able from "names nothing" — so a topical rule quietly matching nothing looks
 * exactly like a topical rule with nothing to match.
 */
async function relevanceCoverage() {
  const [row] = await db
    .select({
      withHits: sql<number>`count(*) filter (where (${intelNotes.metadata}->'graphRelevance'->>'hits')::int > 0)::int`,
      // coalesce, because `NULL ? key` is NULL, not false — without it a note
      // with no metadata at all falls out of BOTH counts and the coverage line
      // silently under-reports the very threads most likely to be unscored.
      unscored: sql<number>`count(*) filter (where not (coalesce(${intelNotes.metadata}, '{}'::jsonb) ? 'graphRelevance'))::int`,
    })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending')));
  return { withHits: Number(row?.withHits) || 0, unscored: Number(row?.unscored) || 0 };
}

export const load: PageServerLoad = async () => {
  const [queue, rules, decisions, index, relevance] = await Promise.all([
    loadMailQueue(),
    listMailRules().catch(() => []),
    tallyMailDecisions().catch(() => ({ total: 0, admitted: 0, rejected: 0, byOwner: 0 })),
    mailIndexStats().catch(() => ({ threads: 0, chunks: 0 })),
    relevanceCoverage().catch(() => ({ withHits: 0, unscored: 0 })),
  ]);

  return {
    queue,
    decisions,
    index,
    relevance,
    rules: rules.map((r) => ({ ...r, explanation: describeCondition(r.condition) })),
    seedAvailable: ![SEED_RULE.key, RELEVANCE_SEED_RULE.key].every((k) => rules.some((r) => r.key === k)),
  };
};
