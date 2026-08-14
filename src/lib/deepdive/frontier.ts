/**
 * The research frontier — a durable, scored queue of lines of enquiry.
 *
 * Replaces `phase1`'s in-memory `followUpQueue`, which was a plain FIFO array
 * with no scores: an unproductive query spawned children exactly like a
 * productive one, and the whole queue evaporated on restart.
 *
 * Two properties this buys that the array could not:
 *
 *  - **Branches die individually.** A lead judged `drifted` takes its whole
 *    unstarted subtree with it, so the run stops paying for a line of enquiry
 *    the moment it is recognised as off-question — rather than waiting for a
 *    global average to sag.
 *  - **A dead worker is resumable.** The queue is rows, so work that was
 *    `running` when a process died can be requeued instead of stranding the
 *    session (see `resume.ts`).
 */
import { db } from '$lib/db';
import { researchLeads, entities } from '$lib/db/schema';
import type { ResearchLead } from '$lib/db/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';
import { emit } from './worker';
import { classifyOutcome, cosine, type LeadOutcome, type LeadVerdict } from './frontier-scoring';

/** How far a branch may run from its seed before it is cut off regardless of yield. */
export const MAX_LEAD_DEPTH = 3;

export interface LeadSpec {
  query: string;
  parentId?: string | null;
  depth?: number;
  origin?: 'seed' | 'entity' | 'gap' | 'hypothesis' | 'followup';
  originDetail?: string | null;
}

/** Broadcast a lead's current state so the live graph can draw it. */
function emitLead(sessionId: string, lead: ResearchLead): void {
  emit(sessionId, {
    type: 'lead',
    data: {
      id: lead.id,
      query: lead.query,
      parentId: lead.parentId,
      depth: lead.depth,
      origin: lead.origin,
      originDetail: lead.originDetail,
      status: lead.status,
      reason: lead.reason,
      score: lead.score,
      metrics: lead.metrics,
    },
  });
}

/**
 * Add leads to the frontier, skipping queries this session has already asked.
 *
 * Deduplication is what stops a cycle: entity A suggests a query that finds
 * entity A again, which suggests the same query. The old FIFO had no such
 * guard and relied on the global saturation check to eventually notice.
 */
export async function addLeads(sessionId: string, specs: LeadSpec[]): Promise<ResearchLead[]> {
  if (!specs.length) return [];

  const existing = new Set(
    (
      await db
        .select({ query: researchLeads.query })
        .from(researchLeads)
        .where(eq(researchLeads.sessionId, sessionId))
    ).map((r) => r.query.trim().toLowerCase()),
  );

  const fresh: LeadSpec[] = [];
  for (const spec of specs) {
    const q = spec.query?.trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    fresh.push({ ...spec, query: q });
  }
  if (!fresh.length) return [];

  const rows = await db
    .insert(researchLeads)
    .values(
      fresh.map((s) => ({
        sessionId,
        query: s.query,
        parentId: s.parentId ?? null,
        depth: s.depth ?? 0,
        origin: s.origin ?? 'seed',
        originDetail: s.originDetail ?? null,
        status: 'queued',
      })),
    )
    .returning();

  for (const row of rows) emitLead(sessionId, row);
  return rows;
}

/**
 * Claim the next batch of leads, highest expected value first.
 *
 * Ordering is by the PARENT's score, because a lead has no score of its own
 * until it runs — a child of a productive branch is the best available guess at
 * what to try next.
 */
export async function takeLeads(sessionId: string, limit: number): Promise<ResearchLead[]> {
  const queued = await db
    .select()
    .from(researchLeads)
    .where(and(eq(researchLeads.sessionId, sessionId), eq(researchLeads.status, 'queued')))
    .orderBy(asc(researchLeads.depth), desc(researchLeads.score), asc(researchLeads.createdAt))
    .limit(limit);

  if (!queued.length) return [];

  const claimed = await db
    .update(researchLeads)
    .set({ status: 'running', startedAt: new Date() })
    .where(
      and(
        inArray(
          researchLeads.id,
          queued.map((l) => l.id),
        ),
        // Only claim what is still queued — a concurrent worker may have taken it.
        eq(researchLeads.status, 'queued'),
      ),
    )
    .returning();

  for (const row of claimed) emitLead(sessionId, row);
  return claimed;
}

/**
 * Note what a lead GATHERED, without judging it yet.
 *
 * Phase 1 collects sources and phase 2 extracts the facts and entities, so at
 * the moment a lead's searches finish there is nothing to judge it on: novelty,
 * alignment and connectivity are all properties of material that does not exist
 * yet. The lead therefore stays `running` and carries its source count forward;
 * `completeLead` closes it once phase 2 has processed what it found.
 *
 * A lead whose searches all failed is closed out immediately — waiting for facts
 * that can never arrive would leave it running forever.
 */
