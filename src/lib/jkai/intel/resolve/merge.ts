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
  findSharedSenderAddresses,
  countIdentitiesByAddress,
  pickSurvivor,
  normaliseName,
  AUTO_MERGE_THRESHOLD,
  type MatchCandidate,
  type ResolvableEntity,
} from './match';
import { invalidateGraphAnalysis } from '../analytics/load';
import { loadDecisions, repointDecisions, type MatchDecision } from './decisions';
import { pairKeyOf as pairKey } from './pair-key';

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
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      aliases: intelEntities.aliases,
      properties: intelEntities.properties,
      summary: intelEntities.summary,
      mergedIntoId: intelEntities.mergedIntoId,
    })
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

    // Learn the loser's name.
    //
    // `intel_entities.aliases` has existed since resolution was built, is read
    // by entity linkification, the ingest preview and lens filters — and was
    // written by NOTHING. On production, after 490 merges, every one of 4,513
    // entities carried an empty array. So the graph forgot each merge the
    // moment it applied it: the surface form that had produced a duplicate was
    // discarded, extraction could fork the same duplicate again the next day,
    // and the matcher had no way to recognise it.
    //
    // Recording it here closes that loop — and is what makes `alias_match` (and
    // alias blocking) able to fire at all.
    const aliases = mergeAliases(keep, merge);

    await tx
      .update(intelEntities)
      .set({
        properties: mergedProps,
        summary: keep.summary ?? merge.summary,
        aliases,
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
        // The survivor's alias list BEFORE this merge, so an unmerge hands back
        // exactly the surface forms it took and leaves earlier ones alone.
        survivorAliasesBefore: asStringArray(keep.aliases),
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

  // Carry the pair verdicts over. Without this, merging B into A orphans every
  // "B is not C" a person ever recorded: the pair B|C can no longer be proposed,
  // A|C has no verdict, and the same question comes back wearing a new name.
  // Outside the transaction and best-effort — bookkeeping must not be able to
  // fail a merge that has already been applied.
  await repointDecisions(keepId, mergeId).catch((err) =>
    console.error('[intel:resolve] could not repoint pair decisions:', err instanceof Error ? err.message : err),
  );

  invalidateGraphAnalysis();
  // Both memos name entities, and one of them is now a tombstone. Stale entries
  // are skipped rather than dangerous, but a sweep immediately after a merge
  // must not re-propose what it has just resolved.
  invalidateResolutionCaches();
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
    .select({ id: intelEntityMerges.id, snapshot: intelEntityMerges.snapshot, survivorId: intelEntityMerges.survivorId })
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
      survivorAliasesBefore?: string[];
    };

    // Hand back the survivor's alias list as it stood before the merge. Without
    // this an undone merge leaves the loser's name recorded as another name for
    // the survivor — which is precisely the claim the undo is retracting, and
    // the matcher would go on acting on it.
    if (Array.isArray(snap.survivorAliasesBefore)) {
      await tx
        .update(intelEntities)
        .set({ aliases: snap.survivorAliasesBefore.filter((a) => typeof a === 'string'), updatedAt: new Date() })
        .where(eq(intelEntities.id, ledger.survivorId));
    }

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

/**
 * Recover the surface forms 490 past merges threw away.
 *
 * Every merge before this change discarded the loser's name — but not the row:
 * the loser survives as a tombstone carrying `merged_into_id` and its original
 * name, so the whole history is recoverable from the graph itself. This unions
 * every tombstone's name into its survivor's alias list.
 *
 * Idempotent, cheap, and safe to run on every sweep: it only writes where the
 * computed list differs from what is stored.
 */
export async function backfillAliasesFromTombstones(
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<{ updated: number; aliasesAdded: number }> {
  const res = await db.execute(sql`
    SELECT
      s.id,
      s.name,
      coalesce(s.aliases, '[]'::jsonb) AS aliases,
      (
        SELECT coalesce(jsonb_agg(t.name), '[]'::jsonb)
        FROM intel_entities t
        WHERE t.merged_into_id = s.id AND t.name IS NOT NULL
      ) AS tombstone_names
    FROM intel_entities s
    WHERE s.merged_into_id IS NULL
      AND EXISTS (SELECT 1 FROM intel_entities t WHERE t.merged_into_id = s.id)
  `);

  let updated = 0;
  let aliasesAdded = 0;

  const rows = res.rows as Array<Record<string, unknown>>;
  let seen = 0;
  for (const row of rows) {
    // One UPDATE per survivor on the first run (490 of them on production), and
    // effectively none afterwards. The nightly engine's heartbeat goes stale at
    // 120s, so a first run has to say it is working.
    opts.onProgress?.(seen++, rows.length);
    const id = String(row.id);
    const name = String(row.name ?? '');
    const current = asStringArray(row.aliases);
    // Reuse the merge rule so a backfilled list and a freshly merged one are
    // built by exactly the same code — including the cap and the "never record
    // the survivor's own name" rule.
    let next = current;
    for (const tombName of asStringArray(row.tombstone_names)) {
      next = mergeAliases({ name, aliases: next }, { name: tombName });
    }
    if (next.length === current.length && next.every((v, i) => v === current[i])) continue;
    aliasesAdded += next.length - current.length;
    await db
      .update(intelEntities)
      .set({ aliases: next, updatedAt: new Date() })
      .where(eq(intelEntities.id, id));
    updated++;
  }

  // The whole reason this runs FIRST in the nightly stage is so the night's
  // matching can use what it recovered. The entity snapshot is memoised for
  // 60s, so without this the sweep two lines later would read a copy taken
  // before the aliases existed and the ordering would buy nothing.
  if (updated) invalidateResolutionCaches();

  return { updated, aliasesAdded };
}

/**
 * How long the resolvable-entity snapshot stays good for.
 *
 * The load is 4,513 rows each carrying a 1536-dimension vector AS TEXT, which
 * is parsed into 6.9 million floats in JS — CPU that blocks the event loop, on
 * a process that is also serving chat. It was tolerable when one page called
 * it; three surfaces now trigger a sweep on a single visit to intel.
 *
 * 60s, matching `getGraphAnalysis`, and dropped outright on every merge. What
 * staleness can cost is an entity created in the last minute not appearing as a
 * duplicate candidate for another minute, which is not a cost anybody can feel.
 *
 * Callers must treat the array as READ-ONLY — it is shared. Nothing in the
 * matcher mutates it.
 */
const ENTITY_CACHE_MS = 60_000;
let entityCache: { at: number; entities: ResolvableEntity[] } | null = null;

/** Drop both memos. Called on every merge. */
export function invalidateResolutionCaches(): void {
  entityCache = null;
  invalidateSemanticPairs();
}

/** Every live entity, in the shape the matcher wants. */
export async function loadResolvableEntities(): Promise<ResolvableEntity[]> {
  if (entityCache && Date.now() - entityCache.at < ENTITY_CACHE_MS) return entityCache.entities;

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
      -- Every surface form the graph has already accepted for this entity. The
      -- matcher went without these for the whole life of the feature, so an
      -- alias recorded by one extraction could not help the next one recognise
      -- the same thing under that name.
      e.aliases                   AS aliases,
      e.summary                   AS summary,
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

  const entities = (res.rows as Array<Record<string, unknown>>).map((r) => {
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
      aliases: asStringArray(r.aliases),
      summary: typeof r.summary === 'string' ? r.summary : null,
    };
  });

  entityCache = { at: Date.now(), entities };
  return entities;
}

/** How many surface forms one entity may accumulate. */
export const MAX_STORED_ALIASES = 24;

/**
 * The survivor's alias list after absorbing the loser.
 *
 * Everything the loser was called — its name and its own aliases — joins
 * everything the survivor was already called, minus anything that normalises
 * onto the survivor's own name (recording "IBCA" as an alias of "IBCA" tells
 * nothing and costs a blocking key).
 *
 * Pure, and exported, because this is the rule that decides what the matcher
 * gets to learn from a merge and it needs testing without a database.
 */
export function mergeAliases(
  keep: { name: string; aliases?: unknown },
  merge: { name: string; aliases?: unknown },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([normaliseName(keep.name)]);
  for (const raw of [...asStringArray(keep.aliases), merge.name, ...asStringArray(merge.aliases)]) {
    const name = raw.trim();
    if (!name) continue;
    const key = normaliseName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_STORED_ALIASES) break;
  }
  return out;
}

