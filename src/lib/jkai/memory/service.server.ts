import { db, type DbExecutor } from '$lib/db';
import { jkaiMemories, jkaiMemoryEntities } from '$lib/db/schema';
import { and, or, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MemoryProvenance } from './contracts';
import { generateEmbedding } from '$lib/jkai/intel/embed';

export interface MemoryWrite {
  category: string; content: string; confidence?: string; replacesId?: string | null;
  sourceConversationId?: string | null; provenance: MemoryProvenance;
  entityIds?: string[];
  daydreamOrigin?: 'note' | 'ruling' | 'place' | null;
}
const CATEGORIES = new Set(['people', 'preferences', 'places', 'health', 'devices', 'situations', 'patterns']);
/** Explicit identity replaces word-overlap guesses; tombstones suppress re-extraction. */
export async function writeMemory(input: MemoryWrite, executor?: DbExecutor) {
  const content = input.content.trim();
  if (!content || content.length > 12000) throw new Error('Memory content must be 1–12000 characters');
  if (!CATEGORIES.has(input.category)) throw new Error('Unknown memory category');
  for (const date of [input.provenance.validFrom, input.provenance.validUntil]) if (date && !Number.isFinite(Date.parse(date))) throw new Error('Invalid memory validity date');
  if (input.provenance.validFrom && input.provenance.validUntil && Date.parse(input.provenance.validFrom) >= Date.parse(input.provenance.validUntil)) throw new Error('Memory validity must end after it starts');
  const scope = input.daydreamOrigin ? 'daydream' : input.provenance.scope ?? 'personal';
  input = { ...input, provenance: { ...input.provenance, scope, kind: input.provenance.kind ?? (input.category === 'patterns' ? 'procedure' : input.category === 'preferences' ? 'preference' : 'fact') } };
  const work = async (tx: DbExecutor) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`);
    const existing = await tx.select().from(jkaiMemories).where(and(eq(jkaiMemories.category, input.category), sql`coalesce(${jkaiMemories.provenance}->>'scope',case when ${jkaiMemories.daydreamOrigin} IS NOT NULL then 'daydream' else 'personal' end)=${scope}`, sql`lower(${jkaiMemories.content}) = lower(${content})`));
    const forgotten = input.provenance.sourceId || input.sourceConversationId ? await tx.select().from(jkaiMemories).where(and(
      eq(jkaiMemories.category, input.category), eq(jkaiMemories.supersededBy, 'forgotten'),
      sql`coalesce(${jkaiMemories.provenance}->>'scope',case when ${jkaiMemories.daydreamOrigin} IS NOT NULL then 'daydream' else 'personal' end)=${scope}`,
      or(input.provenance.sourceId ? sql`${jkaiMemories.provenance}->>'sourceId' = ${input.provenance.sourceId}` : undefined,
        input.sourceConversationId ? eq(jkaiMemories.sourceConversationId,input.sourceConversationId) : undefined))) : [];
    const sameSource = forgotten[0] ?? existing.find(r => r.supersededBy === 'forgotten' && r.provenance?.sourceId === input.provenance.sourceId);
    if (sameSource && (input.provenance.origin !== 'user' || input.provenance.assertion !== 'stated') && input.provenance.origin !== 'daydream-note') {
      return { ...sameSource, stored: false, suppressed: true };
    }
    const sourceIds = [...new Set(input.provenance.sourceMemoryIds ?? [])];
    if (sourceIds.length) {
      const sources = await tx.select().from(jkaiMemories).where(and(inArray(jkaiMemories.id, sourceIds), isNull(jkaiMemories.supersededBy)));
      if (sources.length !== sourceIds.length || sources.some(r => r.provenance?.validUntil && new Date(r.provenance.validUntil) <= new Date())) {
        throw new Error('Derived memory references an expired, forgotten or superseded source');
      }
    }
    const duplicate = existing.find(r => !r.supersededBy && r.provenance?.origin === input.provenance.origin && r.provenance?.sourceId === input.provenance.sourceId);
    if (duplicate) return { ...duplicate, stored: false, suppressed: false };
    if (input.replacesId) {
      const [old] = await tx.select().from(jkaiMemories).where(and(eq(jkaiMemories.id, input.replacesId), isNull(jkaiMemories.supersededBy))).limit(1);
      if (!old) throw new Error('Replacement memory is no longer current; recall it before updating');
      if ((old.provenance?.scope ?? (old.daydreamOrigin ? 'daydream' : 'personal')) !== scope) throw new Error('Cannot replace a memory in another scope');
      if (old.provenance?.assertion === 'stated' && input.provenance.assertion !== 'stated') throw new Error('An inference cannot replace an explicit statement');
      if (old.category !== input.category) throw new Error('Replacement must retain the memory category');
    }
    if (input.provenance.pinned) {
      const usage = await tx.execute(sql`SELECT coalesce(sum(length(content)+220),0)::int n FROM jkai_memories WHERE superseded_by IS NULL AND provenance->>'pinned'='true' AND id<>${input.replacesId ?? ''}`);
      if (Number(usage.rows[0].n)+content.length+220>3000) throw new Error('Pinned context is full; shorten the correction or unpin a memory');
    }
    const [row] = await tx.insert(jkaiMemories).values({
      category: input.category, content, sourceConversationId: input.sourceConversationId,
      provenance: input.provenance, daydreamOrigin: input.daydreamOrigin,
      confidence: input.provenance.assertion === 'inferred' ? 'medium' : input.confidence ?? 'high',
    }).returning();
    if (input.entityIds?.length) {
      if (scope !== 'personal') throw new Error('Only personal memories join personal graph recall');
      const { setMemoryLinks } = await import('./graph.server');
      await setMemoryLinks(row.id, input.entityIds, tx);
    }
    if (input.replacesId) {
      await tx.update(jkaiMemories).set({ supersededBy: row.id, updatedAt: new Date(), provenance: sql`coalesce(${jkaiMemories.provenance}, '{}'::jsonb) || jsonb_build_object('validUntil', ${input.provenance.validFrom ?? new Date().toISOString()}::text)` }).where(eq(jkaiMemories.id, input.replacesId));
      await invalidateDerived(tx, input.replacesId);
    }
    return { ...row, stored: true, suppressed: false };
  };
  const row = executor ? await work(executor) : await db.transaction(work);
  if (row.stored && !executor) void generateEmbedding(content).then(embedding => db.update(jkaiMemories).set({ embedding }).where(eq(jkaiMemories.id, row.id))).catch(() => {});
  if (row.stored && !executor && !input.entityIds && scope === 'personal') {
    const { linkMemoryAutomatically } = await import('./graph.server');
    await linkMemoryAutomatically(row.id).catch(err => console.warn('[memory] linking deferred', err instanceof Error ? err.message : err));
  }
  return row;
}

export async function forgetMemory(id: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`);
    const [row] = await tx.select().from(jkaiMemories).where(eq(jkaiMemories.id,id));
    if (!row) throw new Error('Memory not found');
    const family = await tx.execute(sql`WITH RECURSIVE replacements AS (
      SELECT id AS source, superseded_by AS target FROM jkai_memories
      WHERE superseded_by IS NOT NULL AND superseded_by <> 'forgotten'
    ), lineage(id) AS (
      SELECT ${id}::text UNION
      SELECT CASE WHEN r.source=l.id THEN r.target ELSE r.source END
      FROM replacements r JOIN lineage l ON r.source=l.id OR r.target=l.id
    ) SELECT id FROM lineage`);
    for (const member of family.rows) {
      await tx.update(jkaiMemories).set({supersededBy:'forgotten',updatedAt:new Date()}).where(eq(jkaiMemories.id,String(member.id)));
      await invalidateDerived(tx,String(member.id));
    }
    await invalidateDerived(tx, id);
    await tx.delete(jkaiMemoryEntities).where(eq(jkaiMemoryEntities.memoryId, id));
    return row;
  });
}

