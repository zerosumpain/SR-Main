import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { generateEmbedding } from '$lib/jkai/intel/embed';
import { memoryScore } from './contracts';

/** Lexical recall is always available; semantic recall degrades independently. */
export async function retrieveMemories(query = '', category?: string, limit = 30) {
  const live = and(isNull(jkaiMemories.supersededBy), category ? eq(jkaiMemories.category, category) : undefined,
    sql`(${jkaiMemories.provenance}->>'validUntil' is null or ${jkaiMemories.provenance}->>'validUntil' > ${new Date().toISOString()})`);
  const lexical = query.trim() ? sql`to_tsvector('english', ${jkaiMemories.content}) @@ websearch_to_tsquery('english', ${(query.match(/[\p{L}\p{N}]{3,}/gu) ?? []).join(' OR ')})` : undefined;
  const rows = await db.select().from(jkaiMemories).where(and(live, query.trim() ? or(lexical, sql`${jkaiMemories.provenance}->>'pinned' = 'true'`) : undefined))
    .orderBy(desc(jkaiMemories.updatedAt)).limit(100);
  if (query.trim()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const vector = await Promise.race([generateEmbedding(query), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
      if (vector) {
        const semantic = await db.select().from(jkaiMemories).where(and(live, sql`${jkaiMemories.embedding} is not null`, sql`${jkaiMemories.embedding} <=> ${JSON.stringify(vector)}::vector < 0.6`))
          .orderBy(sql`${jkaiMemories.embedding} <=> ${JSON.stringify(vector)}::vector`).limit(limit);
        const seen = new Set(rows.map(r => r.id));
        for (const row of semantic) if (!seen.has(row.id)) rows.push(row);
      }
    } catch { /* Lexical evidence remains usable when the embedding provider fails. */ }
    finally { if (timer) clearTimeout(timer); }
  }
  return rows.sort((a, b) => memoryScore(b, query) - memoryScore(a, query)).slice(0, Math.min(100, Math.max(1, limit)));
}
