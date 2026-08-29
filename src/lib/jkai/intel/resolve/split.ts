// Splitting an entity — the inverse of `mergeEntities`, and the repair for
// CONFLATION.
//
// Merging exists because extraction produces the same thing twice. This exists
// because extraction produces two things once: a relation gets hung on whatever
// noun was nearest, and a place quietly becomes a stand-in for the person,
// household, system or team associated with it. Measured on the live graph
// (2026-08-29):
//
//   Darlington  location, 94 edges — `has_credit_card`, `owns_pet`, `uses_bank`,
//               `insured_by`, `parent_of → Jemima`. The town had acquired the
//               operator's bank accounts, his pets and his daughter.
//   Home        location, 81 edges — the house, the Home Assistant install and
//               the household, as one node.
//   England     location, 10 edges — 6 about the country, 4 about the football
//               team (`coaches`, `defeated`, `participates_in`, `reports_on`).
//
// A conflated hub is worse than a duplicate. A duplicate splits attention; a
// conflated hub INVENTS ADJACENCY, joining every neighbourhood that mentions the
// place. England is why an eBay order for a Dell micro PC clustered with the 2026
// World Cup: `ebay.co.uk registered_in England` and `England defeated Latvia`
// are the same node.
//
// WHAT MOVES IS EDGES, NOT THE ENTITY. The conflated row stays exactly where it
// is and keeps everything not named in the plan — this is not a deletion and not
// a rename. Most repairs re-point onto an entity that ALREADY EXISTS (`John` is
// already in the graph, so Darlington's bank cards do not need a new node);
// creating one is for the referent nothing has named yet, like the football team.
//
// The ledger lives in the DATASTORE rather than `intel_entity_merges`. Reusing
// that table looked tempting — same shape, undo already written — but
// `unmergeEntity` resolves by `merged_id` and takes the most recent row, so a
// split filed against Darlington would be handed to the next genuine unmerge of
// Darlington and replayed as if it were one. Same house rule the other engines
// follow (see ../cluster-store, ../channel-artefacts, ../run-log): engine state
// in the datastore, no schema change, no `drizzle-kit push` prompt on release.
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { ensureCollection, upsertRecord, queryRecords, getRecordByKey } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import { invalidateGraphAnalysis } from '../analytics/load';

export const SYSTEM_ACTOR = 'system';

/** Pinned — renaming this orphans every split's undo record. */
export const INTEL_SPLITS_COLLECTION = 'intel_entity_splits';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner'],
};

/** Which end of a relationship pointed at the entity being split. */
export type Endpoint = 'source' | 'target';

export interface MovedEdge {
  id: string;
  role: Endpoint;
}

export interface SplitPlan {
  /** The conflated entity. It survives, minus the edges named here. */
  fromId: string;
  /**
   * Where the edges belong. An existing entity wherever one exists — the whole
   * point of most repairs is that the right node is already in the graph.
   */
  to: { entityId: string } | { name: string; typeId: string };
  /** The relationships to move. Anything not listed stays put. */
  relationshipIds: string[];
  /** Why, in the operator's words. Shown in the ledger. */
  reason: string;
}

export interface SplitOutcome {
  key: string;
  fromId: string;
  toId: string;
  /** True when `to` named an entity that did not exist yet. */
  createdEntity: boolean;
  moved: number;
  /** Edges dropped rather than moved — see `splitEntity`. */
  dropped: number;
  notesLinked: number;
}

function rowCount(result: unknown): number {
  const n = (result as { rowCount?: number; rows?: unknown[] })?.rowCount;
  if (typeof n === 'number') return n;
  return ((result as { rows?: unknown[] })?.rows ?? []).length;
}

