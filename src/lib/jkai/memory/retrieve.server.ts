import { graphMemoryIds, memoryLinks } from './graph.server';
import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { and, desc, eq, isNull, or, sql, inArray } from 'drizzle-orm';
import { generateEmbedding } from '$lib/jkai/intel/embed';
import { memoryScore } from './contracts';

/** Lexical recall is always available; semantic recall degrades independently. */
export async function retrieveMemories(query = '', category?: string, limit = 30, options: { asOf?: string; scope?: 'personal' | 'daydream' | 'agent' } = {}) {
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  if (!Number.isFinite(asOf.getTime())) throw new Error('Invalid recall date');
  const at = asOf.toISOString();
  const scope = options.scope ?? 'personal';
  const live = and(options.asOf ? sql`coalesce(${jkaiMemories.supersededBy},'') <> 'forgotten'` : isNull(jkaiMemories.supersededBy), category ? eq(jkaiMemories.category, category) : undefined,
    scope === 'personal' ? and(isNull(jkaiMemories.daydreamOrigin), sql`coalesce(${jkaiMemories.provenance}->>'scope','personal')='personal'`) : sql`coalesce(${jkaiMemories.provenance}->>'scope',case when ${jkaiMemories.daydreamOrigin} is not null then 'daydream' else 'personal' end)=${scope}`,
    sql`coalesce(${jkaiMemories.provenance}->>'validFrom', ${jkaiMemories.createdAt}::text)::timestamptz <= ${at}::timestamptz`,
    sql`(${jkaiMemories.provenance}->>'validUntil' is null or (${jkaiMemories.provenance}->>'validUntil')::timestamptz > ${at}::timestamptz)`);
  const graphIds = scope === 'personal' ? await graphMemoryIds(query) : [];
  const lexical = query.trim() ? sql`to_tsvector('english', ${jkaiMemories.content}) @@ websearch_to_tsquery('english', ${(query.match(/[\p{L}\p{N}]{3,}/gu) ?? []).join(' OR ')})` : undefined;
  const rows = await db.select().from(jkaiMemories).where(and(live, query.trim() ? or(lexical, graphIds.length ? inArray(jkaiMemories.id, graphIds) : undefined, sql`${jkaiMemories.provenance}->>'pinned' = 'true'`) : undefined))
    .orderBy(sql`coalesce(${jkaiMemories.provenance}->>'pinned','false') DESC`, desc(jkaiMemories.updatedAt)).limit(100);
  const fusion = new Map(rows.map((r,i)=>[r.id, 1/(60+i)+(graphIds.includes(r.id)?1/60:0)]));
  if (query.trim()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const vector = await Promise.race([generateEmbedding(query), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
      if (vector) {
        const semantic = await db.select().from(jkaiMemories).where(and(live, sql`${jkaiMemories.embedding} is not null`, sql`${jkaiMemories.embedding} <=> ${JSON.stringify(vector)}::vector < 0.6`))
          .orderBy(sql`${jkaiMemories.embedding} <=> ${JSON.stringify(vector)}::vector`).limit(limit);
        const seen = new Set(rows.map(r => r.id));
        for (const [rank,row] of semantic.entries()) { fusion.set(row.id,(fusion.get(row.id)??0)+1/(60+rank)); if (!seen.has(row.id)) {rows.push(row);seen.add(row.id);} }
      }
    } catch { /* Lexical evidence remains usable when the embedding provider fails. */ }
    finally { if (timer) clearTimeout(timer); }
  }
  const links = await memoryLinks(rows.map(r => r.id));
  return rows.map(row => ({ ...row, entities: links.filter(l => l.memory_id === row.id),
    recalledBecause: graphIds.includes(row.id) ? 'Connected entity' : row.provenance?.pinned ? 'Pinned core context' : 'Text or semantic relevance' }))
    .sort((a,b) => Number(Boolean(b.provenance?.pinned)) - Number(Boolean(a.provenance?.pinned)) || ((fusion.get(b.id)??0)-(fusion.get(a.id)??0)) || memoryScore(b,query,asOf.getTime()) - memoryScore(a,query,asOf.getTime()))
    .slice(0, Math.min(100, Math.max(1,limit)));

}
