import { db, type DbExecutor } from '$lib/db';
import { sql } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';
import { resolveFilePolicy, isUnder, folderOf, type FolderSetting } from './source-policy';
import type { CleanupOptions, CleanupResult } from './cleanup-types';

const BATCH_LIMIT = 250;
const SAMPLE_LIMIT = 50;
const GRACE_HOURS = 24;

/** A note with no link is not proof that a handmade entity should be deleted. */
const supported = (excluded: string[]) => sql`(
  EXISTS (SELECT 1 FROM intel_note_entities n WHERE n.entity_id=e.id AND NOT n.note_id=ANY(${pgTextArray(excluded)}::text[]))
  OR EXISTS (SELECT 1 FROM intel_mentions m WHERE m.entity_id=e.id AND NOT m.note_id=ANY(${pgTextArray(excluded)}::text[]) AND m.status <> 'rejected')
  OR EXISTS (SELECT 1 FROM intel_assertions a WHERE a.entity_id=e.id AND a.note_id IS NOT NULL AND NOT a.note_id=ANY(${pgTextArray(excluded)}::text[]) AND a.status NOT IN ('rejected','unsupported'))
)`;

const protectedEntity = sql`(
  e.confirmed OR e.watched OR e.lens IS NOT NULL
  OR EXISTS (SELECT 1 FROM intel_dossier_items d WHERE d.kind='entity' AND d.ref_id=e.id)
  OR EXISTS (SELECT 1 FROM jkai_memory_entities m WHERE m.entity_id=e.id)
  OR EXISTS (SELECT 1 FROM intel_mentions m WHERE m.entity_id=e.id AND m.status='reviewed')
  OR EXISTS (SELECT 1 FROM intel_assertions a WHERE a.entity_id=e.id AND a.note_id IS NULL)
  OR EXISTS (SELECT 1 FROM intel_relationships r WHERE (r.source_entity_id=e.id OR r.target_entity_id=e.id) AND r.manual=true)
)`;

const connected = (excluded: string[]) => sql`EXISTS (
  SELECT 1 FROM intel_relationships r WHERE (r.source_entity_id=e.id OR r.target_entity_id=e.id)
  AND (r.source_note_id IS NULL OR NOT r.source_note_id=ANY(${pgTextArray(excluded)}::text[]))
)`;

/**
 * Reconcile Drive sources and groom unsupported entities without model calls.
 * Preview and apply use the same planner; apply always replans under write locks.
 * Small batches bound lock time. Exceptions roll back the whole batch and reach
 * the caller, so a failed purge cannot be reported as a successful exclusion.
 */
