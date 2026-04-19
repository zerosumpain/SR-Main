import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelEntityTypes } from '$lib/db/schema';
import { sql, isNull, or, ilike, eq } from 'drizzle-orm';

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

  return json({ notes, entities });
};