export async function recordLeadSources(
  sessionId: string,
  leadId: string,
  sourcesFound: number,
  searchFailed: boolean,
): Promise<void> {
  if (searchFailed && sourcesFound === 0) {
    await completeLead(sessionId, leadId, {
      sourcesFound: 0,
      novelFacts: 0,
      duplicateFacts: 0,
      novelEntities: 0,
      connectedEntities: 0,
      goalAlignment: 0,
      searchFailed: true,
    });
    return;
  }

  const [row] = await db
    .update(researchLeads)
    .set({ metrics: { sourcesFound, searchFailed } })
    .where(eq(researchLeads.id, leadId))
    .returning();
  if (row) emitLead(sessionId, row);
}

/**
 * Record what a lead returned, judge it, and prune its subtree if it drifted.
 *
 * Returns the verdict so the caller can decide whether to spawn children.
 */
export async function completeLead(
  sessionId: string,
  leadId: string,
  outcome: LeadOutcome,
): Promise<LeadVerdict> {
  const verdict = classifyOutcome(outcome);

  const [row] = await db
    .update(researchLeads)
    .set({
      status: verdict.status,
      reason: verdict.reason,
      score: verdict.score,
      metrics: outcome as unknown as Record<string, unknown>,
      completedAt: new Date(),
    })
    .where(eq(researchLeads.id, leadId))
    .returning();

  if (row) emitLead(sessionId, row);

  // A drifted branch is abandoned wholesale. Pruning only the parent would let
  // its already-queued children carry on down exactly the path just rejected.
  if (verdict.status === 'drifted') {
    await pruneSubtree(sessionId, leadId, 'parent line of enquiry was abandoned');
  }

  return verdict;
}

/**
 * Cancel every unstarted descendant of a lead.
 *
 * Walks the tree iteratively rather than recursing in SQL — the depth cap keeps
 * it shallow, and `running` leads are left alone because their work is already
 * paid for.
 */
export async function pruneSubtree(
  sessionId: string,
  rootId: string,
  reason: string,
): Promise<number> {
  let frontier = [rootId];
  let pruned = 0;

  for (let hop = 0; hop <= MAX_LEAD_DEPTH && frontier.length; hop++) {
    const children = await db
      .select()
      .from(researchLeads)
      .where(and(eq(researchLeads.sessionId, sessionId), inArray(researchLeads.parentId, frontier)));
    if (!children.length) break;

    const cancellable = children.filter((c) => c.status === 'queued').map((c) => c.id);
    if (cancellable.length) {
      const rows = await db
        .update(researchLeads)
        .set({ status: 'pruned', reason, completedAt: new Date() })
        .where(inArray(researchLeads.id, cancellable))
        .returning();
      pruned += rows.length;
      for (const row of rows) emitLead(sessionId, row);
    }
    frontier = children.map((c) => c.id);
  }

  return pruned;
}

/** True when there is nothing left worth doing. */
export async function frontierExhausted(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(researchLeads)
    .where(
      and(
        eq(researchLeads.sessionId, sessionId),
        inArray(researchLeads.status, ['queued', 'running']),
      ),
    );
  return (row?.n ?? 0) === 0;
}

/**
 * How well a set of new facts matches what the session is actually asking, and
 * how much of the new material attaches to what is already known.
 *
 * Both come from data the engine already produced — `fact.embedding` exists for
 * retrieval regardless, and entity mentions are written during extraction — so
 * judging a branch costs no extra model call.
 */
export async function measureAlignment(
  anchor: number[] | null,
  factEmbeddings: (number[] | null)[],
): Promise<number> {
  if (!anchor?.length) return 1; // No anchor means we cannot judge; do not punish.
  const scored = factEmbeddings.filter((e): e is number[] => !!e?.length).map((e) => cosine(anchor, e));
  if (!scored.length) return 1;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

/**
 * Count how many of the given entities touch a fact that another entity also
 * touches — i.e. they join the existing graph rather than floating free.
 */
export async function countConnectedEntities(
  sessionId: string,
  entityIds: string[],
): Promise<number> {
  if (!entityIds.length) return 0;
  // `pgTextArray` rather than an interpolated literal: a bare `ANY(${arr})`
  // binds as a ROW CONSTRUCTOR in Drizzle and breaks at two or more elements,
  // and hand-building the array text would be an injection seam.
  const rows = await db.execute(sql`
    SELECT COUNT(DISTINCT em.entity_id)::int AS n
    FROM entity_mention em
    JOIN fact f ON f.id = em.fact_id
    WHERE em.entity_id = ANY(${pgTextArray(entityIds)}::text[])
      AND f.session_id = ${sessionId}
      AND EXISTS (
        SELECT 1 FROM entity_mention other
        WHERE other.fact_id = em.fact_id
          AND other.entity_id <> em.entity_id
      )
  `);
  return Number((rows.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

/** Everything drawn on the live frontier graph, for a late-joining client. */
export async function loadFrontier(sessionId: string): Promise<ResearchLead[]> {
  return db
    .select()
    .from(researchLeads)
    .where(eq(researchLeads.sessionId, sessionId))
    .orderBy(asc(researchLeads.createdAt));
}

/** Session-scoped entity ids, used to tell new entities from known ones. */
export async function knownEntityNames(sessionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ name: entities.name })
    .from(entities)
    .where(eq(entities.sessionId, sessionId));
  return new Set(rows.map((r) => r.name.trim().toLowerCase()));
}