/** Same driver caveat as `asProperties`, for a jsonb array of strings. */
function asStringArray(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
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
  /** A standing verdict on this pair. Null when nobody has answered it yet. */
  decision: MatchDecision | null;
}

/**
 * Every display name ever recorded against an email address.
 *
 * Tombstones are INCLUDED on purpose. This is the evidence that an address
 * belongs to a notification service rather than a person, and merging destroys
 * it: fold two names into one and the survivor carries a single name again, so
 * a count over live rows alone can never reach the threshold that would have
 * stopped the merge. The tombstones remember.
 */
export async function loadAddressNames(): Promise<Map<string, string[]>> {
  const res = await db.execute(sql`
    SELECT lower(properties->>'email') AS email, name
    FROM intel_entities
    WHERE properties->>'email' IS NOT NULL AND name IS NOT NULL
  `);

  const out = new Map<string, string[]>();
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const email = String(row.email ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (!email.includes('@') || !name) continue;
    const list = out.get(email);
    if (list) list.push(name);
    else out.set(email, [name]);
  }
  return out;
}

/** Addresses that write as many different people, so cannot prove identity. */
export async function loadSharedSenderAddresses(): Promise<Set<string>> {
  return findSharedSenderAddresses(await loadAddressNames());
}

/** Address → how many distinct identities have written under it. */
export async function loadAddressIdentities(): Promise<Map<string, number>> {
  return countIdentitiesByAddress(await loadAddressNames());
}

