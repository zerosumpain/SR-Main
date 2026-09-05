import { db, type DbExecutor } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MemoryProvenance } from './contracts';
import { generateEmbedding } from '$lib/jkai/intel/embed';

export interface MemoryWrite {
  category: string; content: string; confidence?: string; replacesId?: string | null;
  sourceConversationId?: string | null; provenance: MemoryProvenance;
  daydreamOrigin?: 'note' | 'ruling' | 'place' | null;
}
const CATEGORIES = new Set(['people', 'preferences', 'places', 'health', 'devices', 'situations', 'patterns']);
/** Explicit identity replaces word-overlap guesses; tombstones suppress re-extraction. */
export async function writeMemory(input: MemoryWrite, executor?: DbExecutor) {
  const content = input.content.trim();
  if (!content || content.length > 12000) throw new Error('Memory content must be 1–12000 characters');
  if (!CATEGORIES.has(input.category)) throw new Error('Unknown memory category');
  const work = async (tx: DbExecutor) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`);
    const existing = await tx.select().from(jkaiMemories).where(and(eq(jkaiMemories.category, input.category), sql`lower(${jkaiMemories.content}) = lower(${content})`));
    const sameSource = existing.find(r => r.supersededBy === 'forgotten' && r.provenance?.sourceId === input.provenance.sourceId);
    if (sameSource && input.provenance.origin !== 'user' && input.provenance.origin !== 'daydream-note') {
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
      if (old.category !== input.category) throw new Error('Replacement must retain the memory category');
    }
    const [row] = await tx.insert(jkaiMemories).values({
      category: input.category, content, sourceConversationId: input.sourceConversationId,
      provenance: input.provenance, daydreamOrigin: input.daydreamOrigin,
      confidence: input.provenance.assertion === 'inferred' ? 'medium' : input.confidence ?? 'high',
    }).returning();
    if (input.replacesId) {
      await tx.update(jkaiMemories).set({ supersededBy: row.id, updatedAt: new Date() }).where(eq(jkaiMemories.id, input.replacesId));
      await invalidateDerived(tx, input.replacesId);
    }
    return { ...row, stored: true, suppressed: false };
  };
  const row = executor ? await work(executor) : await db.transaction(work);
  if (row.stored && !executor) void generateEmbedding(content).then(embedding => db.update(jkaiMemories).set({ embedding }).where(eq(jkaiMemories.id, row.id))).catch(() => {});
  return row;
}

export async function forgetMemory(id: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`);
    const [row] = await tx.update(jkaiMemories).set({ supersededBy: 'forgotten', updatedAt: new Date() }).where(eq(jkaiMemories.id, id)).returning();
    if (!row) throw new Error('Memory not found');
    await invalidateDerived(tx, id);
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
    where id in (select id from affected where id <> ${sourceId}) and superseded_by is null`);
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
