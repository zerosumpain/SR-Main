// src/lib/daydream/graph-apply.ts
//
// A verified graph link is APPLIED, not announced.
//
// "Card *6878 and NatWest credit card ending 6878 are probably connected" is
// not news; it is a fact about the graph that the graph should now hold. On
// production four of five live `intel_missing_link` thoughts were verified
// and none had been woven, while five graph links had been pushed to
// WhatsApp. So: when the reviewer verifies a graph-family thought, the weave
// runs (the endorsement path the graph already trusts), the source insight is
// marked `actioned`, and the thought is archived with the reason `applied` —
// which keeps it off the delivery queue forever, whatever the score.
//
// No entity-merge primitive is invented here. The closed action vocabulary
// is a capability grant per kind, and widening it is a security decision for
// its own PR; the weave is enough for the graph's extractor to record the
// relationship, and the insight status is what stops the intel page raising
// it again.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, intelInsights } from '$lib/db/schema';
import { errMsg } from './types';
import { weaveThought, type WeaveOutcome } from './weave';

export const GRAPH_KIND_PREFIX = 'intel_';
export function isGraphKind(kind: string): boolean {
  return kind.startsWith(GRAPH_KIND_PREFIX);
}

const LIVE = ['new', 'delivered', 'seen', 'suppressed'] as const;

/** The insight a bridged thought came from — its `{kind:'intel', id}` ref. */
export function insightIdOf(evidence: unknown): string | null {
  if (!Array.isArray(evidence)) return null;
  for (const e of evidence as Array<{ kind?: string; id?: string }>) {
    if (e?.kind === 'intel' && typeof e.id === 'string' && e.id) return e.id;
  }
  return null;
}

export interface ApplyOutcome {
  thoughtId: string;
  weave: WeaveOutcome;
  insightId: string | null;
  insightActioned: boolean;
}

/**
 * Apply one verified graph thought. Idempotent: an already-archived row is
 * left alone, the weave is `unchanged` on a repeat, and `setInsightStatus`
 * on an actioned insight is a no-op.
 */
export async function applyVerifiedGraphLink(thoughtId: string): Promise<ApplyOutcome> {
  const [row] = await db
    .select({ id: daydreamThoughts.id, kind: daydreamThoughts.kind, evidence: daydreamThoughts.evidence, status: daydreamThoughts.status })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, thoughtId))
    .limit(1);
  if (!row) return { thoughtId, weave: { status: 'skipped', reason: 'no such thought' }, insightId: null, insightActioned: false };
  if (!isGraphKind(row.kind)) return { thoughtId, weave: { status: 'skipped', reason: 'not a graph thought' }, insightId: null, insightActioned: false };

  const weave = await weaveThought(thoughtId);

  const insightId = insightIdOf(row.evidence);
  let insightActioned = false;
  if (insightId) {
    try {
      const { setInsightStatus } = await import('$lib/jkai/intel/insight-store');
      insightActioned = !!(await setInsightStatus(insightId, 'actioned'));
    } catch (err) {
      console.warn(`[daydream] could not action insight ${insightId}: ${errMsg(err)}`);
    }
  }

  await db
    .update(daydreamThoughts)
    .set({ status: 'archived', suppressedReason: 'applied', updatedAt: new Date() })
    .where(and(eq(daydreamThoughts.id, thoughtId), inArray(daydreamThoughts.status, [...LIVE])));

  return { thoughtId, weave, insightId, insightActioned };
}

/** The verified graph thoughts still live — the ones verified before this
 *  existed, and any the review path missed. */
export async function applyPendingGraphLinks(limit = 10): Promise<ApplyOutcome[]> {
  const rows = await db
    .select({ id: daydreamThoughts.id })
    .from(daydreamThoughts)
    .where(
      and(
        sql`${daydreamThoughts.kind} like ${GRAPH_KIND_PREFIX + '%'}`,
        eq(daydreamThoughts.reviewVerdict, 'verified'),
        inArray(daydreamThoughts.status, [...LIVE]),
      ),
    )
    .limit(limit);
  const out: ApplyOutcome[] = [];
  for (const r of rows) out.push(await applyVerifiedGraphLink(r.id));
  return out;
}

/**
 * The other direction: an insight dismissed or actioned on `/jkai/intel`
 * leaves its bridged thought live here indefinitely, because the bridge reads
 * the insight's status once, at bridging. Archive such thoughts with the
 * insight's verdict as the reason.
 */
export async function syncInsightStatuses(limit = 50): Promise<number> {
  const rows = await db
    .select({ id: daydreamThoughts.id, evidence: daydreamThoughts.evidence })
    .from(daydreamThoughts)
    .where(
      and(
        sql`${daydreamThoughts.kind} like ${GRAPH_KIND_PREFIX + '%'}`,
        inArray(daydreamThoughts.status, [...LIVE]),
      ),
    )
    .limit(limit);
  const byInsight = new Map<string, string[]>();
  for (const r of rows) {
    const id = insightIdOf(r.evidence);
    if (!id) continue;
    byInsight.set(id, [...(byInsight.get(id) ?? []), r.id]);
  }
  if (byInsight.size === 0) return 0;
  const insights = await db
    .select({ id: intelInsights.id, status: intelInsights.status })
    .from(intelInsights)
    .where(inArray(intelInsights.id, [...byInsight.keys()]));
  let archived = 0;
  for (const ins of insights) {
    if (ins.status !== 'dismissed' && ins.status !== 'actioned') continue;
    const ids = byInsight.get(ins.id) ?? [];
    if (!ids.length) continue;
    const done = await db
      .update(daydreamThoughts)
      .set({ status: 'archived', suppressedReason: `insight_${ins.status}`, updatedAt: new Date() })
      .where(and(inArray(daydreamThoughts.id, ids), inArray(daydreamThoughts.status, [...LIVE])))
      .returning({ id: daydreamThoughts.id });
    archived += done.length;
  }
  return archived;
}
