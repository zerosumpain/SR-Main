// Applying a merge — the DB half of entity resolution.
//
// `intel_entities.merged_into_id` already existed but nothing ever wrote to it,
// so duplicates simply accumulated. Merging means: point every reference at the
// survivor, fold the loser's properties in, and leave the loser row in place as
// a tombstone rather than deleting it — the graph loader filters on
// `merged_into_id IS NULL`, so a tombstone disappears from every view while
// still resolving any stale link that names it.
//
// The ENTITY is never destroyed, so a bad merge is reversible with
// `unmergeEntity`. Relationship rows are the exception: an edge that would
// become a self-loop, or that exactly duplicates one the survivor already has
// in the same direction, is deleted rather than moved — keeping them would
// corrupt every degree and centrality figure. Those specific rows do not come
// back on unmerge, and `unmergeEntity` says so.
import { db } from '$lib/db';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
} from '$lib/db/schema';
import {
  findDuplicateCandidates,
  pickSurvivor,
  AUTO_MERGE_THRESHOLD,
  type MatchCandidate,
  type ResolvableEntity,
} from './match';
import { invalidateGraphAnalysis } from '../analytics/load';

export interface MergeOutcome {
  keptId: string;
  mergedId: string;
  relationshipsMoved: number;
  relationshipsDropped: number;
  notesMoved: number;
  timelineMoved: number;
}

/**
 * Merge `mergeId` into `keepId`.
 *
 * Order matters: references are repointed BEFORE the tombstone is written, so a
 * failure part-way leaves both entities live and re-runnable rather than
 * orphaning rows behind a tombstone.
 */
export async function mergeEntities(keepId: string, mergeId: string): Promise<MergeOutcome> {
  if (keepId === mergeId) throw new Error('cannot merge an entity into itself');

  const rows = await db
    .select({ id: intelEntities.id, properties: intelEntities.properties, summary: intelEntities.summary, mergedIntoId: intelEntities.mergedIntoId })
    .from(intelEntities)
    .where(sql`${intelEntities.id} IN (${keepId}, ${mergeId})`);

  const keep = rows.find((r) => r.id === keepId);
  const merge = rows.find((r) => r.id === mergeId);
  if (!keep) throw new Error(`survivor ${keepId} not found`);
  if (!merge) throw new Error(`entity ${mergeId} not found`);
  if (merge.mergedIntoId) throw new Error(`${mergeId} is already merged`);
  // Merging INTO a tombstone would build a chain the graph loader cannot
  // follow — it resolves merged_into_id one level only, so anything pointing at
  // an already-merged entity would silently vanish from every view.
  if (keep.mergedIntoId) {
    throw new Error(`survivor ${keepId} is itself merged into ${keep.mergedIntoId}`);
  }

  // Everything below runs in ONE transaction. The first statement is a DELETE,
  // so without it a failure part-way through would leave edges destroyed and no
  // merge recorded — the one way this operation could lose data irrecoverably.
  const outcome = await db.transaction(async (tx) => {
    // Repoint relationships. Anything that would become a self-loop, or that
    // duplicates an edge the survivor already has, is deleted rather than moved.
    //
    // Duplicate detection is DIRECTION-AWARE. Relationship types here are
    // directed — `reports_to`, `owns`, `blocks` — so "A reports_to B" and
    // "B reports_to A" are different claims, and collapsing them would silently
    // invert or destroy one. Only an edge with the same type AND the same
    // orientation relative to the survivor counts as a duplicate.
    const dropped = await tx.execute(sql`
      DELETE FROM intel_relationships r
      WHERE (r.source_entity_id = ${mergeId} AND r.target_entity_id = ${keepId})
         OR (r.source_entity_id = ${keepId} AND r.target_entity_id = ${mergeId})
         OR (r.source_entity_id = ${mergeId} AND r.target_entity_id = ${mergeId})
         OR (
           (r.source_entity_id = ${mergeId} OR r.target_entity_id = ${mergeId})
           AND EXISTS (
             SELECT 1 FROM intel_relationships e
             WHERE e.id <> r.id
               AND e.type = r.type
               AND (
                 -- r points AWAY from the merged entity → survivor must also
                 -- point away, to the same other end.
                 (r.source_entity_id = ${mergeId}
                    AND e.source_entity_id = ${keepId}
                    AND e.target_entity_id = r.target_entity_id)
                 OR
                 -- r points TOWARD the merged entity → survivor must also be
                 -- the target of the same other end.
                 (r.target_entity_id = ${mergeId}
                    AND e.target_entity_id = ${keepId}
                    AND e.source_entity_id = r.source_entity_id)
               )
           )
         )
    `);

    const movedSource = await tx
      .update(intelRelationships)
      .set({ sourceEntityId: keepId })
      .where(eq(intelRelationships.sourceEntityId, mergeId));
    const movedTarget = await tx
      .update(intelRelationships)
      .set({ targetEntityId: keepId })
      .where(eq(intelRelationships.targetEntityId, mergeId));

    // Note links: move the ones the survivor doesn't already have, delete the rest.
    await tx.execute(sql`
      DELETE FROM intel_note_entities ne
      WHERE ne.entity_id = ${mergeId}
        AND EXISTS (SELECT 1 FROM intel_note_entities k WHERE k.entity_id = ${keepId} AND k.note_id = ne.note_id)
    `);
    const notesMoved = await tx
      .update(intelNoteEntities)
      .set({ entityId: keepId })
      .where(eq(intelNoteEntities.entityId, mergeId));

    const timelineMoved = await tx
      .update(intelTimelineEvents)
      .set({ entityId: keepId })
      .where(eq(intelTimelineEvents.entityId, mergeId));

    // Fold in properties the survivor lacks; never overwrite what it already knows.
    const mergedProps = {
      ...((merge.properties as Record<string, unknown>) ?? {}),
      ...((keep.properties as Record<string, unknown>) ?? {}),
    };

    await tx
      .update(intelEntities)
      .set({
        properties: mergedProps,
        summary: keep.summary ?? merge.summary,
        updatedAt: new Date(),
      })
      .where(eq(intelEntities.id, keepId));

    // Tombstone last.
    await tx
      .update(intelEntities)
      .set({ mergedIntoId: keepId, updatedAt: new Date() })
      .where(eq(intelEntities.id, mergeId));

    // Flatten: re-point anything already tombstoned INTO mergeId at the new
    // survivor, so no chain is ever deeper than one hop.
    //
    // The guard above stops us merging INTO a tombstone, but nothing stopped a
    // SURVIVOR from later becoming a loser — autoMergeDuplicates' skip-set only
    // records losers, so `A → B` followed by `B → C` built a two-level chain.
    // loadSnapshot resolves merged_into_id exactly one hop, so a stale
    // reference to A landed on tombstone B, which is absent from the node set,
    // and buildIndex dropped the edge — defeating the very guarantee the
    // remapping exists to provide. mergeId's own merged_into_id is null
    // (guaranteed above), so this cannot self-match.
    await tx
      .update(intelEntities)
      .set({ mergedIntoId: keepId, updatedAt: new Date() })
      .where(eq(intelEntities.mergedIntoId, mergeId));

    return {
      keptId: keepId,
      mergedId: mergeId,
      relationshipsMoved: rowCount(movedSource) + rowCount(movedTarget),
      relationshipsDropped: rowCount(dropped),
      notesMoved: rowCount(notesMoved),
      timelineMoved: rowCount(timelineMoved),
    };
  });

  invalidateGraphAnalysis();
  return outcome;
}

