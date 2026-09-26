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
import { intelNotes, intelEntities } from '$lib/db/schema';
import { isOwnerScope, spaceIn, type IntelScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

/**
 * How much of the queue has been scored against the graph.
 *
 * `unscored` is the number that matters and the reason this is a separate
 * query: the graph* facts read 0 on an unscored thread, which is indistinguish-
 * able from "names nothing" — so a topical rule quietly matching nothing looks
 * exactly like a topical rule with nothing to match.
 */
async function relevanceCoverage(scope: IntelScope) {
  const [row] = await db
    .select({
      withHits: sql<number>`count(*) filter (where (${intelNotes.metadata}->'graphRelevance'->>'hits')::int > 0)::int`,
      foregroundHits: sql<number>`count(*) filter (where (${intelNotes.metadata}->'graphRelevance'->>'topWeight')::int >= 3)::int`,
      // coalesce, because `NULL ? key` is NULL, not false — without it a note
      // with no metadata at all falls out of BOTH counts and the coverage line
      // silently under-reports the very threads most likely to be unscored.
      unscored: sql<number>`count(*) filter (where not (coalesce(${intelNotes.metadata}, '{}'::jsonb) ? 'graphRelevance'))::int`,
    })
    .from(intelNotes)
    .where(
      and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending'), spaceIn(intelNotes.spaceId, scope)),
    );
  // The owner's foreground, read straight from the graph: a topical rule keyed
  // on it matches nothing while this is 0, and that must be visible on the page
  // rather than inferred from a rule that never fires.
  const [fg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(intelEntities)
    .where(
      sql`${intelEntities.mergedIntoId} IS NULL AND (${intelEntities.watched} OR ${intelEntities.lens} IS NOT NULL) AND ${spaceIn(intelEntities.spaceId, scope)}`,
    );
  return {
    withHits: Number(row?.withHits) || 0,
    unscored: Number(row?.unscored) || 0,
    foregroundHits: Number(row?.foregroundHits) || 0,
    foreground: Number(fg?.n) || 0,
  };
}

// The queue and the relevance coverage are the request's scope. The admission
// rules, the decision ledger and the mail index are the owner's alone (one
// global list each, learned from and built over the owner's mailbox — see
// /api/jkai/intel/mail/rules), so any other scope gets them empty.
export const load: PageServerLoad = async (event) => {
  // Held mail is its owner's until admitted: `all` does not widen it (see scope.server).
  const scope = await resolveRequestScope(event, 'own');
  const owner = isOwnerScope(scope);
  const noDecisions = { total: 0, admitted: 0, rejected: 0, byOwner: 0 };
  const [queue, rules, decisions, index, relevance] = await Promise.all([
    loadMailQueue(undefined, scope),
    owner ? listMailRules().catch(() => []) : [],
    owner ? tallyMailDecisions().catch(() => noDecisions) : noDecisions,
    owner ? mailIndexStats(scope).catch(() => ({ threads: 0, chunks: 0 })) : { threads: 0, chunks: 0 },
    relevanceCoverage(scope).catch(() => ({ withHits: 0, unscored: 0, foregroundHits: 0, foreground: 0 })),
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
