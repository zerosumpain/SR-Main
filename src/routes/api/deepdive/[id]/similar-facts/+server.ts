import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { facts } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { toVectorLiteral } from '$lib/deepdive/vector';

export const GET: RequestHandler = async ({ params, url }) => {
  const factId = url.searchParams.get('factId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10), 20);

  if (!factId) return json({ error: 'factId required' }, { status: 400 });

  const [fact] = await db
    .select({ embedding: facts.embedding })
    .from(facts)
    .where(eq(facts.id, factId))
    .limit(1);

  if (!fact?.embedding) return json([]);

  const vectorStr = toVectorLiteral(fact.embedding);

  const similar = await db.execute(
    sql`SELECT id, content, confidence, tags, source_id,
               1 - (embedding <=> ${vectorStr}::vector) as similarity
        FROM fact
        WHERE session_id = ${params.id}
          AND id != ${factId}
          AND NOT is_counterfactual
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> ${vectorStr}::vector) > 0.5
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${limit}`,
  );

  return json(similar.rows);
};
