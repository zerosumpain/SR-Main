import { db } from '$lib/db';
import { facts } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { Fact } from '$lib/db/schema';

export interface SynthesisScope {
  factIds?: string[];
  category?: string;
  pinnedOnly?: boolean;
}

export type ScopeMode = 'ids' | 'category' | 'pinned' | 'session';

export interface ScopePlan {
  mode: ScopeMode;
  sessionId: string;
  factIds?: string[];
  category?: string;
  pinnedOnly?: boolean;
}

const MAX_SCOPE_IDS = 500;

/**
 * Pure decision: turn a SynthesisScope into a concrete query plan. factIds wins
 * over category, which wins over pinnedOnly, which wins over the whole-session
 * default. An empty factIds array is treated as "no id filter" so a caller that
 * passes `[]` doesn't accidentally synthesise zero facts.
 */
export function buildScopePlan(sessionId: string, scope: SynthesisScope): ScopePlan {
  if (Array.isArray(scope.factIds) && scope.factIds.length > 0) {
    return { mode: 'ids', sessionId, factIds: scope.factIds.slice(0, MAX_SCOPE_IDS) };
  }
  if (scope.category) {
    return { mode: 'category', sessionId, category: scope.category };
  }
  if (scope.pinnedOnly) {
    return { mode: 'pinned', sessionId, pinnedOnly: true };
  }
  return { mode: 'session', sessionId };
}

/**
 * Resolve the concrete fact rows for a scope plan. Always restricted to the
 * session and to non-counterfactual facts (challenge cards are linked, not
 * summarised directly). When mode==='ids' we additionally require sessionId to
 * stop a caller smuggling another session's fact ids into this run.
 */
export async function resolveFactSet(plan: ScopePlan): Promise<Fact[]> {
  const base = eq(facts.sessionId, plan.sessionId);
  const notCounter = eq(facts.isCounterfactual, false);

  if (plan.mode === 'ids') {
    if (!plan.factIds || plan.factIds.length === 0) return [];
    return db
      .select()
      .from(facts)
      .where(and(base, notCounter, inArray(facts.id, plan.factIds)));
  }
  if (plan.mode === 'category') {
    return db
      .select()
      .from(facts)
      .where(and(base, notCounter, eq(facts.deskCategory, plan.category!)));
  }
  if (plan.mode === 'pinned') {
    return db
      .select()
      .from(facts)
      .where(and(base, notCounter, eq(facts.pinned, true)));
  }
  // session
  return db.select().from(facts).where(and(base, notCounter));
}
