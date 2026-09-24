import { pgTextArray } from '$lib/db/sql-array';
import { db, type DbExecutor } from '$lib/db';
import { jkaiMemories, jkaiMemoryEntities } from '$lib/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { resolveMention } from '$lib/jkai/intel/resolve/ingestion.server';
import { OWNER_INTEL_SCOPE, OWNER_SPACE, type IntelScope } from '$lib/jkai/intel/scope';

/**
 * Keep original entity references: canonical IDs resolve at read time, including after unmerge.
 *
 * A jkai memory is the owner's, so it may only link to entities the owner can
 * see: an id from another space fails the same check as a merged-away one,
 * before anything is replaced.
 */
export async function setMemoryLinks(memoryId: string, entityIds: string[], tx: DbExecutor = db) {
  const ids = [...new Set(entityIds)];
  if (ids.length > 20) throw new Error('A memory may link to at most 20 entities');
  const [memory] = await tx.select().from(jkaiMemories).where(and(eq(jkaiMemories.id,memoryId), isNull(jkaiMemories.supersededBy)));
  if (!memory || memory.daydreamOrigin || (memory.provenance?.scope && memory.provenance.scope !== 'personal')) throw new Error('Active personal memory not found');
  const entities = await tx.execute(sql`SELECT id FROM intel_entities WHERE id=ANY(${pgTextArray(ids)}::text[]) AND merged_into_id IS NULL
    AND space_id = ANY(${pgTextArray(OWNER_INTEL_SCOPE)}::text[])`);
  if (entities.rows.length !== ids.length) throw new Error('One of the entities has changed; reload before linking');
  await tx.delete(jkaiMemoryEntities).where(eq(jkaiMemoryEntities.memoryId,memoryId));
  if (ids.length) await tx.insert(jkaiMemoryEntities).values(ids.map(entityId => ({ memoryId, entityId, method: 'review' })));
  await tx.update(jkaiMemories).set({ provenance: { ...memory.provenance, origin: memory.provenance?.origin ?? 'legacy', linkedAt: new Date().toISOString() } }).where(eq(jkaiMemories.id,memoryId));
}

/**
 * One-hop expansion is bounded and never changes a memory's source or authority.
 *
 * This feeds chat memory recall, so every hop stays inside `intelScope` (the
 * owner's by default): the seeds, the edges walked, and the entities the links
 * point at. A name that only another space knows seeds nothing, and an edge or
 * endpoint in another space is never walked.
 */
export async function graphMemoryIds(query: string, intelScope: IntelScope = OWNER_INTEL_SCOPE) {
  if (!query.trim()) return [] as string[];
  const scope = pgTextArray(intelScope);
  const rows = await db.execute(sql`
    WITH seeds AS (
      SELECT e.id FROM intel_entities e WHERE e.merged_into_id IS NULL AND e.space_id = ANY(${scope}::text[]) AND
        (position(lower(e.name) in lower(${query})) > 0 OR
        EXISTS(SELECT 1 FROM jsonb_array_elements_text(e.aliases) a WHERE length(a)>=3 AND position(lower(a) in lower(${query}))>0))
      ORDER BY length(e.name) DESC LIMIT 8
    ), neighbours AS (
      SELECT r.target_entity_id id FROM intel_relationships r JOIN seeds s ON r.source_entity_id=s.id
        WHERE r.suppressed=false AND r.space_id = ANY(${scope}::text[])
      UNION SELECT r.source_entity_id FROM intel_relationships r JOIN seeds s ON r.target_entity_id=s.id
        WHERE r.suppressed=false AND r.space_id = ANY(${scope}::text[])
      LIMIT 40
    )
    SELECT DISTINCT l.memory_id FROM jkai_memory_entities l JOIN intel_entities e ON e.id=l.entity_id
      WHERE e.space_id = ANY(${scope}::text[])
        AND coalesce(e.merged_into_id,e.id) IN (SELECT id FROM seeds UNION SELECT id FROM neighbours) LIMIT 60`);
  return rows.rows.map(r => String(r.memory_id));
}

/** A memory's entity links, each resolved to its canonical entity — only those `intelScope` can see. */
export async function memoryLinks(memoryIds: string[], intelScope: IntelScope = OWNER_INTEL_SCOPE) {
  if (!memoryIds.length) return [];
  const scope = pgTextArray(intelScope);
  // The survivor join is scoped too: a merge never crosses spaces, but a name
  // this returns must never come from one the reader cannot see.
  const rows = await db.execute(sql`SELECT l.memory_id, e.id AS original_id, coalesce(c.id,e.id) AS id, coalesce(c.name,e.name) AS name, l.method
    FROM jkai_memory_entities l JOIN intel_entities e ON e.id=l.entity_id
    LEFT JOIN intel_entities c ON c.id=e.merged_into_id AND c.space_id = ANY(${scope}::text[])
    WHERE l.memory_id=ANY(${pgTextArray(memoryIds)}::text[]) AND e.space_id = ANY(${scope}::text[])`);
  return rows.rows as {memory_id: string; original_id: string; id: string; name: string; method: string}[];
}

/** Bounded migration of existing memories. Only the shared resolver can auto-link an identity. */
export async function backfillMemoryLinks(limit = 20) {
  const memories = await db.select().from(jkaiMemories).where(and(isNull(jkaiMemories.supersededBy), isNull(jkaiMemories.daydreamOrigin),
    sql`coalesce(${jkaiMemories.provenance}->>'scope','personal')='personal' AND ${jkaiMemories.provenance}->>'linkedAt' IS NULL`)).limit(limit);
  let linked = 0;
  for (const memory of memories) {
    if (await linkMemoryAutomatically(memory.id)) linked++;
  }
  return { considered: memories.length, linked };
}

export async function linkMemoryAutomatically(id: string) {
  const [memory] = await db.select().from(jkaiMemories).where(and(eq(jkaiMemories.id,id),isNull(jkaiMemories.supersededBy),isNull(jkaiMemories.daydreamOrigin)));
  if (!memory || (memory.provenance?.scope && memory.provenance.scope !== 'personal')) return 0;
    const candidates = await db.execute(sql`SELECT e.name, t.name AS type, e.type_id FROM intel_entities e JOIN intel_entity_types t ON t.id=e.type_id
      WHERE e.merged_into_id IS NULL AND e.space_id=${OWNER_SPACE} AND length(e.name)>=3 AND position(lower(e.name) in lower(${memory.content}))>0 ORDER BY length(e.name) DESC LIMIT 12`);
    const ids: string[] = [];
    for (const c of candidates.rows) {
      // A jkai memory is the owner's own, never a member's, so it links only into the owner's space.
      const result = await resolveMention({ name: String(c.name), type: String(c.type), properties: {}, confidence: 'medium', possibleMatchId: null }, String(c.type_id), db, false, OWNER_SPACE);
      if (result.outcome === 'link' && result.entity) ids.push(result.entity.id);
    }
    await db.transaction(async tx => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`); await setMemoryLinks(memory.id, ids, tx); });
    return ids.length;
}
