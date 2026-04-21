import type { RequestHandler } from './$types';
import { requestStop } from '$lib/quickanswer/worker';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params }) => {
  const [row] = await db
    .select()
    .from(quickAnswers)
    .where(eq(quickAnswers.id, params.id))
    .limit(1);
  if (!row) return json({ error: 'Quick answer not found' }, { status: 404 });
  return json({
    id: row.id,
    topic: row.topic,
    status: row.status,
    answer: row.answer,
    sources: row.sources,
    queries: row.queries,
    errorMessage: row.errorMessage,
    tokensUsed: row.tokensUsed,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  if (body.action === 'stop') {
    requestStop(params.id);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, { status: 400 });
};
