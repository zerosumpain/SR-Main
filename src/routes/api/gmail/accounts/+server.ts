import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ownerGmailWhere } from '$lib/workflows/gmail/owner-accounts';

export const GET: RequestHandler = async () => {
  const rows = await db.select({
    id: gmailAccounts.id,
    email: gmailAccounts.email,
    status: gmailAccounts.status,
    scopes: gmailAccounts.scopes,
    lastError: gmailAccounts.lastError,
    createdAt: gmailAccounts.createdAt,
  }).from(gmailAccounts).where(ownerGmailWhere());
  // The owner's mailboxes only — this feeds every canvas Gmail picker, and a
  // family member's mailbox must never be pickable (see owner-accounts.ts).
  return json(rows);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, { status: 400 });
  await db.delete(gmailAccounts).where(ownerGmailWhere(eq(gmailAccounts.id, id)));
  return json({ ok: true });
};
