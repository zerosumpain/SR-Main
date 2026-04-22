import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailWatches } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const accountId = Number(params.id);
  const rows = await db.select().from(gmailWatches).where(eq(gmailWatches.accountId, accountId));
  return json(rows);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const accountId = Number(params.id);
  const { label, query, enabled } = await request.json();
  if (!label || !query) return json({ error: 'label and query required' }, { status: 400 });
  const [row] = await db.insert(gmailWatches).values({
    accountId, label, query, enabled: enabled ?? true,
  }).returning();
  return json(row);
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  const accountId = Number(params.id);
  const watchId = Number(url.searchParams.get('watchId'));
  if (!watchId) return json({ error: 'watchId required' }, { status: 400 });
  await db.delete(gmailWatches).where(and(eq(gmailWatches.id, watchId), eq(gmailWatches.accountId, accountId)));
  return json({ ok: true });
};