function rowCount(result: unknown): number {
  const r = result as { rowCount?: number | null; count?: number } | null;
  return Number(r?.rowCount ?? r?.count ?? 0) || 0;
}

/**
 * Undo a merge — the tombstone is cleared and the entity becomes live again.
 *
 * Two things do NOT come back, deliberately:
 *   - Relationships that were repointed stay with the survivor. Which of them
 *     originally belonged to the merged entity is not recorded, and guessing
 *     would be worse than leaving them.
 *   - Edges deleted as exact duplicates or self-loops are gone. They carried no
 *     information the survivor does not already hold.
 * The entity, its properties and its identity return, which is what makes
 * merging safe to try.
 */
export async function unmergeEntity(entityId: string): Promise<void> {
  await db
    .update(intelEntities)
    .set({ mergedIntoId: null, updatedAt: new Date() })
    .where(eq(intelEntities.id, entityId));
  invalidateGraphAnalysis();
}

/** Every live entity, in the shape the matcher wants. */
export async function loadResolvableEntities(): Promise<ResolvableEntity[]> {
  const res = await db.execute(sql`
    SELECT
      e.id,
      e.name,
      e.type_id,
      COALESCE(t.name, 'unknown') AS type_name,
      e.embedding::text           AS embedding,
      COALESCE(d.degree, 0)       AS degree,
      COALESCE(n.note_count, 0)   AS note_count
    FROM intel_entities e
    LEFT JOIN intel_entity_types t ON t.id = e.type_id
    LEFT JOIN (
      SELECT id, COUNT(*)::int AS degree FROM (
        SELECT source_entity_id AS id FROM intel_relationships
        UNION ALL
        SELECT target_entity_id AS id FROM intel_relationships
      ) x GROUP BY id
    ) d ON d.id = e.id
    LEFT JOIN (
      SELECT entity_id, COUNT(*)::int AS note_count FROM intel_note_entities GROUP BY entity_id
    ) n ON n.entity_id = e.id
    WHERE e.merged_into_id IS NULL
  `);

  return (res.rows as Array<Record<string, unknown>>).map((r) => {
    const raw = r.embedding;
    let embedding: number[] | null = null;
    if (typeof raw === 'string' && raw.length > 2) {
      const parsed = raw.replace(/^\[|\]$/g, '').split(',').map(Number);
      if (parsed.every((n) => Number.isFinite(n))) embedding = parsed;
    }
    return {
      id: String(r.id),
      name: String(r.name ?? ''),
      typeId: String(r.type_id ?? ''),
      typeName: String(r.type_name ?? 'unknown'),
      degree: Number(r.degree ?? 0),
      noteCount: Number(r.note_count ?? 0),
      embedding,
    };
  });
}

