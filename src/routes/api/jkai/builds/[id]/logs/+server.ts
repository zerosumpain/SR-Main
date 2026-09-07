import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiLogs } from '$lib/db/schema';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
/** Owner-gated durable replay; the cursor advances only over persisted rows. */
export const GET: RequestHandler = async ({ params, url }) => {
  const after = Number(url.searchParams.get('after') ?? 0);
  if (!Number.isInteger(after) || after < 0 || after > 2147483647) return json({ error: 'Invalid log cursor' }, { status: 400 });
  const [build] = await db.select({ id: jkaiBuilds.id }).from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Build not found' }, { status: 404 });
  const logs = await db.select({ id: jkaiLogs.id, type: jkaiLogs.type,
    content: sql<string>`left(${jkaiLogs.content}, 16000)`, iterationId: jkaiLogs.iterationId, createdAt: jkaiLogs.createdAt,
  }).from(jkaiLogs).where(and(eq(jkaiLogs.buildId, params.id), ...(after ? [gt(jkaiLogs.id, after)] : [])))
    .orderBy(after ? asc(jkaiLogs.id) : desc(jkaiLogs.id)).limit(80);
  if (!after) logs.reverse();
  return json({ logs, cursor: logs.at(-1)?.id ?? after }, { headers: { 'cache-control': 'no-store' } });
};