/** Invalidate descendants so a forgotten premise cannot survive through a derived fact. */
async function invalidateDerived(tx: DbExecutor, sourceId: string) {
  await tx.execute(sql`
    with recursive affected(id) as (
      select ${sourceId}::text
      union
      select m.id from jkai_memories m join affected a
        on coalesce(m.provenance->'sourceMemoryIds', '[]'::jsonb) ? a.id
    )
    update jkai_memories set superseded_by = 'forgotten', updated_at = now()
    where id in (select id from affected where id <> ${sourceId})`);
  await tx.execute(sql`DELETE FROM jkai_memory_entities l USING jkai_memories m WHERE l.memory_id=m.id AND m.superseded_by='forgotten'`);
  await tx.execute(sql`UPDATE daydream_memory_themes t SET status='retired' WHERE EXISTS (SELECT 1 FROM daydream_memory_theme_sources s JOIN jkai_memories m ON m.id=s.memory_id WHERE s.theme_id=t.id AND m.superseded_by IS NOT NULL)`);
}

/** Bounded backfill; old facts gain semantic recall without blocking a chat turn. */
export async function backfillMemoryEmbeddings(limit = 20): Promise<number> {
  const rows = await db.select().from(jkaiMemories).where(and(isNull(jkaiMemories.supersededBy), isNull(jkaiMemories.embedding))).limit(limit);
  let count = 0;
  for (const row of rows) {
    try {
      const embedding = await generateEmbedding(row.content);
      await db.update(jkaiMemories).set({ embedding }).where(eq(jkaiMemories.id, row.id));
      count++;
    } catch { break; }
  }
  return count;
}

export async function pinMemory(id: string, pinned: boolean) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`);
    const [row] = await tx.select().from(jkaiMemories).where(and(eq(jkaiMemories.id,id), isNull(jkaiMemories.supersededBy)));
    if (!row || row.daydreamOrigin || (row.provenance?.scope && row.provenance.scope !== 'personal')) throw new Error('Active personal memory not found');
    if (pinned) {
      const usage = await tx.execute(sql`SELECT coalesce(sum(length(content)+220),0)::int n FROM jkai_memories WHERE superseded_by IS NULL AND provenance->>'pinned'='true' AND id<>${id}`);
      if (Number(usage.rows[0].n) + row.content.length + 220 > 3000) throw new Error('Pinned context is full; unpin a memory or shorten this one');
    }
    await tx.update(jkaiMemories).set({ provenance: { ...row.provenance, origin: row.provenance?.origin ?? 'legacy', pinned }, updatedAt: new Date() }).where(eq(jkaiMemories.id,id));
  });
}