export interface DuplicateReport {
  candidate: MatchCandidate;
  keep: ResolvableEntity;
  merge: ResolvableEntity;
  /** True when confidence clears the auto-merge bar. */
  autoMergeable: boolean;
}

/** Duplicate candidates across the whole graph, strongest first. */
export async function findDuplicates(minConfidence = 0.35): Promise<DuplicateReport[]> {
  const entities = await loadResolvableEntities();
  const byId = new Map(entities.map((e) => [e.id, e]));

  return findDuplicateCandidates(entities, { minConfidence })
    .map((candidate) => {
      const a = byId.get(candidate.aId);
      const b = byId.get(candidate.bId);
      if (!a || !b) return null;
      const { keep, merge } = pickSurvivor(a, b);
      return { candidate, keep, merge, autoMergeable: candidate.confidence >= AUTO_MERGE_THRESHOLD };
    })
    .filter((r): r is DuplicateReport => r !== null);
}

export interface SweepResult {
  candidates: number;
  merged: number;
  skipped: number;
  details: Array<{ keep: string; merge: string; confidence: number }>;
}

/**
 * Merge every candidate at or above `threshold`.
 *
 * Chains cannot form: `mergeEntities` flattens any existing tombstone that
 * pointed at the loser onto the new survivor. The skip-set below only avoids
 * redundant work — it is NOT what keeps chains one hop deep, because a survivor
 * carries no marker and can legitimately become a loser later in the sweep.
 */
export async function autoMergeDuplicates(
  threshold = AUTO_MERGE_THRESHOLD,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<SweepResult> {
  const reports = (await findDuplicates(threshold)).filter((r) => r.candidate.confidence >= threshold);
  const limit = opts.limit ?? 200;
  const result: SweepResult = { candidates: reports.length, merged: 0, skipped: 0, details: [] };
  const gone = new Set<string>();

  for (const r of reports.slice(0, limit)) {
    if (gone.has(r.keep.id) || gone.has(r.merge.id)) {
      result.skipped++;
      continue;
    }
    result.details.push({ keep: r.keep.name, merge: r.merge.name, confidence: r.candidate.confidence });
    if (opts.dryRun) {
      result.merged++;
      gone.add(r.merge.id);
      continue;
    }
    try {
      await mergeEntities(r.keep.id, r.merge.id);
      gone.add(r.merge.id);
      result.merged++;
    } catch (err) {
      console.error('[intel:resolve] merge failed:', err instanceof Error ? err.message : err);
      result.skipped++;
    }
  }

  if (!opts.dryRun) invalidateGraphAnalysis();
  return result;
}

/** Entities parked under the `concept` fallback, awaiting a real type. */
export async function findUntypedEntities(limit = 100) {
  return db
    .select({ id: intelEntities.id, name: intelEntities.name, summary: intelEntities.summary })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(eq(intelEntityTypes.name, 'concept'), isNull(intelEntities.mergedIntoId)))
    .limit(limit);
}

/**
 * Remove duplicate (note, entity) links left by re-extraction.
 *
 * `intel_note_entities` has two foreign keys and no primary key, so the
 * `.onConflictDoNothing()` that was meant to guard these inserts had no
 * constraint to act on and every re-extraction added another row. Evidence
 * counts derived from this table — the entity card's source count, the
 * thin-evidence detector — were inflated as a result. Keeps the row with the
 * strongest relevance, then the one carrying an excerpt.
 */
export async function dedupeNoteLinks(): Promise<{ removed: number }> {
  const result = await db.execute(sql`
    DELETE FROM intel_note_entities ne
    WHERE ne.ctid NOT IN (
      SELECT ctid FROM (
        SELECT DISTINCT ON (note_id, entity_id) ctid
        FROM intel_note_entities
        ORDER BY note_id, entity_id,
                 (relevance = 'primary') DESC,
                 (excerpt IS NOT NULL) DESC,
                 ctid
      ) keep
    )
  `);
  const removed = rowCount(result);
  if (removed) invalidateGraphAnalysis();
  console.log(`[intel:resolve] removed ${removed} duplicate note-entity links`);
  return { removed };
}

/** Move every entity of one type onto another, then retire the empty type. */
export async function mergeEntityTypes(fromTypeId: string, intoTypeId: string): Promise<number> {
  if (fromTypeId === intoTypeId) return 0;
  const moved = await db
    .update(intelEntities)
    .set({ typeId: intoTypeId, updatedAt: new Date() })
    .where(eq(intelEntities.typeId, fromTypeId));
  await db
    .delete(intelEntityTypes)
    .where(and(eq(intelEntityTypes.id, fromTypeId), ne(intelEntityTypes.id, intoTypeId)));
  invalidateGraphAnalysis();
  return rowCount(moved);
}
