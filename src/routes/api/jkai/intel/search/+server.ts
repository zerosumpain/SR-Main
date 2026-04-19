import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes } from '$lib/db/schema';
import { sql, isNull, or, ilike, eq } from 'drizzle-orm';
import { generateEmbedding } from '$lib/jkai/intel/embed';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return json({ notes: [], entities: [] });

  const pattern = `%${q}%`;

  const [notes, entities] = await Promise.all([
    db
      .select({
        id: intelNotes.id,
        title: intelNotes.title,
        source: intelNotes.source,
        format: intelNotes.format,
        status: intelNotes.status,
        createdAt: intelNotes.createdAt,
        snippet: sql<string>`substring(${intelNotes.processedContent} from 1 for 200)`.as('snippet'),
      })
      .from(intelNotes)
      .where(
        or(
          ilike(intelNotes.title, pattern),
          ilike(intelNotes.rawContent, pattern),
          ilike(intelNotes.processedContent, pattern),
        ),
      )
      .orderBy(sql`${intelNotes.createdAt} DESC`)
      .limit(20),

    db
      .select({
        id: intelEntities.id,
        name: intelEntities.name,
        typeName: intelEntityTypes.name,
        typeIcon: intelEntityTypes.icon,
        summary: intelEntities.summary,
        confidence: intelEntities.confidence,
        confirmed: intelEntities.confirmed,
      })
      .from(intelEntities)
      .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .where(
        sql`${isNull(intelEntities.mergedIntoId)} AND (
          ${intelEntities.name} ILIKE ${pattern}
          OR ${intelEntities.summary} ILIKE ${pattern}
          OR ${intelEntities.properties}::text ILIKE ${pattern}
        )`,
      )
      .orderBy(sql`${intelEntities.updatedAt} DESC`)
      .limit(20),
  ]);

  // If keyword search returns few results, supplement with vector search
  if (notes.length + entities.length < 5) {
    try {
      const embedding = await generateEmbedding(q);
      const vectorStr = `[${embedding.join(',')}]`;

      const vectorNotes = await db.execute(sql`
        SELECT id, title, source, format, status, created_at as "createdAt",
               substring(processed_content from 1 for 200) as snippet,
               embedding <=> ${vectorStr}::vector as distance
        FROM intel_notes
        WHERE embedding IS NOT NULL
        ORDER BY distance ASC
        LIMIT 10
      `);

      const vectorEntities = await db.execute(sql`
        SELECT e.id, e.name, et.name as "typeName", et.icon as "typeIcon",
               e.summary, e.confidence, e.confirmed,
               e.embedding <=> ${vectorStr}::vector as distance
        FROM intel_entities e
        JOIN intel_entity_types et ON e.type_id = et.id
        WHERE e.embedding IS NOT NULL AND e.merged_into_id IS NULL
        ORDER BY distance ASC
        LIMIT 10
      `);

      // Merge results, dedup by ID
      const noteIds = new Set(notes.map((n) => n.id));
      for (const row of vectorNotes.rows as any[]) {
        if (!noteIds.has(row.id) && Number(row.distance) < 0.5) {
          notes.push({ ...row, createdAt: row.createdAt });
        }
      }

      const entityIds = new Set(entities.map((e) => e.id));
      for (const row of vectorEntities.rows as any[]) {
        if (!entityIds.has(row.id) && Number(row.distance) < 0.5) {
          entities.push(row as any);
        }
      }
    } catch (err) {
      console.error('[intel] Vector search fallback failed:', err);
    }
  }

  return json({ notes, entities });
};
