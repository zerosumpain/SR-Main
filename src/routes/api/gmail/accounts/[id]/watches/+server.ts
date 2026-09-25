import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts, gmailWatches } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { ownerGmailWhere } from '$lib/workflows/gmail/owner-accounts';

/**
 * A watch switches the 45s watcher on for its account, and the watcher
 * dispatches the owner's workflows. So a watch may only hang off an owner
 * mailbox — never a member's (see owner-accounts.ts).
 */
async function isOwnerAccount(accountId: number): Promise<boolean> {
  if (!Number.isFinite(accountId) || accountId <= 0) return false;
  const [row] = await db
    .select({ id: gmailAccounts.id })
    .from(gmailAccounts)
    .where(ownerGmailWhere(eq(gmailAccounts.id, accountId)))
    .limit(1);
  return !!row;
}

export const GET: RequestHandler = async ({ params }) => {
  const accountId = Number(params.id);
  if (!(await isOwnerAccount(accountId))) return json({ error: 'not found' }, { status: 404 });
  const rows = await db.select().from(gmailWatches).where(eq(gmailWatches.accountId, accountId));
  return json(rows);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const accountId = Number(params.id);
  if (!(await isOwnerAccount(accountId))) return json({ error: 'not found' }, { status: 404 });
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
