import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { scheduledCallbacks } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(scheduledCallbacks).orderBy(desc(scheduledCallbacks.createdAt)).limit(200);
  return json({
    callbacks: rows.map((r) => ({
      ...r,
      totalCostUsd: Number(r.totalCostUsd),
    })),
  });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'invalid body');
  const { id, action } = body as { id?: string; action?: string };
  if (typeof id !== 'string' || typeof action !== 'string') throw error(400, 'id + action required');

  if (action === 'cancel') {
    const [row] = await db.update(scheduledCallbacks)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(scheduledCallbacks.id, id))
      .returning();
    if (!row) throw error(404, 'not found');
    return json({ ok: true, callback: row });
  }
  if (action === 'fire-now') {
    const [row] = await db.select().from(scheduledCallbacks).where(eq(scheduledCallbacks.id, id)).limit(1);
    if (!row) throw error(404, 'not found');
    if (row.status !== 'pending') throw error(400, `cannot fire — status is ${row.status}`);
    const { fireCallback } = await import('$lib/scheduled/executor');
    const result = await fireCallback(row);
    return json({ ok: true, result });
  }
  throw error(400, `unknown action ${action}`);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) throw error(400, 'id required');
  const [row] = await db.delete(scheduledCallbacks).where(eq(scheduledCallbacks.id, id)).returning();
  if (!row) throw error(404, 'not found');
  return json({ ok: true, deleted: row.id });
};
