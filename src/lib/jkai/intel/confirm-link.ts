// Confirming and rejecting a predicted relationship.
//
// The missing-link detector proposes pairs it thinks should be connected, and
// the dashboard offers "Confirm the link" against each one. That button was
// declared with `action: 'ask'`, which meant it deep-linked to jkai with a
// prefilled question and the graph learned nothing from the answer — the
// prediction came back on the next run regardless of what the user had decided.
//
// Both halves matter, and the rejecting half more than it looks: without a way
// to say NO, every wrong prediction is permanent, and the panel fills with
// pairs the user has already ruled on. Rejection therefore SUPPRESSES rather
// than deletes, because a later extraction would otherwise re-create the edge
// and undo the correction.
import { and, eq, or } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelRelationships } from '$lib/db/schema';
import { weightFor, strengthBucket } from './graph';
import { invalidateGraphAnalysis } from './analytics/load';

/** The relationship type a hand-confirmed link is recorded under. */
export const CONFIRMED_EDGE_TYPE = 'related_to';

export interface ConfirmLinkInput {
  sourceEntityId: string;
  targetEntityId: string;
  /** What the user says the relationship is. Optional. */
  label?: string | null;
}

export interface ConfirmLinkResult {
  relationshipId: string;
  created: boolean;
}

/**
 * Find an existing edge between two entities in EITHER direction.
 *
 * Direction-agnostic on purpose: the predictor names the pair in whichever
 * order it happened to consider them, and confirming A→B when B→A already
 * exists would leave two edges saying the same thing and double the pair's
 * apparent corroboration.
 */
async function findEdgeBetween(a: string, b: string) {
  const [row] = await db
    .select()
    .from(intelRelationships)
    .where(
      or(
        and(eq(intelRelationships.sourceEntityId, a), eq(intelRelationships.targetEntityId, b)),
        and(eq(intelRelationships.sourceEntityId, b), eq(intelRelationships.targetEntityId, a)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Record that two entities really are related.
 *
 * Written `manual: true` and at high confidence: this is the user asserting it,
 * which outranks anything an extractor inferred. `manual` is also what stops
 * persistExtraction overwriting the label on a later re-ingest.
 */
export async function confirmRelationship(input: ConfirmLinkInput): Promise<ConfirmLinkResult> {
  const { sourceEntityId, targetEntityId } = input;
  const label = (input.label ?? '').trim().slice(0, 500) || 'Confirmed by hand';

  const existing = await findEdgeBetween(sourceEntityId, targetEntityId);

  if (existing) {
    // Confirming an edge that already exists is still meaningful — it may have
    // been suppressed, or inferred at low confidence. Lift it to a manual,
    // high-confidence assertion and un-suppress it.
    await db
      .update(intelRelationships)
      .set({
        manual: true,
        confidence: 'high',
        suppressed: false,
        suppressedReason: null,
        label,
        weight: weightFor((existing.observationCount ?? 1) + 1, 'high'),
        strength: strengthBucket(weightFor((existing.observationCount ?? 1) + 1, 'high')),
        lastSeenAt: new Date(),
      })
      .where(eq(intelRelationships.id, existing.id));

    invalidateGraphAnalysis();
    return { relationshipId: existing.id, created: false };
  }

  const [created] = await db
    .insert(intelRelationships)
    .values({
      sourceEntityId,
      targetEntityId,
      type: CONFIRMED_EDGE_TYPE,
      label,
      confidence: 'high',
      manual: true,
      observationCount: 1,
      weight: weightFor(1, 'high'),
      strength: strengthBucket(weightFor(1, 'high')),
      lastSeenAt: new Date(),
    })
    .returning({ id: intelRelationships.id });

  // The dashboard reads a cached analysis; without this the edge the user just
  // confirmed would not appear for up to a minute and the button would look
  // broken all over again.
  invalidateGraphAnalysis();
  return { relationshipId: created.id, created: true };
}

export interface RejectLinkInput {
  sourceEntityId: string;
  targetEntityId: string;
  reason?: string;
}

export interface RejectLinkResult {
  suppressed: boolean;
  /** Set when there was an existing edge to suppress. */
  relationshipId?: string;
}

/**
 * Record that two entities are NOT related.
 *
 * When an edge exists it is suppressed with a reason, which persistExtraction
 * already honours by refusing to re-create it. When no edge exists — the usual
 * case, since these are PREDICTIONS — a suppressed placeholder is written, so
 * the same rejection blocks the edge if an extractor later proposes it.
 */
export async function rejectRelationship(input: RejectLinkInput): Promise<RejectLinkResult> {
  const { sourceEntityId, targetEntityId } = input;
  const reason = (input.reason ?? '').trim().slice(0, 500) || 'Rejected from the intel dashboard';

  const existing = await findEdgeBetween(sourceEntityId, targetEntityId);

  if (existing) {
    if (existing.suppressed) return { suppressed: false, relationshipId: existing.id };
    await db
      .update(intelRelationships)
      .set({ suppressed: true, suppressedReason: reason, manual: true })
      .where(eq(intelRelationships.id, existing.id));
    invalidateGraphAnalysis();
    return { suppressed: true, relationshipId: existing.id };
  }

  const [created] = await db
    .insert(intelRelationships)
    .values({
      sourceEntityId,
      targetEntityId,
      type: CONFIRMED_EDGE_TYPE,
      label: null,
      confidence: 'high',
      manual: true,
      suppressed: true,
      suppressedReason: reason,
      observationCount: 0,
      weight: 0,
      strength: 'weak',
    })
    .returning({ id: intelRelationships.id });

  invalidateGraphAnalysis();
  return { suppressed: true, relationshipId: created.id };
}
