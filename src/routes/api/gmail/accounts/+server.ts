import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select({
    id: gmailAccounts.id,
    email: gmailAccounts.email,
    status: gmailAccounts.status,
    scopes: gmailAccounts.scopes,
    lastError: gmailAccounts.lastError,
    createdAt: gmailAccounts.createdAt,
  }).from(gmailAccounts);
  return json(rows);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, { status: 400 });
  await db.delete(gmailAccounts).where(eq(gmailAccounts.id, id));
  return json({ ok: true });
};