/**
 * Entity id → the ids it shares an edge with.
 *
 * Direction is dropped: for "are these the same thing?" it does not matter
 * which way an edge points, only that both sides sit beside the same entities.
 * Suppressed edges are included — a human rejecting a LINK says nothing about
 * whether two other entities are one, and excluding them would quietly weaken
 * the signal every time someone tidied the graph.
 */
export async function loadNeighbourIndex(): Promise<Map<string, Set<string>>> {
  const res = await db.execute(sql`
    SELECT source_entity_id AS a, target_entity_id AS b FROM intel_relationships
  `);
  const out = new Map<string, Set<string>>();
  const add = (x: string, y: string) => {
    if (!x || !y || x === y) return;
    const set = out.get(x);
    if (set) set.add(y);
    else out.set(x, new Set([y]));
  };
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const a = String(row.a ?? '');
    const b = String(row.b ?? '');
    add(a, b);
    add(b, a);
  }
  return out;
}

/**
 * Cosine distance below which two entities are close enough in meaning to be
 * worth comparing at all. 0.28 ≈ 72% similar.
 *
 * This is a BLOCKING threshold, not a matching one: everything it produces is
 * then scored by the ordinary rules and nearly all of it is discarded. Tightening
 * it costs recall; loosening it costs a lot of scoring for nothing.
 */
export const SEMANTIC_BLOCK_DISTANCE = 0.28;
/**
 * The lowest score a pair is scored at all.
 *
 * Every sweep generates down to here regardless of the confidence it is asked
 * to report at, so a decision that RAISES a pair's score has something to raise.
 */
export const CANDIDATE_FLOOR = 0.35;
/** Nearest neighbours to consider per entity. */
export const SEMANTIC_BLOCK_K = 6;
/**
 * What the planner should believe a random page costs on this host.
 *
 * 1.1 is the standard value for solid-state storage, which is what every host
 * here uses. See `$lib/jkai/intel/context.ts`, which carries the full reasoning
 * and applies the same treatment to the chat-turn vector lookups.
 */
const SSD_RANDOM_PAGE_COST = 1.1;

/**
 * Candidate pairs that share no word.
 *
 * Lexical blocking — the only kind the resolver had — can propose two entities
 * only when they share a significant token, an acronym form or an email address.
 * That is a ceiling on what can ever be FOUND, and no amount of improvement to
 * the scoring lifts it: a pair that never meets is never scored.
 *
 * This uses the HNSW index that already exists on `intel_entities.embedding`
 * (built for the chat context lookup) to ask a different question — which
 * entities MEAN nearly the same thing — and hands the answers to the same
 * scorer. Approximate by nature, which is right for a blocking pass.
 */
