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
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
  intelEntityMerges,
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
export async function mergeEntities(
  keepId: string,
  mergeId: string,
  opts: { method?: 'auto' | 'manual'; score?: number; reason?: string } = {},
): Promise<MergeOutcome> {
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

    // Captured BEFORE repointing, with WHICH endpoint pointed at the merged
    // entity: afterwards the row is indistinguishable from one the survivor
    // always had, and an edge can legitimately have the survivor at its other
    // end. Without the role, an unmerge cannot know which end to give back.
    const movedRelRows = await tx
      .select({
        id: intelRelationships.id,
        source: intelRelationships.sourceEntityId,
        target: intelRelationships.targetEntityId,
      })
      .from(intelRelationships)
      .where(
        sql`${intelRelationships.sourceEntityId} = ${mergeId} OR ${intelRelationships.targetEntityId} = ${mergeId}`,
      );
    const movedRelIds = movedRelRows.map((r) => ({
      id: r.id,
      role: r.source === mergeId ? ('source' as const) : ('target' as const),
    }));
    const movedNoteIds = await tx
      .select({ noteId: intelNoteEntities.noteId })
      .from(intelNoteEntities)
      .where(eq(intelNoteEntities.entityId, mergeId));
    const movedTimelineIds = await tx
      .select({ id: intelTimelineEvents.id })
      .from(intelTimelineEvents)
      .where(eq(intelTimelineEvents.entityId, mergeId));

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

    // Ledger entry, written inside the same transaction so it can never
    // disagree with what actually happened. `unmergeEntity` replays it, which
    // is what makes a resolution decision genuinely reversible months later
    // rather than merely "the tombstone is cleared".
    await tx.insert(intelEntityMerges).values({
      survivorId: keepId,
      mergedId: mergeId,
      method: opts.method ?? 'manual',
      score: opts.score ?? null,
      reason: opts.reason ?? null,
      snapshot: {
        merged: { id: mergeId, properties: merge.properties ?? null, summary: merge.summary ?? null },
        // The edges and note links repointed by THIS merge, so an unmerge can
        // hand back exactly what it took and nothing else.
        movedRelationships: movedRelIds,
        movedNoteIds: movedNoteIds.map((r) => r.noteId),
        movedTimelineIds: movedTimelineIds.map((r) => r.id),
      },
    });

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
 * Undo a merge by REPLAYING its ledger entry.
 *
 * Clearing the tombstone alone handed back an entity stripped of every
 * connection — reversible on paper, useless in practice. The ledger records
 * exactly which relationships (and which endpoint of each), note links and
 * timeline events this merge took, so an unmerge returns precisely those and
 * leaves everything the survivor already had alone.
 *
 * One thing still does not come back: edges deleted as exact same-direction
 * duplicates or self-loops. They carried no information the survivor does not
 * already hold.
 *
 * Merges predating the ledger unmerge as before — tombstone cleared, edges
 * stay with the survivor.
 */
export async function unmergeEntity(entityId: string): Promise<{ restored: number }> {
  // Replay the ledger entry rather than just clearing the tombstone. Without
  // this, an unmerge handed back an entity with none of its connections —
  // technically reversible, practically useless.
  const [ledger] = await db
    .select({ id: intelEntityMerges.id, snapshot: intelEntityMerges.snapshot })
    .from(intelEntityMerges)
    .where(and(eq(intelEntityMerges.mergedId, entityId), isNull(intelEntityMerges.undoneAt)))
    .orderBy(desc(intelEntityMerges.createdAt))
    .limit(1);

  let restored = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(intelEntities)
      .set({ mergedIntoId: null, updatedAt: new Date() })
      .where(eq(intelEntities.id, entityId));

    if (!ledger) return;
    const snap = (ledger.snapshot ?? {}) as {
      merged?: { properties?: unknown; summary?: string | null };
      movedRelationships?: Array<{ id: string; role: 'source' | 'target' }>;
      movedNoteIds?: string[];
      movedTimelineIds?: string[];
    };

    // Give back exactly the rows this merge took, identified by the ids
    // captured before they were repointed. Rows the survivor already had are
    // untouched, because they were never in the snapshot.
    // Restore only the endpoint that originally pointed at the merged entity.
    for (const rel of snap.movedRelationships ?? []) {
      const res =
        rel.role === 'source'
          ? await tx.execute(sql`
              UPDATE intel_relationships SET source_entity_id = ${entityId}
              WHERE id = ${rel.id} AND source_entity_id <> ${entityId}
            `)
          : await tx.execute(sql`
              UPDATE intel_relationships SET target_entity_id = ${entityId}
              WHERE id = ${rel.id} AND target_entity_id <> ${entityId}
            `);
      restored += rowCount(res);
    }

    const noteIds = snap.movedNoteIds ?? [];
    if (noteIds.length) {
      const res = await tx.execute(sql`
        UPDATE intel_note_entities SET entity_id = ${entityId}
        WHERE note_id = ANY(${sql`ARRAY[${sql.join(noteIds.map((n) => sql`${n}`), sql`, `)}]::text[]`})
          AND entity_id <> ${entityId}
          AND NOT EXISTS (
            SELECT 1 FROM intel_note_entities k
            WHERE k.entity_id = ${entityId} AND k.note_id = intel_note_entities.note_id
          )
      `);
      restored += rowCount(res);
    }

    const timelineIds = snap.movedTimelineIds ?? [];
    if (timelineIds.length) {
      const res = await tx.execute(sql`
        UPDATE intel_timeline_events SET entity_id = ${entityId}
        WHERE id = ANY(${sql`ARRAY[${sql.join(timelineIds.map((t) => sql`${t}`), sql`, `)}]::text[]`})
      `);
      restored += rowCount(res);
    }

    await tx
      .update(intelEntityMerges)
      .set({ undoneAt: new Date() })
      .where(eq(intelEntityMerges.id, ledger.id));
  });

  invalidateGraphAnalysis();
  return { restored };
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
      -- Carries the email address for anyone the Gmail sweep created. Without
      -- it the exact-address match signal can never fire.
      e.properties                AS properties,
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
      properties: asProperties(r.properties),
    };
  });
}

