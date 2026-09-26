// Who may read, change and start research runs — the one guard every research
// route calls before it touches a session or anything under it.
//
// A session a reader may not see is a 404, exactly like a session that does
// not exist, so an id cannot be probed for. One they may see but not change
// is a 403. Children (sources, facts, entities, narrative, synthesis) carry
// no owner of their own: a route reaches them through a session it has
// already passed here.
//
// Spec: docs/superpowers/specs/2026-09-26-access-groups-design.md (Research).

import { error } from '@sveltejs/kit';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessUsage, researchSessions, sources } from '$lib/db/schema';
import { areaAccess, canRead, canWrite, type AreaAccess } from '$lib/server/area-scope';
import type { ResearchDepth } from './depth';

export type ResearchSessionRow = typeof researchSessions.$inferSelect;

/** The session, if this request may read it (intent 'read') or change it ('write'). */
export async function requireResearchSession(
  event: { locals: App.Locals },
  id: string,
  intent: 'read' | 'write' = 'read',
): Promise<{ session: ResearchSessionRow; access: AreaAccess }> {
  const access = await areaAccess(event, 'research');
  const [session] = id
    ? await db.select().from(researchSessions).where(eq(researchSessions.id, id)).limit(1)
    : [];
  if (!session || !canRead(session.principalId, access)) throw error(404, 'Session not found');
  if (intent === 'write' && !canWrite(session.principalId, access)) throw error(403, 'Forbidden');
  return { session, access };
}

/** A source row, through the session it belongs to. */
export async function requireSourceSession(
  event: { locals: App.Locals },
  sourceId: string,
): Promise<{ sessionId: string; access: AreaAccess }> {
  const access = await areaAccess(event, 'research');
  const [row] = sourceId
    ? await db
        .select({ sessionId: sources.sessionId, principalId: researchSessions.principalId })
        .from(sources)
        .innerJoin(researchSessions, eq(researchSessions.id, sources.sessionId))
        .where(eq(sources.id, sourceId))
        .limit(1)
    : [];
  if (!row || !canRead(row.principalId, access)) throw error(404, 'Source not found');
  return { sessionId: row.sessionId, access };
}

/** Depths a member may start. `investigation` has no wall-clock budget at all. */
export const MEMBER_DEPTHS: readonly ResearchDepth[] = ['instant', 'scan', 'brief'];
/**
 * Metered research acts per member per rolling 24 h: a new run, an explore, a
 * resume and a report regeneration each take one. Counted from `access_usage`,
 * not from the runs, so deleting a run does not hand its slot back.
 */
export const RESEARCH_DAILY_RUNS = 5;

/**
 * May this reader take one more metered research act at `depth`? PURE:
 * `usedToday` is what the ledger holds. The owner is never capped.
 */
export function researchStartDecision(
  access: AreaAccess,
  depth: ResearchDepth,
  usedToday: number,
): { ok: true } | { ok: false; status: number; error: string } {
  if (access.level === 'owner') return { ok: true };
  if (!MEMBER_DEPTHS.includes(depth)) {
    return { ok: false, status: 403, error: 'Your access runs research up to brief depth.' };
  }
  if (usedToday >= RESEARCH_DAILY_RUNS) {
    return { ok: false, status: 429, error: `That is ${RESEARCH_DAILY_RUNS} research runs today — the limit. Try again tomorrow.` };
  }
  return { ok: true };
}

/**
 * Take one metered research act for this reader, or throw the refusal. The
 * count and the ledger row happen under a per-principal advisory lock in one
 * transaction, so twenty parallel requests cannot all read "0 used" and all
 * start. A slot taken by a request that then fails is spent — the conservative
 * side. The owner is neither counted nor capped.
 */
export async function reserveResearchStart(access: AreaAccess, depth: ResearchDepth): Promise<void> {
  if (access.level === 'owner') return;
  const refusal = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`access_usage:research:${access.own}`}))`);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await tx
      .select({ n: count() })
      .from(accessUsage)
      .where(and(eq(accessUsage.principalId, access.own), eq(accessUsage.kind, 'research'), gte(accessUsage.at, since)));
    const decision = researchStartDecision(access, depth, Number(row?.n ?? 0));
    if (!decision.ok) return decision;
    await tx.insert(accessUsage).values({ principalId: access.own, kind: 'research' });
    return null;
  });
  if (refusal) throw error(refusal.status, refusal.error);
}