/**
 * How long a semantic candidate list stays good for.
 *
 * The pass is 3.6s on production even with the planner behaving, and THREE
 * surfaces trigger a sweep — the landing tile, the quality page and the triage
 * hint fetch — so an uncached visit to intel pays for it three times.
 *
 * Safe to cache because of what it IS: a blocking pass. It proposes pairs for
 * scoring; the scoring itself always reads live rows. The only thing five
 * minutes of staleness can cost is an entity embedded in the last five minutes
 * not yet having semantic neighbours — and embeddings are written nightly.
 * Mirrors `getGraphAnalysis`, which caches the whole analysis for 60s for the
 * same reason.
 */
const SEMANTIC_CACHE_MS = 5 * 60_000;
let semanticCache: { key: string; at: number; pairs: Array<[string, string]> } | null = null;

/** Drop the memo. Called on every merge — the pair list names entities. */
export function invalidateSemanticPairs(): void {
  semanticCache = null;
}

export async function loadSemanticPairs(
  opts: { distance?: number; k?: number; limit?: number } = {},
): Promise<Array<[string, string]>> {
  const distance = opts.distance ?? SEMANTIC_BLOCK_DISTANCE;
  const k = Math.max(1, Math.min(20, opts.k ?? SEMANTIC_BLOCK_K));
  const limit = opts.limit ?? 20000;

  const cacheKey = `${distance}|${k}|${limit}`;
  if (semanticCache && semanticCache.key === cacheKey && Date.now() - semanticCache.at < SEMANTIC_CACHE_MS) {
    return semanticCache.pairs;
  }

  // In a transaction ONLY so `SET LOCAL random_page_cost` covers the query and
  // unwinds at commit — safe on a pooled connection, and the same treatment
  // `$lib/jkai/intel/context.ts` gives the chat-turn vector lookups.
  //
  // Without it this is the difference between a feature and an outage.
  // Postgres defaults `random_page_cost` to 4.0, a spinning-disk number; every
  // host here is SSD. The embeddings are TOASTed, so `intel_entities` looks
  // like a cheap 857-page table to the planner while the real work is
  // detoasting 4,500 × 6KB vectors — so the seq scan wins the estimate, the
  // HNSW index sits unused, and the lateral degenerates into 4,513 × 4,513
  // full-dimension distance computations.
  //
  // Measured on production, this exact query, 2026-08-29:
  //   random_page_cost 4.0 → 172,333ms
  //   random_page_cost 1.1 →   3,616ms
  // Same 2,705 pairs out of both.
  const res = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL random_page_cost = ${sql.raw(String(SSD_RANDOM_PAGE_COST))}`);
    return tx.execute(sql`
      SELECT e.id AS a, n.id AS b
      FROM intel_entities e
      CROSS JOIN LATERAL (
        SELECT o.id, (e.embedding <=> o.embedding) AS dist
        FROM intel_entities o
        WHERE o.merged_into_id IS NULL
          AND o.embedding IS NOT NULL
          AND o.id <> e.id
        ORDER BY e.embedding <=> o.embedding
        LIMIT ${k}
      ) n
      WHERE e.merged_into_id IS NULL
        AND e.embedding IS NOT NULL
        AND n.dist < ${distance}
      LIMIT ${limit}
    `);
  });

  // Deduplicated on the unordered pair: nearest-neighbour is not symmetric, so
  // A→B and B→A both appear whenever the two are each other's neighbour.
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const a = String(row.a ?? '');
    const b = String(row.b ?? '');
    if (!a || !b || a === b) continue;
    const key = pairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a, b]);
  }
  semanticCache = { key: cacheKey, at: Date.now(), pairs: out };
  return out;
}

export interface FindDuplicatesOptions {
  /**
   * Include the pgvector nearest-neighbour pass. On by default; the flag exists
   * so a test can hold the matcher to lexical blocking alone.
   */
  semantic?: boolean;
  /**
   * Return pairs a human has already ruled out. Off by default — but the COUNT
   * of what was withheld is always reported, because a filter that quietly
   * swallows its own decisions is indistinguishable from one that is broken.
   */
  includeRuledOut?: boolean;
}

export interface DuplicateSweep {
  reports: DuplicateReport[];
  /** Pairs withheld because a human said they are different. */
  ruledOut: number;
  /** Pairs the adjudicator said are different. Held below the floor, not hidden. */
  adjudicatedApart: number;
  /** Pairs the vector pass contributed that lexical blocking never proposed. */
  semanticPairs: number;
  /** Pairs held back because their names differ only in a number. */
  seriesVariants: number;
}

/** Duplicate candidates across the whole graph, strongest first. */
export async function findDuplicates(
  minConfidence = 0.35,
  opts: FindDuplicatesOptions = {},
): Promise<DuplicateReport[]> {
  return (await sweepDuplicates(minConfidence, opts)).reports;
}

/** The same pass, with the bookkeeping the UI needs to be honest about it. */
export async function sweepDuplicates(
  minConfidence = 0.35,
  opts: FindDuplicatesOptions = {},
): Promise<DuplicateSweep> {
  const useSemantic = opts.semantic !== false;
  const [entities, addressIdentities, neighbours, decisions, extraPairs] = await Promise.all([
    loadResolvableEntities(),
    loadAddressIdentities(),
    loadNeighbourIndex(),
    loadDecisions(),
    useSemantic ? loadSemanticPairs().catch((err) => {
      // A missing index or an unembedded corpus must not take the whole sweep
      // down — lexical blocking still works, and saying so beats a 500.
      console.error('[intel:resolve] semantic blocking unavailable:', err instanceof Error ? err.message : err);
      return [] as Array<[string, string]>;
    }) : Promise.resolve([] as Array<[string, string]>),
  ]);
  const byId = new Map(entities.map((e) => [e.id, e]));

  let ruledOut = 0;
  let adjudicatedApart = 0;
  let seriesVariants = 0;

  // Candidates are generated at the REVIEW floor and filtered at `minConfidence`
  // only after decisions have been applied.
  //
  // Generating at `minConfidence` directly looks equivalent and is not: an
  // adjudicator's "yes, the same thing" LIFTS a pair's score, and the whole
  // point of that lift is to carry a pair that scored 0.80 over the 0.85
  // auto-merge line. Filter first and the pair is gone before the lift can
  // reach it, so the verdict would have been recorded, displayed, and quietly
  // unable to do the one thing it exists for.
  const reports = findDuplicateCandidates(entities, {
    minConfidence: Math.min(minConfidence, CANDIDATE_FLOOR),
    addressIdentities,
    neighbours,
    extraPairs,
  })
    .map((candidate) => {
      const a = byId.get(candidate.aId);
      const b = byId.get(candidate.bId);
      if (!a || !b) return null;

      const decision = decisions.get(pairKey(candidate.aId, candidate.bId));
      let scored = candidate;

      // One series, two members. Counted and withheld rather than dropped
      // silently: the number is shown beside the queue, and lowering the
      // confidence floor brings them back into view.
      //
      // Read AFTER the decision, so a person saying "no, these two really are
      // the same thing" overrules the rule. A guard a human cannot overrule is
      // not a guard, it is a bug with a rationale.
      if (candidate.signals.includes('numeric_variant')) {
        const overruled = decision?.decidedBy === 'human' && decision.verdict === 'same';
        if (!overruled) {
          seriesVariants++;
          if (!opts.includeRuledOut) return null;
        }
      }

      if (decision) {
        if (decision.verdict === 'different') {
          // A person's answer is final; the model's only moves the score.
          if (decision.decidedBy === 'human') {
            ruledOut++;
            if (!opts.includeRuledOut) return null;
          } else {
            adjudicatedApart++;
            scored = { ...candidate, confidence: Math.min(candidate.confidence, 0.2) };
            if (!opts.includeRuledOut) return null;
          }
        } else if (decision.verdict === 'same' && decision.decidedBy !== 'human') {
          // Corroboration, capped: an adjudicator agreeing with the rules can
          // carry a pair over the auto-merge line, but only from a score that
          // was already close to it. It cannot manufacture one from nothing.
          const lift = 0.1 * (decision.verdictConfidence ?? 0.7);
          scored = {
            ...candidate,
            confidence: Math.min(0.95, candidate.confidence + lift),
            signals: [...candidate.signals, 'adjudicated'],
            reason: `${candidate.reason}; adjudicated as the same thing${
              decision.rationale ? ` — ${decision.rationale}` : ''
            }`,
          };
        }
      }

      // The final score is what `minConfidence` is about.
      if (scored.confidence < minConfidence && !opts.includeRuledOut) return null;

      const { keep, merge } = pickSurvivor(a, b);
      return {
        candidate: scored,
        keep,
        merge,
        autoMergeable: scored.confidence >= AUTO_MERGE_THRESHOLD,
        decision: decision ?? null,
      };
    })
    .filter((r): r is DuplicateReport => r !== null)
    .sort((x, y) => y.candidate.confidence - x.candidate.confidence);

  return { reports, ruledOut, adjudicatedApart, semanticPairs: extraPairs.length, seriesVariants };
}

export interface SweepResult {
  candidates: number;
  merged: number;
  skipped: number;
  /** Merges refused because they would have joined two entities nothing matched. */
  chainsBroken: number;
  details: Array<{ keep: string; merge: string; confidence: number }>;
}

/** Order-independent key for a pair of ids. Re-exported; see `./pair-key`. */
export { pairKeyOf as pairKey } from './pair-key';

/**
 * Would merging `mergeId` into `keepId` join two entities nothing ever matched?
 *
 * Returns the offending id, or null when the merge is safe. Pure, because this
 * is the rule that stops single-linkage chaining and it needs testing without
 * a database: A~B and B~C must not silently produce A~C.
 */
export function chainedInto(
  keepId: string,
  mergeId: string,
  absorbed: ReadonlyMap<string, readonly string[]>,
  proposed: ReadonlySet<string>,
): string | null {
  const already = absorbed.get(keepId) ?? [];
  return already.find((id) => !proposed.has(pairKey(id, mergeId))) ?? null;
}

/**
 * Merge every candidate at or above `threshold`.
 *
 * Chains cannot form in the DATA — `mergeEntities` flattens any tombstone that
 * pointed at the loser onto the new survivor — but they could form in the
 * DECISIONS, and that is the more dangerous kind. Merging pairwise down a
 * confidence-ordered list is single-linkage clustering: A matches B and B
 * matches C, so A and C end up as one entity even when nothing ever said they
 * were the same. It is how "IBCA" could have acquired an organisation it shares
 * no name with, through a bridge entity that resembles both.
 *
 * So a merge into a survivor that has already absorbed something is allowed
 * only when the newcomer is ALSO a candidate against everything that survivor
 * took. Anything else is held for review rather than guessed at.
 */
export async function autoMergeDuplicates(
  threshold = AUTO_MERGE_THRESHOLD,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<SweepResult> {
  const reports = (await findDuplicates(threshold)).filter((r) => r.candidate.confidence >= threshold);
  const limit = opts.limit ?? 200;
  const result: SweepResult = { candidates: reports.length, merged: 0, skipped: 0, chainsBroken: 0, details: [] };
  const gone = new Set<string>();
  // Every pair the matcher itself proposed, so a transitive merge can be tested
  // against direct evidence rather than inherited from a neighbour.
  const proposed = new Set(reports.map((r) => pairKey(r.keep.id, r.merge.id)));
  const absorbed = new Map<string, string[]>();

  for (const r of reports.slice(0, limit)) {
    if (gone.has(r.keep.id) || gone.has(r.merge.id)) {
      result.skipped++;
      continue;
    }

    const already = absorbed.get(r.keep.id) ?? [];
    const unmatched = chainedInto(r.keep.id, r.merge.id, absorbed, proposed);
    if (unmatched) {
      console.log(
        `[intel:resolve] holding "${r.merge.name}" — "${r.keep.name}" has already absorbed ` +
          'an entity it does not match',
      );
      result.chainsBroken++;
      continue;
    }
    result.details.push({ keep: r.keep.name, merge: r.merge.name, confidence: r.candidate.confidence });
    if (opts.dryRun) {
      result.merged++;
      gone.add(r.merge.id);
      absorbed.set(r.keep.id, [...already, r.merge.id]);
      continue;
    }
    try {
      await mergeEntities(r.keep.id, r.merge.id);
      gone.add(r.merge.id);
      absorbed.set(r.keep.id, [...already, r.merge.id]);
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