/** jsonb comes back either parsed or as a string, depending on the driver path. */
function asProperties(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
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

/**
 * Admit a proposed type into the taxonomy. Until this runs, extraction can
 * neither offer it to the model nor assign it, so nothing accumulates under a
 * type nobody has looked at.
 */
export async function admitProposedType(typeId: string): Promise<{ name: string }> {
  const [row] = await db
    .update(intelEntityTypes)
    .set({ status: 'active' })
    .where(eq(intelEntityTypes.id, typeId))
    .returning({ name: intelEntityTypes.name });
  invalidateGraphAnalysis();
  return { name: row?.name ?? '' };
}

/**
 * Reject a proposed type. With `intoTypeId` its entities are re-typed onto the
 * type it should have been; without one it is simply retired. Retired rather
 * than deleted so the same name cannot be re-proposed on the next ingest and
 * quietly reappear.
 */
export async function rejectProposedType(
  typeId: string,
  intoTypeId?: string,
): Promise<{ moved: number }> {
  let moved = 0;
  if (intoTypeId && intoTypeId !== typeId) {
    const res = await db
      .update(intelEntities)
      .set({ typeId: intoTypeId, updatedAt: new Date() })
      .where(eq(intelEntities.typeId, typeId));
    moved = rowCount(res);
  }
  await db
    .update(intelEntityTypes)
    .set({ status: 'retired', mergedIntoTypeId: intoTypeId ?? null })
    .where(eq(intelEntityTypes.id, typeId));
  invalidateGraphAnalysis();
  return { moved };
}

/** Types awaiting a decision, with how many entities are already waiting on them. */
export async function listProposedTypes() {
  const res = await db.execute(sql`
    SELECT t.id, t.name, t.icon, t.description, t.proposed_rationale AS rationale,
           (SELECT count(*)::int FROM intel_entities e WHERE e.type_id = t.id) AS entity_count
    FROM intel_entity_types t
    WHERE t.status = 'proposed'
    ORDER BY t.created_at DESC
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    icon: String(r.icon ?? '🔷'),
    description: String(r.description ?? ''),
    rationale: r.rationale == null ? null : String(r.rationale),
    entityCount: Number(r.entity_count ?? 0),
  }));
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