export async function cleanupIntelligence(options: CleanupOptions = {}): Promise<CleanupResult> {
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    // Also blocks ordinary writers that do not participate in advisory locks.
    // No network/model calls occur while holding these locks.
    if (options.apply) await tx.execute(sql`LOCK TABLE workflow_files, drive_folder_settings,
      intel_notes, intel_entities, intel_note_entities, intel_relationships,
      intel_mentions, intel_assertions, intel_dossier_items, jkai_memory_entities
      IN SHARE ROW EXCLUSIVE MODE`);
    else await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);

    const settings = (await tx.execute(sql`SELECT path, intel_mode AS "intelMode", category_ids AS "categoryIds" FROM drive_folder_settings`)).rows as unknown as FolderSetting[];
    const sources = (await tx.execute(sql`
      SELECT n.id, n.title, n.metadata->>'refId' AS ref, f.name
      FROM intel_notes n LEFT JOIN workflow_files f ON f.id=n.metadata->>'refId'
      WHERE n.metadata->>'autoKind'='file' AND n.source <> 'email'
        AND coalesce(n.metadata->>'channel','') <> 'gmail'
        AND coalesce(n.metadata->>'refId','') NOT LIKE 'gmail:%'
      ORDER BY n.created_at, n.id
    `)).rows as Array<{ id: string; title: string | null; ref: string | null; name: string | null }>;
    let stale = sources.filter(n => {
      if (options.noteIds) return options.noteIds.includes(n.id);
      if (options.entityIds) return false;
      if (options.fileIds && !options.fileIds.includes(n.ref ?? '')) return false;
      if (options.pathPrefix !== undefined && (!n.name || !isUnder(folderOf(n.name), options.pathPrefix))) return false;
      return !n.name || !resolveFilePolicy(n.name, settings).included;
    }).map(n => ({ id: n.id, title: n.title ?? n.name ?? 'Untitled source', reason: n.name ? 'Excluded Drive folder' : 'Drive file no longer exists' }));
    if (options.noteIds) {
      stale = (await tx.execute(sql`SELECT id, coalesce(title,'Untitled source') AS title FROM intel_notes WHERE id=ANY(${pgTextArray(options.noteIds)}::text[]) ORDER BY id`)).rows.map(n => ({ id: String(n.id), title: String(n.title), reason: 'Source removed' }));
    }
    const notes = stale.slice(0, BATCH_LIMIT);
    const noteIds = notes.map(n => n.id);
    const noteArray = pgTextArray(noteIds);
    const affected = (await tx.execute(sql`
      SELECT DISTINCT e.id FROM intel_entities e WHERE
        e.first_seen_in=ANY(${noteArray}::text[])
        OR EXISTS (SELECT 1 FROM intel_note_entities n WHERE n.entity_id=e.id AND n.note_id=ANY(${noteArray}::text[]))
        OR EXISTS (SELECT 1 FROM intel_mentions m WHERE m.entity_id=e.id AND m.note_id=ANY(${noteArray}::text[]))
        OR EXISTS (SELECT 1 FROM intel_assertions a WHERE a.entity_id=e.id AND a.note_id=ANY(${noteArray}::text[]))
    `)).rows.map(r => String(r.id));

    // A stale extraction can create an entity before its note link. Only sweep
    // proven extracted nodes after a grace period, with no evidence or edges.
    const scan = options.scanOrphans !== false && !options.noteIds && !options.fileIds && options.pathPrefix === undefined;
    const oldOrphans = scan ? (await tx.execute(sql`
      SELECT e.id FROM intel_entities e WHERE e.merged_into_id IS NULL
        ${options.entityIds ? sql`AND e.id=ANY(${pgTextArray(options.entityIds)}::text[])` : sql``}
        AND e.first_seen_in IS NOT NULL AND e.updated_at < now() - ${GRACE_HOURS} * interval '1 hour'
        AND NOT ${supported(noteIds)} AND NOT ${protectedEntity} AND NOT ${connected(noteIds)}
      ORDER BY e.updated_at, e.id LIMIT ${BATCH_LIMIT + 1}
    `)).rows.map(r => String(r.id)) : [];
    const candidates = [...new Set([...affected, ...oldOrphans.slice(0, BATCH_LIMIT)])];
    const rows = (await tx.execute(sql`
      WITH RECURSIVE doomed_aliases(id) AS (
        SELECT e.id FROM intel_entities e WHERE e.id=ANY(${pgTextArray(candidates)}::text[])
          AND NOT ${supported(noteIds)} AND NOT ${protectedEntity} AND NOT ${connected(noteIds)}
        UNION SELECT e.id FROM intel_entities e JOIN doomed_aliases c ON e.merged_into_id=c.id
          WHERE NOT ${supported(noteIds)} AND NOT ${protectedEntity} AND NOT ${connected(noteIds)}
      ), candidates(id) AS (
        SELECT unnest(${pgTextArray(candidates)}::text[]) UNION SELECT id FROM doomed_aliases
      ) SELECT e.id, e.name, ${supported(noteIds)} AS supported,
        ${protectedEntity} AS protected, ${connected(noteIds)} AS connected
      FROM intel_entities e JOIN candidates c ON c.id=e.id
    `)).rows as Array<{ id: string; name: string; supported: boolean; protected: boolean; connected: boolean }>;
    const doomed = rows.filter(r => !r.supported && !r.protected && !r.connected);
    const doomedIds = doomed.map(r => r.id);
    const survivorIds = affected.filter(id => !doomedIds.includes(id));
    const doomedArray = pgTextArray(doomedIds);
    // Old, unreferenced nodes with lost provenance are reviewable, not disposable.
    const review = scan ? (await tx.execute(sql`
      SELECT e.id, e.name, count(*) OVER()::int AS total FROM intel_entities e
      WHERE e.merged_into_id IS NULL AND e.first_seen_in IS NULL
        ${options.entityIds ? sql`AND e.id=ANY(${pgTextArray(options.entityIds)}::text[])` : sql``}
        AND e.updated_at < now() - ${GRACE_HOURS} * interval '1 hour'
        AND NOT ${supported([])} AND NOT ${protectedEntity} AND NOT ${connected([])}
        AND NOT e.id=ANY(${doomedArray}::text[])
      ORDER BY e.updated_at,e.id LIMIT ${SAMPLE_LIMIT}
    `)).rows as Array<{ id: string; name: string; total: number }> : [];

    const relWhere = sql`(source_note_id=ANY(${noteArray}::text[]) AND manual=false)
      OR source_entity_id=ANY(${doomedArray}::text[]) OR target_entity_id=ANY(${doomedArray}::text[])`;
    const timelineWhere = sql`note_id=ANY(${noteArray}::text[]) OR entity_id=ANY(${doomedArray}::text[])`;
    // Insights about changed shared entities are derived from the old evidence too.
    const insightWhere = sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(entity_ids,'[]'::jsonb)) v WHERE v=ANY(${pgTextArray([...affected, ...doomedIds])}::text[]))`;
    const dossierWhere = sql`(kind='note' AND ref_id=ANY(${noteArray}::text[]))
      OR (kind='entity' AND ref_id=ANY(${doomedArray}::text[]))
      OR (kind='timeline' AND ref_id IN (SELECT id FROM intel_timeline_events WHERE ${timelineWhere}))
      OR (kind='insight' AND ref_id IN (SELECT id FROM intel_insights WHERE ${insightWhere}))`;
    const alertWhere = sql`note_id=ANY(${noteArray}::text[]) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(related_entity_ids,'[]'::jsonb)) v
      WHERE v=ANY(${pgTextArray([...affected,...doomedIds])}::text[]))`;
    const brokenMerges = scan ? (await tx.execute(sql`SELECT e.id FROM intel_entities e
      WHERE e.merged_into_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM intel_entities target WHERE target.id=e.merged_into_id)
      ${options.entityIds ? sql`AND e.id=ANY(${pgTextArray(options.entityIds)}::text[])` : sql``}
      ORDER BY e.id LIMIT ${BATCH_LIMIT + 1}`)).rows.map(e => String(e.id)) : [];
    const count = async (query: ReturnType<typeof sql>) => Number((await tx.execute(query)).rows[0].n);
    const counts: CleanupResult['counts'] = {
      notesRemoved: noteIds.length,
      entitiesRemoved: doomedIds.length,
      entitiesRefreshed: survivorIds.length,
      entitiesProtected: rows.filter(r => r.protected).length,
      relationshipsRemoved: await count(sql`SELECT count(*) AS n FROM intel_relationships WHERE ${relWhere}`),
      timelineEventsRemoved: await count(sql`SELECT count(*) AS n FROM intel_timeline_events WHERE ${timelineWhere}`),
      dossierItemsRemoved: await count(sql`SELECT count(*) AS n FROM intel_dossier_items WHERE ${dossierWhere}`),
      insightsRemoved: await count(sql`SELECT count(*) AS n FROM intel_insights WHERE ${insightWhere}`),
      alertsRemoved: await count(sql`SELECT count(*) AS n FROM intel_alerts WHERE ${alertWhere}`),
      brokenMergesRestored: Math.min(BATCH_LIMIT, brokenMerges.length),
      reviewRequired: review[0]?.total ?? 0,
      remaining: Math.max(0, stale.length - notes.length) + Math.max(0, oldOrphans.length - BATCH_LIMIT) + Math.max(0, brokenMerges.length - BATCH_LIMIT),
    };
    if (options.apply) {
      await tx.execute(sql`DELETE FROM intel_relationships WHERE ${relWhere}`);
      await tx.execute(sql`DELETE FROM intel_dossier_items WHERE ${dossierWhere}`);
      await tx.execute(sql`DELETE FROM intel_timeline_events WHERE ${timelineWhere}`);
      await tx.execute(sql`DELETE FROM intel_alerts WHERE ${alertWhere}`);
      await tx.execute(sql`DELETE FROM intel_insights WHERE ${insightWhere}`);
      await tx.execute(sql`DELETE FROM intel_notes WHERE id=ANY(${noteArray}::text[])`);
      await tx.execute(sql`DELETE FROM intel_entities WHERE id=ANY(${doomedArray}::text[])`);
      await refreshSurvivors(tx, survivorIds);
      // Preserve a live merge history only while its survivor exists.
      await tx.execute(sql`UPDATE intel_entities SET merged_into_id=NULL, updated_at=now()
        WHERE merged_into_id=ANY(${doomedArray}::text[]) OR id=ANY(${pgTextArray(brokenMerges.slice(0, BATCH_LIMIT))}::text[])`);
    }
    return { applied: !!options.apply, notes: notes.slice(0, SAMPLE_LIMIT), entities: doomed.slice(0, SAMPLE_LIMIT).map(({id,name})=>({id,name})), review: review.map(({id,name})=>({id,name})), counts };
  });
  if (options.apply) {
    const [{ invalidateGraphAnalysis }, { invalidateResolutionCaches }] = await Promise.all([
      import('./analytics/load'), import('./resolve/merge'),
    ]);
    invalidateGraphAnalysis();
    invalidateResolutionCaches();
  }
  return result;
}

/** Rebuild derived fields using surviving assertions and quoted evidence. */
async function refreshSurvivors(tx: DbExecutor, ids: string[]): Promise<void> {
  for (const id of ids) {
    const assertions = (await tx.execute(sql`SELECT predicate,value,note_id,status FROM intel_assertions
      WHERE entity_id=${id} AND status NOT IN ('rejected','unsupported')
      ORDER BY (note_id IS NULL), created_at,id`)).rows;
    let properties: Record<string, unknown> = {};
    let ownerProperties: Record<string, unknown> | undefined;
    let manualSummary: string | null | undefined;
    const claims = new Map<string, typeof assertions>();
    for (const a of assertions) {
      const key = String(a.predicate);
      if (key === '$owner-properties' && a.note_id === null && a.value && typeof a.value === 'object' && !Array.isArray(a.value)) ownerProperties = a.value as Record<string, unknown>;
      else if (key === '$owner-summary' && a.note_id === null) manualSummary = typeof a.value === 'string' ? a.value : null;
      else if (!['__proto__','constructor','prototype'].includes(key) && !key.startsWith('$owner-')) {
        const group = claims.get(key) ?? [];
        group.push(a);
        claims.set(key, group);
      }
    }
    for (const [predicate, group] of claims) {
      const owner = group.filter(a => a.note_id === null || a.status === 'accepted').at(-1);
      const distinct = new Set(group.map(a => JSON.stringify(a.value)));
      const observed = group.filter(a => a.status !== 'conflict');
      if (owner) properties[predicate] = owner.value;
      else if (distinct.size === 1) {
        properties[predicate] = group[0].value;
        // The competing source has gone. A now-uncontested claim no longer
        // needs to stay in the conflict queue against a deleted value.
        await tx.execute(sql`UPDATE intel_assertions SET status='observed'
          WHERE entity_id=${id} AND predicate=${predicate} AND status='conflict'`);
      } else if (observed.length && new Set(observed.map(a => JSON.stringify(a.value))).size === 1) {
        properties[predicate] = observed[0].value;
      }
    }
    if (ownerProperties) properties = ownerProperties;
    const evidence = (await tx.execute(sql`SELECT DISTINCT n.id, ne.excerpt, n.observed_at, n.created_at
      FROM intel_note_entities ne JOIN intel_notes n ON n.id=ne.note_id
      WHERE ne.entity_id=${id} AND n.graph_state='admitted'
      ORDER BY n.observed_at DESC NULLS LAST,n.created_at DESC,n.id LIMIT 3`)).rows;
    const summary = manualSummary !== undefined ? manualSummary : [...new Set(evidence.map(e => e.excerpt).filter((e): e is string => typeof e === 'string' && !!e.trim()))].join('\n\n').slice(0, 1600) || null;
    await tx.execute(sql`UPDATE intel_entities SET properties=${JSON.stringify(properties)}::jsonb,
      summary=${summary}, embedding=NULL, confidence_score=NULL,
      corroboration=(SELECT count(DISTINCT note_id)::int FROM intel_note_entities WHERE entity_id=${id}),
      first_seen_in=coalesce(first_seen_in,${evidence[0]?.id ?? null}), updated_at=now()
      WHERE id=${id}`);
  }
}