export async function ensureSplitCollection(): Promise<void> {
  await ensureCollection(
    INTEL_SPLITS_COLLECTION,
    {
      name: 'Intel Entity Splits',
      description:
        'One record per conflation repair — which edges moved off which entity, onto what, and enough to put them back.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

/**
 * Move a named set of relationships off a conflated entity.
 *
 * Order matters the same way it does in `mergeEntities`: the target is resolved
 * or created first, then edges are re-pointed, then the ledger is written. A
 * failure part-way leaves both entities live and the operation re-runnable.
 *
 * An edge is DROPPED rather than moved when re-pointing would make it a
 * self-loop (`John based_in Darlington` moved onto John) or an exact duplicate of
 * one the target already holds in the same direction. Keeping either would
 * corrupt every degree and centrality figure — the identical rule, and the
 * identical reason, as the merge path. Dropped rows are recorded in the ledger
 * with the endpoint they had, so `undoSplit` can put them back.
 */
export async function splitEntity(plan: SplitPlan): Promise<SplitOutcome> {
  if (!plan.relationshipIds.length) throw new Error('a split must move at least one relationship');

  const [from] = (
    await db.execute(sql`
      SELECT id, name, first_seen_in FROM intel_entities WHERE id = ${plan.fromId}
    `)
  ).rows as Array<{ id: string; name: string; first_seen_in: string | null }>;
  if (!from) throw new Error(`no such entity: ${plan.fromId}`);

  let toId: string;
  let createdEntity = false;
  if ('entityId' in plan.to) {
    const [target] = (
      await db.execute(sql`SELECT id FROM intel_entities WHERE id = ${plan.to.entityId}`)
    ).rows as Array<{ id: string }>;
    if (!target) throw new Error(`no such entity: ${plan.to.entityId}`);
    toId = target.id;
  } else {
    const [made] = (
      await db.execute(sql`
        INSERT INTO intel_entities (name, type_id, confidence, confirmed, first_seen_in)
        VALUES (${plan.to.name}, ${plan.to.typeId}, 'medium', true, ${from.first_seen_in})
        RETURNING id
      `)
    ).rows as Array<{ id: string }>;
    toId = made.id;
    createdEntity = true;
  }
  if (toId === plan.fromId) throw new Error('cannot split an entity onto itself');

  const ids = sql`ARRAY[${sql.join(
    plan.relationshipIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;

  const edges = (
    await db.execute(sql`
      SELECT id, source_entity_id, target_entity_id, type, source_note_id
      FROM intel_relationships
      WHERE id = ANY(${ids})
    `)
  ).rows as Array<{
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    type: string;
    source_note_id: string | null;
  }>;

  const moved: MovedEdge[] = [];
  const dropped: MovedEdge[] = [];
  let notesLinked = 0;

  await db.transaction(async (tx) => {
    for (const edge of edges) {
      const role: Endpoint | null =
        edge.source_entity_id === plan.fromId
          ? 'source'
          : edge.target_entity_id === plan.fromId
            ? 'target'
            : null;
      // Silently skipped rather than thrown: a plan is written against a
      // snapshot of the graph, and an edge that has since been re-pointed or
      // merged away is not a reason to abandon the other forty.
      if (!role) continue;

      const otherEnd = role === 'source' ? edge.target_entity_id : edge.source_entity_id;
      const nextSource = role === 'source' ? toId : edge.source_entity_id;
      const nextTarget = role === 'target' ? toId : edge.target_entity_id;

      const selfLoop = otherEnd === toId;
      const duplicate =
        !selfLoop &&
        ((
          await tx.execute(sql`
            SELECT 1 FROM intel_relationships
            WHERE source_entity_id = ${nextSource}
              AND target_entity_id = ${nextTarget}
              AND type = ${edge.type}
              AND id <> ${edge.id}
            LIMIT 1
          `)
        ).rows.length > 0);

      if (selfLoop || duplicate) {
        await tx.execute(sql`DELETE FROM intel_relationships WHERE id = ${edge.id}`);
        dropped.push({ id: edge.id, role });
        continue;
      }

      await tx.execute(
        role === 'source'
          ? sql`UPDATE intel_relationships SET source_entity_id = ${toId} WHERE id = ${edge.id}`
          : sql`UPDATE intel_relationships SET target_entity_id = ${toId} WHERE id = ${edge.id}`,
      );
      moved.push({ id: edge.id, role });
    }

    // The evidence follows the edges. Without this the target is an entity with
    // no note links at all, which `resolveEntitySources` reports as sourceless —
    // so it would vanish from every source-filtered view the moment it was
    // created, having just been given real edges.
    const noteIds = [...new Set(edges.map((e) => e.source_note_id).filter((n): n is string => !!n))];
    for (const noteId of noteIds) {
      const res = await tx.execute(sql`
        INSERT INTO intel_note_entities (note_id, entity_id, relevance)
        SELECT ${noteId}, ${toId}, 'mentioned'
        WHERE NOT EXISTS (
          SELECT 1 FROM intel_note_entities
          WHERE note_id = ${noteId} AND entity_id = ${toId}
        )
      `);
      notesLinked += rowCount(res);
    }
  });

  await ensureSplitCollection();
  const key = `${plan.fromId}:${Date.now().toString(36)}`;
  await upsertRecord(
    INTEL_SPLITS_COLLECTION,
    {
      key,
      data: {
        key,
        fromId: plan.fromId,
        fromName: from.name,
        toId,
        createdEntity,
        reason: plan.reason,
        moved,
        dropped,
        at: new Date().toISOString(),
        undoneAt: null,
      },
    },
    SYSTEM_ACTOR,
  );

  invalidateGraphAnalysis();
  return {
    key,
    fromId: plan.fromId,
    toId,
    createdEntity,
    moved: moved.length,
    dropped: dropped.length,
    notesLinked,
  };
}

/**
 * Put a split back.
 *
 * Re-points the moved edges and recreates the dropped ones is NOT what this
 * does: a dropped edge was deleted because it would have been a self-loop or a
 * duplicate, and the row is gone. It is listed in the ledger so the record is
 * honest about what cannot come back — the same admission `unmergeEntity` makes.
 * An entity created by the split is left in place, tombstone-free but edgeless;
 * deleting it here would take any edge added since with it.
 */
export async function undoSplit(key: string): Promise<{ restored: number; dropped: number }> {
  await ensureSplitCollection();
  // By key, not a jsonb filter. `queryRecords` silently ignores an option it does
  // not know, so a mistyped filter does not fail — it returns the FIRST record in
  // the collection and undoes somebody else's split.
  const row = await getRecordByKey(INTEL_SPLITS_COLLECTION, key, SYSTEM_ACTOR).catch(() => null);
  const record = row?.data as
    | { fromId: string; moved: MovedEdge[]; dropped: MovedEdge[]; undoneAt: string | null }
    | undefined;
  if (!record) throw new Error(`no such split: ${key}`);
  if (record.undoneAt) return { restored: 0, dropped: record.dropped?.length ?? 0 };

  let restored = 0;
  await db.transaction(async (tx) => {
    for (const edge of record.moved ?? []) {
      const res = await tx.execute(
        edge.role === 'source'
          ? sql`UPDATE intel_relationships SET source_entity_id = ${record.fromId} WHERE id = ${edge.id}`
          : sql`UPDATE intel_relationships SET target_entity_id = ${record.fromId} WHERE id = ${edge.id}`,
      );
      restored += rowCount(res);
    }
  });

  await upsertRecord(
    INTEL_SPLITS_COLLECTION,
    { key, data: { ...record, undoneAt: new Date().toISOString() } },
    SYSTEM_ACTOR,
  );
  invalidateGraphAnalysis();
  return { restored, dropped: record.dropped?.length ?? 0 };
}

/** Every split on record, newest first. */
export async function listSplits(): Promise<
  Array<{ key: string; fromName: string; toId: string; reason: string; at: string; undoneAt: string | null }>
> {
  await ensureSplitCollection();
  const { records } = await queryRecords(
    INTEL_SPLITS_COLLECTION,
    { limit: 200, sort: { path: 'at', dir: 'desc' } },
    SYSTEM_ACTOR,
  );
  return records.map((r) => r.data as never);
}
